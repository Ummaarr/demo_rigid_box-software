import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Sheet } from "@/lib/engines/material";
import type {
  FinishingRate,
  LabourLine,
  PrintingRate,
} from "@/lib/engines/cost";
import type {
  CardStockSelection,
  EstimateRequest,
  FinishingSelection,
  PrintingSelection,
} from "@/types";
import { DEFAULT_BOARD_TYPE } from "@/types";
import { EstimateError } from "@/lib/estimate/errors";

// Auto-trigger sets (mirror Engine 1 / CLAUDE.md) so we only require the rate
// rows a given box type actually needs.
const MAGNET_BOXES = new Set(["magnetic", "double_decker", "collapsible_rigid"]);
const RIBBON_BOXES = new Set(["drawer_sliding", "double_decker"]);

/**
 * Rates resolved for one estimate. Shapes match the engine inputs so the
 * resolver (build-estimate.ts) can map them with almost no transformation, and
 * this whole bundle is what gets frozen into rates_snapshot.
 */
export interface ResolvedRates {
  board: { costPerSheet: number; sheet: Sheet };
  /** Printed OR special outer paper. `printSheet` (printed mode) = the printing
   *  size's dimensions — it drives nesting; paper is bought to fit it. */
  outer?: { costPerSheet: number; sheet: Sheet; printSheet?: Sheet };
  inner?: { costPerSheet: number; sheet: Sheet; printSheet?: Sheet };
  printing: PrintingRate; // outer printing
  innerPrinting?: PrintingRate; // inner liner printing (optional)
  finishing: FinishingRate[];
  innerFinishing?: FinishingRate[]; // finishing on inner liner
  /**
   * Per-component wraps (client final doc item 2), keyed by component name.
   * Each entry carries that part's own resolved stock + printing + finishing;
   * components absent here use the shared outer/inner above. Frozen in
   * rates_snapshot like everything else, so recompute stays deterministic.
   */
  perComponent?: Record<
    string,
    {
      outer?: {
        costPerSheet: number;
        sheet: Sheet;
        printSheet?: Sheet;
        printing: PrintingRate;
        foldingAllowance_mm: number;
      };
      inner?: {
        costPerSheet: number;
        sheet: Sheet;
        printSheet?: Sheet;
        printing: PrintingRate;
      };
      finishing?: FinishingRate[];
      innerFinishing?: FinishingRate[];
    }
  >;
  /** One entry per foam insert in the request (client 2-Jul: several allowed).
   *  costPerSheet derives from rate_per_mm x thickness when the rate card has a
   *  per-mm rate (> 0, like board's 22.5/mm); else the flat cost_per_sheet.
   *  cover = the optional top/bottom cover's material rate + optional printing
   *  (print sheet drives the paper purchase, same as the outer/inner wrap). */
  foams?: {
    costPerSheet: number;
    sheet: Sheet;
    cover?: {
      costPerSheet: number;
      sheet: Sheet;
      printSheet?: Sheet;
      printing?: PrintingRate;
      finishing?: FinishingRate[];
    };
  }[];
  reverseBoard?: { costPerSheet: number; sheet: Sheet };
  topPaper?: { costPerSheet: number; sheet: Sheet };
  /** Sleeve insert (round 6): card-stock only — paper / board stock / special
   *  ("not kappa board"), optional printing + FULL finishing. */
  sleeve?: {
    costPerSheet: number;
    sheet: Sheet;
    printSheet?: Sheet;
    printing?: PrintingRate;
    finishing?: FinishingRate[];
  };
  /** Beading / card partition / custom partition stocks (round 5) — material
   *  rate + sheet, print rate/sheet when printed, lamination-only finishing. */
  beading?: {
    costPerSheet: number;
    sheet: Sheet;
    printSheet?: Sheet;
    printing?: PrintingRate;
    finishing?: FinishingRate[];
  };
  cardPartitions?: {
    costPerSheet: number;
    sheet: Sheet;
    printSheet?: Sheet;
    printing?: PrintingRate;
    finishing?: FinishingRate[];
  };
  customPartition?: {
    costPerSheet: number;
    sheet: Sheet;
    printSheet?: Sheet;
    printing?: PrintingRate;
    finishing?: FinishingRate[];
  };
  ribbonTagEach?: number;
  magnetEach?: number;
  washerEach?: number;
  // Customisation add-ons (doc 2026-06-19): handles/locks per-each, window film per sheet.
  handleEach?: number;
  lockEach?: number;
  window?: { costPerSheet: number; sheet: Sheet };
  tapePerUnit: number;
  labour: LabourLine[];
  overheadPct: number;
  marginPct: number;
  foldingAllowance_mm: number;
  /** Extra sheets for printed paper: printing only (%), printing + foil/UV (%). */
  printWastagePct: number;
  printFoilWastagePct: number;
  /**
   * What the auto-printing pick chose (round 5, client 13-Jul) — recorded so
   * the result panel / saved estimate can show which size won and how many
   * options were compared. The winning rows themselves are frozen above
   * (printing/printSheet/sheet) exactly as if the user had picked them, so
   * recompute never re-optimizes. Absent on explicit-size estimates.
   */
  autoPicks?: {
    layer: "outer" | "inner";
    sizeLabel: string;
    paperSizeLabel: string;
    considered: number;
  }[];
}

// --- low-level helpers ----------------------------------------------------

/**
 * Fetch a single matching row (or null) from a rate table, scoped to an
 * owner (trial-role isolation — see supabase/migration-trial-role.sql).
 * `ownerId` NULL = the shared master card (admin/staff, unchanged behaviour);
 * a real user id = that trial user's own private clone. Every rate table
 * this is ever called against has an `owner_id` column — app_config (which
 * doesn't) is read via a separate path in configValue() below, never here.
 */
async function row<T>(
  supabase: SupabaseClient,
  table: string,
  cols: string,
  filters: Record<string, string | number>,
  ownerId: string | null,
): Promise<T | null> {
  let q = supabase.from(table).select(cols).match(filters);
  q = ownerId == null ? q.is("owner_id", null) : q.eq("owner_id", ownerId);
  const { data, error } = await q.maybeSingle();
  if (error) {
    throw new Error(`rate lookup failed for ${table}: ${error.message}`);
  }
  return (data as T | null) ?? null;
}

type CoverPaperRow = { cost_per_sheet: number; width_in: number; height_in: number };

/**
 * Look up a board (art_card_rates) row for a foam cover. A DB that hasn't run
 * migration-board-type.sql has no `type` column at all, so filtering on it
 * errors — retry without it (such a DB can only hold one board type anyway).
 */
/**
 * Printing-rate lookup with the round-10 VENDOR dimension, also scoped by
 * owner (trial-role isolation, same reasoning as row() above).
 *
 * `vendor` set   -> filter to that vendor's row.
 * `vendor` unset -> do NOT filter (PostgREST cannot express `vendor is null`
 *                   through .match anyway) and order NULLS FIRST, so the
 *                   un-named row — the only row that existed before round 10 —
 *                   still wins. Every pre-round-10 snapshot therefore resolves
 *                   to exactly the row it always did.
 *
 * `.limit(1)` rather than a bare `maybeSingle()`: once a second vendor exists
 * for one size, the old single-row form would 406 on any vendor-less lookup
 * (e.g. re-running a saved estimate). This makes it deterministic instead.
 */
async function printRow<T>(
  supabase: SupabaseClient,
  table: string,
  cols: string,
  filters: Record<string, string | number>,
  ownerId: string | null,
  vendor?: string,
): Promise<T | null> {
  let q = supabase.from(table).select(cols).match(filters);
  q = vendor
    ? q.eq("vendor", vendor)
    : q.order("vendor", { ascending: true, nullsFirst: true });
  q = ownerId == null ? q.is("owner_id", null) : q.eq("owner_id", ownerId);
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) {
    throw new Error(`rate lookup failed for ${table}: ${error.message}`);
  }
  return (data as T | null) ?? null;
}

/** " from \"Vendor\"" for error messages — empty when no vendor was chosen, so
 *  pre-round-10 messages stay byte-identical. */
const vendorSuffix = (v?: string) => (v ? ` from "${v}"` : "");

async function boardRow(
  supabase: SupabaseClient,
  cols: string,
  base: Record<string, string | number>,
  boardType: string,
  ownerId: string | null,
): Promise<CoverPaperRow | null> {
  try {
    return await row<CoverPaperRow>(supabase, "art_card_rates", cols, { ...base, type: boardType }, ownerId);
  } catch {
    return await row<CoverPaperRow>(supabase, "art_card_rates", cols, base, ownerId);
  }
}

/** The selection shape resolveCoverStock reads — structurally satisfied by
 *  FoamCoverSelection, CardStockSelection and the round-6 SleeveStock. */
interface CoverStockSel {
  material: "art_paper" | "art_card" | "special";
  paperSizeLabel?: string;
  gsm?: number;
  boardType?: string;
  specialPaperName?: string;
  specialSizeLabel?: string;
  sheetOverride?: { width_in: number; height_in: number };
  printing?: PrintingSelection;
}

/** Resolved stock: material rate + sheet, plus print rate/sheet when printed. */
interface CoverStockRate {
  costPerSheet: number;
  sheet: Sheet;
  printSheet?: Sheet;
  printing?: PrintingRate;
}

/**
 * Resolve a cover/card stock selection: material from paper_rates /
 * art_card_rates (with boardType) / special_paper_rates (with per-estimate
 * sheet override), plus optional printing (explicit size — Auto is an
 * outer/inner-wrap feature). Extracted round 5 from the foam-cover block, which
 * keeps calling it (identical lookups + error messages); the sleeve wrap,
 * beading and partition stocks reuse it. `label` prefixes error messages
 * ("foam cover", "sleeve wrap", …).
 */
async function resolveCoverStock(
  supabase: SupabaseClient,
  cs: CoverStockSel,
  label: string,
  ownerId: string | null,
): Promise<CoverStockRate> {
  let out: CoverStockRate;
  if (cs.material === "special") {
    const s = need(
      await row<{ cost_per_sheet: number; width_in: number; height_in: number }>(
        supabase,
        "special_paper_rates",
        "cost_per_sheet, width_in, height_in",
        { name: cs.specialPaperName ?? "", size_label: cs.specialSizeLabel ?? "" },
        ownerId,
      ),
      `${label} special paper ${cs.specialPaperName} ${cs.specialSizeLabel}`,
    );
    // Per-estimate sheet override (parity with the outer/inner special wraps).
    const sheet = cs.sheetOverride ?? { width_in: s.width_in, height_in: s.height_in };
    out = { costPerSheet: s.cost_per_sheet, sheet };
  } else {
    const isBoard = cs.material === "art_card";
    const cols = "cost_per_sheet, width_in, height_in";
    const base = { size_label: cs.paperSizeLabel ?? "", gsm: cs.gsm ?? 0 };
    // Board covers key on (type, size, GSM) since the "Board" rate section
    // gained its Type column (client 18-Jul). Snapshots saved before that
    // carry no boardType — every row predating the column was migrated to
    // DEFAULT_BOARD_TYPE, so that is the correct fallback.
    const p = need(
      isBoard
        ? await boardRow(supabase, cols, base, cs.boardType ?? DEFAULT_BOARD_TYPE, ownerId)
        : await row<CoverPaperRow>(supabase, "paper_rates", cols, base, ownerId),
      `${label} ${isBoard ? `board ${cs.boardType ?? DEFAULT_BOARD_TYPE}` : "paper"} ${cs.paperSizeLabel} ${cs.gsm}gsm`,
    );
    out = { costPerSheet: p.cost_per_sheet, sheet: { width_in: p.width_in, height_in: p.height_in } };
  }

  // Optional printing — same rate tables/model as outer/inner.
  // Auto sizing is an outer/inner-wrap feature; stocks use explicit sizes.
  if (cs.printing) {
    const printLabel = need(cs.printing.sizeLabel, `${label} printing size (Auto is not available here)`);
    if (cs.printing.type === "offset") {
      const o = need(
        await printRow<{ first_1000: number; additional_1000: number; width_in: number; height_in: number }>(
          supabase, "offset_printing_rates", "first_1000, additional_1000, width_in, height_in",
          { size_label: printLabel, colour: cs.printing.colour ?? "multi" },
          ownerId,
          cs.printing.vendor,
        ),
        `${label} offset printing ${printLabel} (${cs.printing.colour ?? "multi"})${vendorSuffix(cs.printing.vendor)}`,
      );
      out.printing = { mode: "offset", first1000: o.first_1000, additional1000: o.additional_1000 };
      out.printSheet = { width_in: o.width_in, height_in: o.height_in };
    } else {
      const d = need(
        await printRow<{ cost_per_sheet: number; width_in: number; height_in: number }>(
          supabase, "digital_printing_rates", "cost_per_sheet, width_in, height_in",
          { size_label: printLabel },
          ownerId,
          cs.printing.vendor,
        ),
        `${label} digital printing ${printLabel}${vendorSuffix(cs.printing.vendor)}`,
      );
      out.printing = { mode: "digital", costPerSheet: d.cost_per_sheet };
      out.printSheet = { width_in: d.width_in, height_in: d.height_in };
    }
  }
  return out;
}

/** A resolved wrap layer: stock rate + sheet, print rate/sheet when printed. */
export interface ResolvedWrap {
  costPerSheet: number;
  sheet: Sheet;
  printSheet?: Sheet;
  printing: PrintingRate;
}

/**
 * Resolve ONE outer wrap selection (printed paper + its printing row, or
 * special paper with an optional per-estimate sheet override). Extracted round
 * 7 from the inline block in loadEstimateRates, which still calls it — the
 * lookups, labels and error messages are unchanged — so the per-component
 * wraps (client item 2) resolve through exactly the same path.
 */
async function resolveOuterWrap(
  supabase: SupabaseClient,
  sel: NonNullable<EstimateRequest["wrapping"]>["outer"] & object,
  ownerId: string | null,
  label = "",
): Promise<ResolvedWrap> {
  const pfx = label ? `${label} ` : "";
  if (sel.mode === "printed") {
    // Auto printing (round 5) is concretized by resolveAutoPrinting BEFORE
    // this resolver runs, so both labels must be present here.
    const paperLabel = need(sel.paperSizeLabel, `${pfx}outer paper size (auto printing not resolved)`);
    const printLabel = need(sel.printing.sizeLabel, `${pfx}outer printing size (auto printing not resolved)`);
    const p = need(
      await row<{ cost_per_sheet: number; width_in: number; height_in: number }>(
        supabase,
        "paper_rates",
        "cost_per_sheet, width_in, height_in",
        { size_label: paperLabel, gsm: sel.gsm },
        ownerId,
      ),
      `${pfx}paper ${paperLabel} ${sel.gsm}gsm`,
    );
    // Print size drives the paper (client doc: "printing size determines what
    // paper size we will use") — resolve the printing row's dimensions too.
    let printing: PrintingRate;
    let printSheet: Sheet;
    if (sel.printing.type === "offset") {
      const o = need(
        await printRow<{ first_1000: number; additional_1000: number; width_in: number; height_in: number }>(
          supabase,
          "offset_printing_rates",
          "first_1000, additional_1000, width_in, height_in",
          // colour (client 6-Jul): multicolour vs single-colour; default multi
          // for legacy snapshots that predate the colour field.
          { size_label: printLabel, colour: sel.printing.colour ?? "multi" },
          ownerId,
          sel.printing.vendor,
        ),
        `${pfx}offset printing ${printLabel} (${sel.printing.colour ?? "multi"})${vendorSuffix(sel.printing.vendor)}`,
      );
      printing = { mode: "offset", first1000: o.first_1000, additional1000: o.additional_1000 };
      printSheet = { width_in: o.width_in, height_in: o.height_in };
    } else {
      const d = need(
        await printRow<{ cost_per_sheet: number; width_in: number; height_in: number }>(
          supabase,
          "digital_printing_rates",
          "cost_per_sheet, width_in, height_in",
          { size_label: printLabel },
          ownerId,
          sel.printing.vendor,
        ),
        `${pfx}digital printing ${printLabel}${vendorSuffix(sel.printing.vendor)}`,
      );
      printing = { mode: "digital", costPerSheet: d.cost_per_sheet };
      printSheet = { width_in: d.width_in, height_in: d.height_in };
    }
    return {
      costPerSheet: p.cost_per_sheet,
      sheet: { width_in: p.width_in, height_in: p.height_in },
      printSheet,
      printing,
    };
  }
  // special paper — no printing cost
  const s = need(
    await row<{ cost_per_sheet: number; width_in: number; height_in: number }>(
      supabase,
      "special_paper_rates",
      "cost_per_sheet, width_in, height_in",
      { name: sel.specialPaperName, size_label: sel.specialSizeLabel },
      ownerId,
    ),
    `${pfx}special paper ${sel.specialPaperName} ${sel.specialSizeLabel}`,
  );
  // Use per-estimate sheet override if provided (batch size can differ from the catalogue).
  const sheet = sel.sheetOverride ?? { width_in: s.width_in, height_in: s.height_in };
  return { costPerSheet: s.cost_per_sheet, sheet, printing: { mode: "none" } };
}

/**
 * Resolve ONE inner lining selection — the 4 modes (client 2026-07): white
 * stock / printed / special. Legacy snapshots have no mode and take the
 * printed/paper_rates path, unchanged. Shared with the per-component wraps.
 */
async function resolveInnerWrap(
  supabase: SupabaseClient,
  sel: NonNullable<NonNullable<EstimateRequest["wrapping"]>["inner"]>,
  ownerId: string | null,
  label = "",
): Promise<ResolvedWrap> {
  const pfx = label ? `${label} ` : "";
  if (sel.mode === "special") {
    // Special inner paper — mirror of the outer special branch; no printing.
    const s = need(
      await row<{ cost_per_sheet: number; width_in: number; height_in: number }>(
        supabase,
        "special_paper_rates",
        "cost_per_sheet, width_in, height_in",
        { name: sel.specialPaperName, size_label: sel.specialSizeLabel },
        ownerId,
      ),
      `${pfx}inner special paper ${sel.specialPaperName} ${sel.specialSizeLabel}`,
    );
    const sheet = sel.sheetOverride ?? { width_in: s.width_in, height_in: s.height_in };
    return { costPerSheet: s.cost_per_sheet, sheet, printing: { mode: "none" } };
  }
  if (sel.mode === "white") {
    // Plain white lining stock — its own rate table; no printing.
    const w = need(
      await row<{ cost_per_sheet: number; width_in: number; height_in: number }>(
        supabase,
        "white_paper_rates",
        "cost_per_sheet, width_in, height_in",
        { size_label: sel.paperSizeLabel, gsm: sel.gsm },
        ownerId,
      ),
      `${pfx}white lining paper ${sel.paperSizeLabel} ${sel.gsm}gsm`,
    );
    return {
      costPerSheet: w.cost_per_sheet,
      sheet: { width_in: w.width_in, height_in: w.height_in },
      printing: { mode: "none" },
    };
  }
  // Auto printing (round 5) is concretized before this resolver runs.
  const innerPaperLabel = need(sel.paperSizeLabel, `${pfx}inner paper size (auto printing not resolved)`);
  const p = need(
    await row<{ cost_per_sheet: number; width_in: number; height_in: number }>(
      supabase,
      "paper_rates",
      "cost_per_sheet, width_in, height_in",
      { size_label: innerPaperLabel, gsm: sel.gsm },
      ownerId,
    ),
    `${pfx}inner paper ${innerPaperLabel} ${sel.gsm}gsm`,
  );
  const out: ResolvedWrap = {
    costPerSheet: p.cost_per_sheet,
    sheet: { width_in: p.width_in, height_in: p.height_in },
    printing: { mode: "none" },
  };

  // Optional inner printing (print size drives the inner paper too).
  if (sel.printing) {
    const innerPrintLabel = need(sel.printing.sizeLabel, `${pfx}inner printing size (auto printing not resolved)`);
    if (sel.printing.type === "offset") {
      const o = need(
        await printRow<{ first_1000: number; additional_1000: number; width_in: number; height_in: number }>(
          supabase, "offset_printing_rates", "first_1000, additional_1000, width_in, height_in",
          { size_label: innerPrintLabel, colour: sel.printing.colour ?? "multi" },
          ownerId,
          sel.printing.vendor,
        ),
        `${pfx}inner offset printing ${innerPrintLabel} (${sel.printing.colour ?? "multi"})${vendorSuffix(sel.printing.vendor)}`,
      );
      out.printing = { mode: "offset", first1000: o.first_1000, additional1000: o.additional_1000 };
      out.printSheet = { width_in: o.width_in, height_in: o.height_in };
    } else {
      const d = need(
        await printRow<{ cost_per_sheet: number; width_in: number; height_in: number }>(
          supabase, "digital_printing_rates", "cost_per_sheet, width_in, height_in",
          { size_label: innerPrintLabel },
          ownerId,
          sel.printing.vendor,
        ),
        `${pfx}inner digital printing ${innerPrintLabel}${vendorSuffix(sel.printing.vendor)}`,
      );
      out.printing = { mode: "digital", costPerSheet: d.cost_per_sheet };
      out.printSheet = { width_in: d.width_in, height_in: d.height_in };
    }
  }
  return out;
}

/** Read one numeric scalar from a key/value config table.
 *  Exported for the round-5 auto-printing evaluator (same defaults contract).
 *  app_config has no owner_id column — it's global formula config, read the
 *  same way regardless of role — so it bypasses row()'s owner filter
 *  entirely; margin_config DOES have owner_id (a trial user's own margin
 *  input, see schema.sql) and goes through row() like every rate table. */
export async function configValue(
  supabase: SupabaseClient,
  table: "app_config" | "margin_config",
  key: string,
  ownerId: string | null,
): Promise<number | null> {
  if (table === "app_config") {
    const { data, error } = await supabase
      .from(table)
      .select("value")
      .match({ key })
      .maybeSingle();
    if (error) {
      throw new Error(`rate lookup failed for ${table}: ${error.message}`);
    }
    return data ? Number((data as { value: number }).value) : null;
  }
  const r = await row<{ value: number }>(supabase, table, "value", { key }, ownerId);
  return r ? Number(r.value) : null;
}

function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new EstimateError(`Rate not found: ${what}.`);
  }
  return value;
}

/**
 * Resolve a list of finishing selections to their rate rows. Per-sq-inch
 * finishes (foiling, spot UV, relief) carry their own design area — the per-item
 * L×W input (or box footprint default), grown by wastageAllowance_mm each side.
 * Whole-sheet finishes (lamination, full UV, drip-off, aquas) ignore the area.
 * Shared by the outer wrap, inner liner, and foam cover (client 7-Jul parity).
 */
async function resolveFinishing(
  supabase: SupabaseClient,
  sels: FinishingSelection[] | undefined,
  dims: { length_in: number; width_in: number },
  label: string,
  ownerId: string | null,
): Promise<FinishingRate[]> {
  const out: FinishingRate[] = [];
  for (const f of sels ?? []) {
    const pad_in = (f.wastageAllowance_mm ?? 0) / 25.4;
    const rawL = f.designArea?.length_in ?? dims.length_in;
    const rawW = f.designArea?.width_in ?? dims.width_in;
    const itemAreaSqIn = (rawL + 2 * pad_in) * (rawW + 2 * pad_in);
    if (f.kind === "lamination") {
      const r = need(
        await row<{ rate_per_100sqin: number }>(supabase, "lamination_rates", "rate_per_100sqin", { type: f.key }, ownerId),
        `${label} lamination ${f.key}`,
      );
      // key/finish ride along for the round-6 itemized breakdown labels.
      out.push({ kind: "lamination", ratePer100sqin: r.rate_per_100sqin, key: f.key });
    } else if (f.kind === "foiling") {
      // Round 3: foiling rows are (color, finish) pairs. Prefer the exact
      // matte/glossy row the estimate picked; fall back to any row of that
      // colour (glossy first) so legacy snapshots — and DBs that haven't run
      // migration-round3.sql (single row per colour, no finish column) —
      // resolve exactly as before.
      let foils: { rate_per_sqin: number; finish?: string | null }[];
      let foilQ = supabase.from("foiling_rates").select("rate_per_sqin, finish").eq("color", f.key);
      foilQ = ownerId == null ? foilQ.is("owner_id", null) : foilQ.eq("owner_id", ownerId);
      const foilRes = await foilQ;
      if (foilRes.error) {
        // 42703 = undefined column: DB predates migration-round3.sql (no finish yet).
        if (foilRes.error.code !== "42703")
          throw new Error(`rate lookup failed for foiling_rates: ${foilRes.error.message}`);
        let legacyQ = supabase.from("foiling_rates").select("rate_per_sqin").eq("color", f.key);
        legacyQ = ownerId == null ? legacyQ.is("owner_id", null) : legacyQ.eq("owner_id", ownerId);
        const legacy = await legacyQ;
        if (legacy.error) throw new Error(`rate lookup failed for foiling_rates: ${legacy.error.message}`);
        foils = (legacy.data ?? []) as { rate_per_sqin: number }[];
      } else {
        foils = (foilRes.data ?? []) as { rate_per_sqin: number; finish?: string | null }[];
      }
      const r = need(
        foils.find((x) => f.finish && x.finish === f.finish) ??
          foils.find((x) => x.finish === "glossy" || x.finish == null) ??
          foils[0],
        `${label} foiling ${f.key}`,
      );
      out.push({
        kind: "foiling",
        ratePerSqin: r.rate_per_sqin,
        designAreaSqIn: itemAreaSqIn,
        key: f.key,
        finish: f.finish ?? undefined,
      });
    } else if (f.kind === "uv") {
      const r = need(
        await row<{ rate: number; unit: "per_100sqin" | "per_sqin" }>(supabase, "uv_coating_rates", "rate, unit", { type: f.key }, ownerId),
        `${label} uv ${f.key}`,
      );
      out.push({ kind: "uv", rate: r.rate, unit: r.unit, designAreaSqIn: r.unit === "per_sqin" ? itemAreaSqIn : undefined, key: f.key });
    } else {
      const r = need(
        await row<{ rate_per_sqin: number }>(supabase, "relief_rates", "rate_per_sqin", { type: f.key }, ownerId),
        `${label} relief ${f.key}`,
      );
      out.push({ kind: "relief", ratePerSqin: r.rate_per_sqin, designAreaSqIn: itemAreaSqIn, key: f.key });
    }
  }
  return out;
}

// --- orchestrator ---------------------------------------------------------

/**
 * `ownerId`: null reads the shared master rate card (admin/staff — unchanged
 * behaviour); a trial user's id reads ONLY their own private clone (see
 * ownerScopeFor() in lib/auth.ts, the single place this is derived from a
 * session — never trust a client-sent value).
 */
export async function loadEstimateRates(
  supabase: SupabaseClient,
  req: EstimateRequest,
  ownerId: string | null,
): Promise<ResolvedRates> {
  // Board (required) — sheet size comes from the rate row.
  const board = need(
    await row<{ cost_per_sheet: number; sheet_width_in: number; sheet_height_in: number }>(
      supabase,
      "board_rates",
      "cost_per_sheet, sheet_width_in, sheet_height_in",
      { thickness_mm: req.boardThickness_mm },
      ownerId,
    ),
    `board ${req.boardThickness_mm}mm`,
  );

  // Outer wrap + printing.
  let outer: ResolvedRates["outer"];
  let printing: PrintingRate = { mode: "none" };
  let foldingAllowance_mm =
    (await configValue(supabase, "app_config", "folding_allowance_mm", ownerId)) ?? 20;

  const outerSel = req.wrapping?.outer;
  if (outerSel) {
    if (outerSel.foldingAllowance_mm != null) {
      foldingAllowance_mm = outerSel.foldingAllowance_mm;
    }
    const w = await resolveOuterWrap(supabase, outerSel, ownerId);
    outer = { costPerSheet: w.costPerSheet, sheet: w.sheet, printSheet: w.printSheet };
    printing = w.printing;
  }

  // Inner lining — 4 modes (client 2026-07): white stock / printed / special.
  // Legacy snapshots have no mode -> the printed/paper_rates path, unchanged.
  let inner: ResolvedRates["inner"];
  let innerPrinting: ResolvedRates["innerPrinting"];
  const innerSel = req.wrapping?.inner;
  if (innerSel) {
    const w = await resolveInnerWrap(supabase, innerSel, ownerId);
    inner = { costPerSheet: w.costPerSheet, sheet: w.sheet, printSheet: w.printSheet };
    if (w.printing.mode !== "none") innerPrinting = w.printing;
  }

  // Per-component wraps (client final doc item 2): each named component's own
  // paper / printing / finishing, resolved through the SAME functions as the
  // shared wrap above, so lookups and error messages are identical.
  let perComponent: ResolvedRates["perComponent"];
  const perSel = req.wrapping?.perComponent;
  if (perSel && Object.keys(perSel).length > 0) {
    perComponent = {};
    for (const [component, cw] of Object.entries(perSel)) {
      const entry: NonNullable<ResolvedRates["perComponent"]>[string] = {};
      if (cw.outer) {
        const w = await resolveOuterWrap(supabase, cw.outer, ownerId, component);
        entry.outer = {
          costPerSheet: w.costPerSheet,
          sheet: w.sheet,
          printSheet: w.printSheet,
          printing: w.printing,
          foldingAllowance_mm: cw.outer.foldingAllowance_mm ?? foldingAllowance_mm,
        };
      }
      if (cw.inner) {
        const w = await resolveInnerWrap(supabase, cw.inner, ownerId, component);
        entry.inner = {
          costPerSheet: w.costPerSheet,
          sheet: w.sheet,
          printSheet: w.printSheet,
          printing: w.printing,
        };
        if (cw.inner.finishing?.length) {
          entry.innerFinishing = await resolveFinishing(
            supabase, cw.inner.finishing, req.dims, `${component} inner`, ownerId,
          );
        }
      }
      if (cw.finishing?.length) {
        entry.finishing = await resolveFinishing(
          supabase, cw.finishing, req.dims, `${component} outer`, ownerId,
        );
      }
      perComponent[component] = entry;
    }
  }

  // Inner liner finishing (same rate tables as outer; typically lamination only).
  const innerFinishing = await resolveFinishing(supabase, innerSel?.finishing, req.dims, "inner", ownerId);

  // Outer finishing — each per-sq-inch item carries its own design area (from the form's per-item
  // L×W input, or box footprint as default). A wastageAllowance_mm (default 10 mm each side,
  // client 27-Jun) expands the area to cover plate/foil overlap: (L + 2×pad) × (W + 2×pad).
  const finishing = await resolveFinishing(supabase, req.finishing, req.dims, "outer", ownerId);

  // Inserts: foam(s) + reverse board (+ top paper).
  // Old snapshots carry a single `foam`; new requests carry `foams[]`.
  const foamSelections =
    req.inserts?.foams ?? (req.inserts?.foam ? [req.inserts.foam] : []);
  let foams: ResolvedRates["foams"];
  if (foamSelections.length > 0) {
    foams = [];
    for (const sel of foamSelections) {
      // select * so a live DB that hasn't run migration-foam-per-mm.sql yet
      // (no rate_per_mm column) still resolves via the cost_per_sheet fallback.
      const fr = need(
        await row<{ cost_per_sheet: number; rate_per_mm?: number | null; sheet_width_in: number; sheet_height_in: number }>(
          supabase,
          "foam_rates",
          "*",
          { type: sel.type, thickness_mm: sel.thickness_mm },
          ownerId,
        ),
        `foam ${sel.type} ${sel.thickness_mm}mm`,
      );
      // Per-mm rate wins when set (> 0): sheet price = rate/mm x thickness.
      const costPerSheet =
        fr.rate_per_mm != null && Number(fr.rate_per_mm) > 0
          ? Number(fr.rate_per_mm) * sel.thickness_mm
          : Number(fr.cost_per_sheet);

      // Optional cover — material from paper_rates / art_card_rates /
      // special_paper_rates; optional printing resolved like the outer wrap
      // (the printing row's dimensions become the print sheet). Round 5: the
      // lookups live in resolveCoverStock, shared with the sleeve wrap and the
      // beading/partition stocks — identical lookups + error messages.
      let cover: NonNullable<ResolvedRates["foams"]>[number]["cover"];
      const cs = sel.cover;
      if (cs && (cs.top || cs.bottom)) {
        cover = await resolveCoverStock(supabase, cs, "foam cover", ownerId);
        // Optional finishing on the cover (client 7-Jul: full wrap parity).
        if (cs.finishing?.length) {
          cover.finishing = await resolveFinishing(supabase, cs.finishing, req.dims, "foam cover", ownerId);
        }
      }

      foams.push({
        costPerSheet,
        sheet: { width_in: fr.sheet_width_in, height_in: fr.sheet_height_in },
        cover,
      });
    }
  }

  let reverseBoard: ResolvedRates["reverseBoard"];
  let topPaper: ResolvedRates["topPaper"];
  if (req.inserts?.reverseBoard) {
    const rb = need(
      await row<{ cost_per_sheet: number; sheet_width_in: number; sheet_height_in: number }>(
        supabase,
        "reverse_board_rates",
        "cost_per_sheet, sheet_width_in, sheet_height_in",
        { thickness_mm: req.inserts.reverseBoard.thickness_mm },
        ownerId,
      ),
      `reverse board ${req.inserts.reverseBoard.thickness_mm}mm`,
    );
    reverseBoard = { costPerSheet: rb.cost_per_sheet, sheet: { width_in: rb.sheet_width_in, height_in: rb.sheet_height_in } };

    const tp = req.inserts.reverseBoard.topPaper;
    if (tp) {
      const p = need(
        await row<{ cost_per_sheet: number; width_in: number; height_in: number }>(
          supabase,
          "paper_rates",
          "cost_per_sheet, width_in, height_in",
          { size_label: tp.paperSizeLabel, gsm: tp.gsm },
          ownerId,
        ),
        `top paper ${tp.paperSizeLabel} ${tp.gsm}gsm`,
      );
      topPaper = { costPerSheet: p.cost_per_sheet, sheet: { width_in: p.width_in, height_in: p.height_in } };
    }
  }

  // Round-5 inserts, sleeve reworked round 6: card stock only (no board row),
  // through the shared stock resolver, with FULL finishing allowed.
  let sleeve: ResolvedRates["sleeve"];
  if (req.inserts?.sleeve) {
    const sel = req.inserts.sleeve;
    sleeve = await resolveCoverStock(supabase, sel.stock, "sleeve", ownerId);
    if (sel.stock.finishing?.length) {
      sleeve.finishing = await resolveFinishing(
        supabase,
        sel.stock.finishing,
        { length_in: sel.dims.length_in, width_in: sel.dims.width_in },
        "sleeve",
        ownerId,
      );
    }
  }

  // Beading / partition stocks: shared resolver + lamination-only finishing
  // (design-area finishes are rejected in validate(), so resolveFinishing's
  // per-sq-inch branches never trigger here).
  const resolveCardStock = async (
    sel: { stock: CardStockSelection } | undefined,
    label: string,
  ) => {
    if (!sel) return undefined;
    const stock: NonNullable<ResolvedRates["beading"]> = await resolveCoverStock(
      supabase,
      sel.stock,
      label,
      ownerId,
    );
    if (sel.stock.lamination?.length) {
      stock.finishing = await resolveFinishing(supabase, sel.stock.lamination, req.dims, label, ownerId);
    }
    return stock;
  };
  const beading = await resolveCardStock(req.inserts?.beading, "beading");
  const cardPartitions = await resolveCardStock(req.inserts?.cardPartitions, "card partition");
  const customPartition = await resolveCardStock(req.inserts?.customPartition, "custom partition");

  // Ribbon tag (auto for drawer / double decker; 10mm default if unspecified).
  let ribbonTagEach: number | undefined;
  const autoRibbon = RIBBON_BOXES.has(req.boxType);
  const ribbonSize = req.inserts?.ribbonTagSizeLabel ?? (autoRibbon ? "10mm" : undefined);
  if (ribbonSize) {
    const r = need(
      await row<{ price_each: number }>(supabase, "ribbon_tag_rates", "price_each", { size_label: ribbonSize }, ownerId),
      `ribbon tag ${ribbonSize}`,
    );
    ribbonTagEach = r.price_each;
  }

  // Magnets + washers (auto box types only, when magnetsPerBox > 0).
  let magnetEach: number | undefined;
  let washerEach: number | undefined;
  if (MAGNET_BOXES.has(req.boxType) && (req.accessories?.magnetsPerBox ?? 0) > 0) {
    const a = req.accessories!;
    if (a.magnetDiameter_mm == null || a.magnetThickness_mm == null) {
      throw new EstimateError(`${req.boxType}: magnet diameter + thickness required when magnets are included.`);
    }
    const m = need(
      await row<{ price_each: number }>(supabase, "magnet_rates", "price_each", {
        diameter_mm: a.magnetDiameter_mm,
        thickness_mm: a.magnetThickness_mm,
      }, ownerId),
      `magnet ${a.magnetDiameter_mm}x${a.magnetThickness_mm}mm`,
    );
    magnetEach = m.price_each;
    const washerName = a.washerName ?? `${a.magnetDiameter_mm}mm`;
    const w = need(
      await row<{ price_each: number }>(supabase, "washer_rates", "price_each", { name: washerName }, ownerId),
      `washer ${washerName}`,
    );
    washerEach = w.price_each;
  }

  // Customisation add-ons (doc 2026-06-19): handles + locks by type; window film by name.
  let handleEach: number | undefined;
  if (req.addons?.handles && req.addons.handles.count > 0) {
    const h = need(
      await row<{ price_each: number }>(supabase, "handle_rates", "price_each", { type: req.addons.handles.type }, ownerId),
      `handle ${req.addons.handles.type}`,
    );
    handleEach = h.price_each;
  }
  let lockEach: number | undefined;
  if (req.addons?.locks && req.addons.locks.count > 0) {
    const l = need(
      await row<{ price_each: number }>(supabase, "lock_rates", "price_each", { type: req.addons.locks.type }, ownerId),
      `lock ${req.addons.locks.type}`,
    );
    lockEach = l.price_each;
  }
  let window: ResolvedRates["window"];
  if (req.addons?.window) {
    const w = need(
      await row<{ cost_per_sheet: number; film_width_in: number; film_height_in: number }>(
        supabase,
        "window_rates",
        "cost_per_sheet, film_width_in, film_height_in",
        { name: req.addons.window.name },
        ownerId,
      ),
      `window film ${req.addons.window.name}`,
    );
    window = { costPerSheet: w.cost_per_sheet, sheet: { width_in: w.film_width_in, height_in: w.film_height_in } };
  }

  // Tape (always — auto per tray/lid component).
  const tape = need(
    await row<{ rate: number }>(supabase, "consumable_rates", "rate", { name: "tape" }, ownerId),
    "tape",
  );

  // Labour: resolve per-role rate from the chosen unit column.
  const labour: LabourLine[] = [];
  for (const l of req.labour ?? []) {
    const lr = need(
      await row<{ rate_per_day: number | null; rate_per_hour: number | null }>(
        supabase,
        "labour_rates",
        "rate_per_day, rate_per_hour",
        { name: l.role },
        ownerId,
      ),
      `labour role ${l.role}`,
    );
    const rate = l.unit === "hour" ? lr.rate_per_hour : lr.rate_per_day;
    if (rate == null) {
      throw new EstimateError(`labour role ${l.role}: no ${l.unit} rate set.`);
    }
    labour.push({ role: l.role, unit: l.unit, rate: Number(rate), quantity: l.quantity });
  }

  // Overhead + margin (request override, else config).
  const overheadPct =
    req.overheadPct ?? need(await configValue(supabase, "app_config", "overhead_pct", ownerId), "overhead_pct");
  const marginPct =
    req.marginPct ?? need(await configValue(supabase, "margin_config", "default_margin_pct", ownerId), "default_margin_pct");

  // Printing wastage % from app_config (fallback to hardcoded defaults for old DBs without the rows).
  const printWastagePct = (await configValue(supabase, "app_config", "print_wastage_pct", ownerId)) ?? 10;
  const printFoilWastagePct = (await configValue(supabase, "app_config", "print_foil_wastage_pct", ownerId)) ?? 15;

  return {
    board: { costPerSheet: board.cost_per_sheet, sheet: { width_in: board.sheet_width_in, height_in: board.sheet_height_in } },
    outer,
    inner,
    printing,
    innerPrinting,
    finishing,
    innerFinishing: innerFinishing.length ? innerFinishing : undefined,
    perComponent,
    foams,
    reverseBoard,
    sleeve,
    beading,
    cardPartitions,
    customPartition,
    topPaper,
    ribbonTagEach,
    magnetEach,
    washerEach,
    handleEach,
    lockEach,
    window,
    tapePerUnit: tape.rate,
    labour,
    overheadPct,
    marginPct,
    foldingAllowance_mm,
    printWastagePct,
    printFoilWastagePct,
  };
}
