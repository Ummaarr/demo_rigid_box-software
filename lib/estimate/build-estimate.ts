import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/db/admin";
import { loadEstimateRates, type ResolvedRates } from "@/lib/db/rates";
import {
  estimateMaterials,
  WINDOW_PUNCHING_MARGIN_MM,
  type MaterialInput,
  type MaterialQuantities,
  type Sheet,
} from "@/lib/engines/material";
import {
  ADJUSTABLE_LINES,
  estimateCost,
  type CostRates,
  type CostBreakdown,
} from "@/lib/engines/cost";
import type { Blank, BoxType, CardStockSelection, ChargeLine, EstimateRequest } from "@/types";
import { sleeveBlank } from "@/lib/formulas/sleeve";
import { fitAllowanceIn } from "@/lib/formulas/fit";
import { chargeTotal } from "./charges";
import { EstimateError } from "./errors";
import { resolveAutoPrinting } from "./auto-printing";
import { innerWastagePctOf, outerWastagePct, productionQuantity } from "./auto-printing-core";

const BOX_TYPES = new Set<BoxType>([
  "telescopic",
  "magnetic",
  "shoulder",
  "drawer_sliding",
  "matchbox_sliding",
  "hinge_lid",
  "collapsible_rigid",
  "double_decker",
  "tray_only",
]);

export interface BuiltEstimate {
  specsSnapshot: EstimateRequest;
  ratesSnapshot: ResolvedRates;
  materials: MaterialQuantities;
  cost: CostBreakdown;
}

/**
 * Engine-1 paper inputs for the per-component wraps (client final doc item 2).
 * Each listed component gets its own sheet / print sheet / folding allowance
 * and its own printed-wastage tier — 15% when THAT part carries foiling or UV,
 * else 10%, matching how the shared layers are tiered. Returns {} when the
 * estimate has no per-component wraps, so the spread is a no-op.
 */
function perComponentPaperInputs(
  req: EstimateRequest,
  rates: ResolvedRates,
): Pick<MaterialInput, "outerPaperByComponent" | "innerPaperByComponent"> {
  const resolved = rates.perComponent;
  if (!resolved) return {};
  const sels = req.wrapping?.perComponent ?? {};
  const foilTier = (fs: { kind: string }[] | undefined) =>
    (fs ?? []).some((f) => f.kind === "foiling" || f.kind === "uv")
      ? rates.printFoilWastagePct
      : rates.printWastagePct;

  const outerPaperByComponent: NonNullable<MaterialInput["outerPaperByComponent"]> = {};
  const innerPaperByComponent: NonNullable<MaterialInput["innerPaperByComponent"]> = {};
  for (const [component, entry] of Object.entries(resolved)) {
    const sel = sels[component];
    if (entry.outer) {
      outerPaperByComponent[component] = {
        sheet: entry.outer.sheet,
        printSheet: entry.outer.printSheet,
        foldingAllowance_mm: entry.outer.foldingAllowance_mm,
        wastagePct:
          entry.outer.printing.mode === "none"
            ? 0
            : sel?.outer?.mode === "printed" && sel.outer.wastagePctOverride != null
              ? sel.outer.wastagePctOverride
              : foilTier(sel?.finishing),
      };
    }
    if (entry.inner) {
      innerPaperByComponent[component] = {
        sheet: entry.inner.sheet,
        printSheet: entry.inner.printSheet,
        wastagePct:
          entry.inner.printing.mode === "none" ? 0 : foilTier(sel?.inner?.finishing),
      };
    }
  }
  return {
    ...(Object.keys(outerPaperByComponent).length ? { outerPaperByComponent } : {}),
    ...(Object.keys(innerPaperByComponent).length ? { innerPaperByComponent } : {}),
  };
}

function positive(n: unknown, label: string): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    throw new EstimateError(`${label} must be a positive number.`);
  }
  return n;
}

function nonNegative(n: unknown, label: string): void {
  if (n != null && (typeof n !== "number" || !Number.isFinite(n) || n < 0)) {
    throw new EstimateError(`${label} must not be negative.`);
  }
}

/** Backend input validation (reject bad/missing/negative values up front). */
function validate(req: EstimateRequest): void {
  if (!BOX_TYPES.has(req.boxType)) {
    throw new EstimateError(`Unknown box type: ${String(req.boxType)}.`);
  }
  if (!req.dims) throw new EstimateError("dims are required.");
  positive(req.dims.length_in, "length");
  positive(req.dims.width_in, "width");
  positive(req.dims.height_in, "height");
  if (!Number.isInteger(req.quantity) || req.quantity <= 0) {
    throw new EstimateError("quantity must be a positive integer.");
  }
  // Production quantity (client item 3) is optional, but when given it must be
  // a whole number of boxes and cannot be fewer than the order.
  if (req.productionQuantity != null) {
    if (!Number.isInteger(req.productionQuantity) || req.productionQuantity <= 0) {
      throw new EstimateError("Production quantity must be a positive whole number.");
    }
    if (req.productionQuantity < req.quantity) {
      throw new EstimateError(
        "Production quantity cannot be less than the ordered quantity.",
      );
    }
  }
  positive(req.boardThickness_mm, "board thickness");

  // Optional numeric inputs must be >= 0 when present.
  nonNegative(req.manual?.glueTotal, "glue total");
  nonNegative(req.manual?.metlockTotal, "metlock total");
  nonNegative(req.manual?.tapeTotal, "tape total");

  // Manual line edits (item 9): the line must be one the engine actually
  // charges, and the value a real non-negative amount. Rejected rather than
  // ignored — a silently dropped edit would quote a price the user didn't
  // intend. Only one edit per line, so the applied figure is unambiguous.
  if (req.adjustments != null) {
    if (!Array.isArray(req.adjustments)) {
      throw new EstimateError("adjustments must be a list.");
    }
    const seen = new Set<string>();
    for (const a of req.adjustments) {
      if (!a || !ADJUSTABLE_LINES.includes(a.line)) {
        throw new EstimateError(`"${String(a?.line)}" is not an editable cost line.`);
      }
      if (seen.has(a.line)) {
        throw new EstimateError(`Duplicate edit for the "${a.line}" line.`);
      }
      seen.add(a.line);
      nonNegative(a.to, `edited ${a.line} amount`);
      if (a.to == null) {
        throw new EstimateError(`Edited ${a.line} amount is required.`);
      }
      // Optional staleness basis — must be a real amount when present.
      nonNegative(a.basis, `edited ${a.line} basis`);
    }
  }
  // Quantity mode (client 21-Jul): count + rate must both be >= 0 and the
  // unit named, since they're what the shown quantity reports.
  for (const [label, q] of [
    ["glue", req.manual?.glueQty],
    ["metlock", req.manual?.metlockQty],
  ] as const) {
    if (!q) continue;
    nonNegative(q.qty, `${label} quantity`);
    nonNegative(q.rate, `${label} rate`);
    if (!q.unit || typeof q.unit !== "string" || !q.unit.trim()) {
      throw new EstimateError(`${label}: a unit (bottles / litres / …) is required.`);
    }
  }
  if (req.wrapping?.outer?.mode === "printed") {
    nonNegative(req.wrapping.outer.wastagePctOverride, "printing wastage %");
  }
  // Auto-economical printing (round 5): a printing selection needs an explicit
  // sizeLabel unless auto is on; a printed wrap needs a paper size unless its
  // printing is auto (the server then picks the paper too).
  const checkPrinting = (
    sel: { printing?: { sizeLabel?: string; auto?: boolean }; paperSizeLabel?: string } | undefined,
    label: string,
  ) => {
    if (!sel?.printing) return;
    if (sel.printing.auto !== true && !sel.printing.sizeLabel) {
      throw new EstimateError(`${label} printing size is required (or choose Auto).`);
    }
    if (sel.printing.auto !== true && !sel.paperSizeLabel) {
      throw new EstimateError(`${label} paper size is required (or choose Auto printing).`);
    }
  };
  if (req.wrapping?.outer?.mode === "printed") checkPrinting(req.wrapping.outer, "Outer");
  const innerWrap = req.wrapping?.inner;
  if (innerWrap && innerWrap.mode !== "special" && innerWrap.mode !== "white") {
    checkPrinting(innerWrap, "Inner");
  }
  // Per-component wraps (client item 2) obey the same printing rules. Auto
  // sizing stays an estimate-level feature: it optimises one shared layer, so
  // a per-part wrap must name its sizes explicitly.
  for (const [component, cw] of Object.entries(req.wrapping?.perComponent ?? {})) {
    if (cw.outer?.mode === "printed") {
      if (cw.outer.printing.auto === true) {
        throw new EstimateError(
          `${component} outer: Auto printing is only available for the whole box — pick a size.`,
        );
      }
      checkPrinting(cw.outer, `${component} outer`);
    }
    if (cw.inner && cw.inner.mode !== "special" && cw.inner.mode !== "white") {
      if (cw.inner.printing?.auto === true) {
        throw new EstimateError(
          `${component} inner: Auto printing is only available for the whole box — pick a size.`,
        );
      }
      checkPrinting(cw.inner, `${component} inner`);
    }
    for (const f of [...(cw.finishing ?? []), ...(cw.inner?.finishing ?? [])]) {
      if (f.designArea) {
        positive(f.designArea.length_in, `${component} finishing ${f.kind} design length`);
        positive(f.designArea.width_in, `${component} finishing ${f.kind} design width`);
      }
    }
  }
  // Per-item finishing design areas are validated inline — each must be positive when set.
  for (const f of req.finishing ?? []) {
    if (f.designArea) {
      positive(f.designArea.length_in, `finishing ${f.kind} design length`);
      positive(f.designArea.width_in, `finishing ${f.kind} design width`);
    }
  }
  // Die/mould/block: legacy flat totals or {qty, rate} (round 3) — both must be >= 0.
  const chargeLine = (line: ChargeLine | undefined, label: string) => {
    if (line == null) return;
    if (typeof line === "number") {
      nonNegative(line, label);
    } else {
      nonNegative(line.qty, `${label} quantity`);
      nonNegative(line.rate, `${label} rate`);
    }
  };
  chargeLine(req.additional?.die, "die charge");
  chargeLine(req.additional?.mould, "mould charge");
  chargeLine(req.additional?.block, "block charge");
  nonNegative(req.additional?.designer, "designer charge");
  if (
    req.additionalMode != null &&
    req.additionalMode !== "included" &&
    req.additionalMode !== "separate"
  ) {
    throw new EstimateError("additionalMode must be 'included' or 'separate'.");
  }
  nonNegative(req.overheadPct, "overhead %");
  nonNegative(req.marginPct, "margin %");
  nonNegative(req.vars?.fitAllowance_in, "fit allowance");
  for (const l of req.labour ?? []) {
    nonNegative(l.quantity, `labour quantity (${l.role})`);
  }

  // Customisation add-ons (doc 2026-06-19).
  nonNegative(req.addons?.handles?.count, "handles count");
  nonNegative(req.addons?.locks?.count, "locks count");
  if (req.addons?.window) {
    positive(req.addons.window.size.length_in, "window length");
    positive(req.addons.window.size.width_in, "window width");
    nonNegative(req.addons.window.punchingMargin_mm, "window punching allowance");
  }
  if (req.printingMode != null && req.printingMode !== "combined" && req.printingMode !== "separate") {
    throw new EstimateError("printingMode must be 'combined' or 'separate'.");
  }
  // Miscellaneous add-ons (client 8-Jul): label required; units/price >= 0.
  for (const m of req.addons?.misc ?? []) {
    if (!m.label || typeof m.label !== "string" || !m.label.trim()) {
      throw new EstimateError("Miscellaneous add-on: a type/name is required.");
    }
    nonNegative(m.units, `misc add-on units (${m.label})`);
    nonNegative(m.pricePerUnit, `misc add-on price (${m.label})`);
    if (m.size) {
      positive(m.size.length_in, `misc add-on length (${m.label})`);
      positive(m.size.width_in, `misc add-on width (${m.label})`);
    }
  }

  // Foam inserts (multiple allowed — client 2-Jul), each with optional cover.
  const foamSels = req.inserts?.foams ?? (req.inserts?.foam ? [req.inserts.foam] : []);
  for (const f of foamSels) {
    positive(f.insert.length_in, `foam insert length (${f.type})`);
    positive(f.insert.width_in, `foam insert width (${f.type})`);
    nonNegative(f.punchingMargin_mm, `foam punching margin (${f.type})`);
    const c = f.cover;
    if (c && (c.top || c.bottom)) {
      if (c.material === "special") {
        if (!c.specialPaperName || !c.specialSizeLabel) {
          throw new EstimateError("Foam cover: special paper name and size are required.");
        }
      } else if (!c.paperSizeLabel || !c.gsm) {
        throw new EstimateError("Foam cover: paper size and GSM are required.");
      }
    }
  }

  // Round-5 inserts (client 13-Jul): sleeve / beading / card partitions.
  // Shared material + printing checks for any card-stock selection; the
  // lamination-only rule stays on beading/partitions (the round-6 sleeve
  // allows FULL finishing).
  const stockFields = (
    stock: Omit<CardStockSelection, "lamination">,
    label: string,
  ) => {
    if (stock.material === "special") {
      if (!stock.specialPaperName || !stock.specialSizeLabel) {
        throw new EstimateError(`${label}: special paper name and size are required.`);
      }
    } else if (!stock.paperSizeLabel || !stock.gsm) {
      throw new EstimateError(`${label}: paper size and GSM are required.`);
    }
    if (stock.printing && stock.printing.auto === true) {
      throw new EstimateError(`${label}: Auto printing is not available here — pick a size.`);
    }
    if (stock.printing && !stock.printing.sizeLabel) {
      throw new EstimateError(`${label}: printing size is required.`);
    }
  };
  const cardStock = (stock: CardStockSelection | undefined, label: string) => {
    if (!stock) return;
    stockFields(stock, label);
    for (const f of stock.lamination ?? []) {
      if (f.kind !== "lamination") {
        throw new EstimateError(`${label}: only lamination finishing is available.`);
      }
    }
  };
  const sleeveSel = req.inserts?.sleeve;
  if (sleeveSel) {
    positive(sleeveSel.dims.length_in, "sleeve length");
    positive(sleeveSel.dims.width_in, "sleeve width");
    positive(sleeveSel.dims.height_in, "sleeve height");
    stockFields(sleeveSel.stock, "Sleeve");
    for (const f of sleeveSel.stock.finishing ?? []) {
      if (f.designArea) {
        positive(f.designArea.length_in, `sleeve finishing ${f.kind} design length`);
        positive(f.designArea.width_in, `sleeve finishing ${f.kind} design width`);
      }
    }
  }
  if (req.inserts?.beading) {
    positive(req.inserts.beading.height_in, "beading height");
    positive(req.inserts.beading.thickness_in, "beading thickness");
    cardStock(req.inserts.beading.stock, "Beading");
  }
  if (req.inserts?.cardPartitions) {
    const cp = req.inserts.cardPartitions;
    nonNegative(cp.countL, "L partitions");
    nonNegative(cp.countW, "W partitions");
    if (!Number.isInteger(cp.countL) || !Number.isInteger(cp.countW)) {
      throw new EstimateError("Partition counts must be whole numbers.");
    }
    if (cp.countL + cp.countW <= 0) {
      throw new EstimateError("Card partitions: at least one partition is required.");
    }
    cardStock(cp.stock, "Card partition");
  }
  if (req.inserts?.customPartition) {
    const cp = req.inserts.customPartition;
    positive(cp.size.length_in, "custom partition length");
    positive(cp.size.width_in, "custom partition width");
    if (!Number.isInteger(cp.count) || cp.count <= 0) {
      throw new EstimateError("Custom partition count must be a positive whole number.");
    }
    cardStock(cp.stock, "Custom partition");
  }

  // Partial estimate: at least one section must remain included.
  const s = req.sections;
  if (s && s.board === false && s.wrapping === false && s.inserts === false) {
    throw new EstimateError("At least one estimate section must be included.");
  }
}

/**
 * Apply the partial-estimate section toggles (client asked 17-Jun + 2-Jul):
 * excluded sections' selections are dropped SERVER-SIDE so the API is
 * authoritative — a request can't sneak wrapping costs into a board-only quote.
 * Board is special: its nesting always runs (paper blanks derive from the board
 * keyline) — exclusion only zeroes its cost, handled in buildEstimate below.
 */
export function applySections(req: EstimateRequest): EstimateRequest {
  const s = req.sections;
  if (!s) return req;
  const out = { ...req };
  if (s.wrapping === false) {
    out.wrapping = undefined;
    out.finishing = undefined;
  }
  if (s.inserts === false) {
    out.inserts = undefined;
    out.accessories = undefined;
    out.addons = undefined;
  }
  return out;
}

/** Beading blank (client 13-Jul, taken literally):
 *  [BH+BT+BH + L + BH+BT+BH] × [BH+BT+BH + W + BH+BT+BH], one per box. */
function beadingBlank(
  dims: { length_in: number; width_in: number },
  bh: number,
  bt: number,
): Blank {
  const side = bh + bt + bh; // per side: BH + BT + BH
  return {
    component: "beading",
    width_in: side + dims.length_in + side,
    height_in: side + dims.width_in + side,
    count_per_box: 1,
  };
}

/** Card partition blanks (client 13-Jul): L-partition (H+H) × L × countL;
 *  W-partition (H+H) × W × countW. H = box height. */
function partitionBlanks(
  dims: { length_in: number; width_in: number; height_in: number },
  countL: number,
  countW: number,
): Blank[] {
  const H2 = dims.height_in + dims.height_in;
  const blanks: Blank[] = [];
  if (countL > 0) {
    blanks.push({ component: "partition_l", width_in: H2, height_in: dims.length_in, count_per_box: countL });
  }
  if (countW > 0) {
    blanks.push({ component: "partition_w", width_in: H2, height_in: dims.width_in, count_per_box: countW });
  }
  return blanks;
}

/** Engine stock input for a resolved card stock: printed = the plain 10% tier
 *  (lamination-only — foil/UV on these inserts is rejected in validate()). */
function cardStockInput(
  stock: { sheet: Sheet; printSheet?: Sheet; printing?: unknown },
  printWastagePct: number,
): { sheet: Sheet; printSheet?: Sheet; wastagePct: number } {
  return {
    sheet: stock.sheet,
    printSheet: stock.printSheet,
    wastagePct: stock.printing ? printWastagePct : 0,
  };
}

/**
 * Build Engine 1's input purely from a (sections-applied) request + resolved
 * rates — no DB access. Both a fresh `buildEstimate` call and a later re-view
 * of a saved estimate (specs_snapshot + its frozen rates_snapshot) can call
 * this to get the identical nesting, since the wastage tiers and print-fit
 * check below depend only on these two already-available snapshots.
 */
/** The paper size label a wrap selection picked, when it has one. */
function paperLabelOf(
  sel: { mode?: string; paperSizeLabel?: string; specialSizeLabel?: string } | undefined,
): string | undefined {
  if (!sel) return undefined;
  return sel.mode === "special" ? sel.specialSizeLabel : sel.paperSizeLabel;
}

/**
 * Does a "WxH" size label agree with the sheet dimensions stored on its rate
 * row (either orientation)? Labels that aren't a plain WxH pair are treated as
 * agreeing — plenty of legitimate names ("A4", "Custom") never parse.
 */
export function labelMatchesSheet(label: string, sheet: Sheet): boolean {
  const m = label.match(/^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*$/i);
  if (!m) return true;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return (
    (a === sheet.width_in && b === sheet.height_in) ||
    (a === sheet.height_in && b === sheet.width_in)
  );
}

export function buildMaterialInput(req: EstimateRequest, rates: ResolvedRates): MaterialInput {
  // Printing wastage (client review 2026-06): printed paper always runs extra
  // sheets — +N% printing only, +M% if printing + foiling/UV. Values come from
  // app_config (print_wastage_pct / print_foil_wastage_pct). Special paper gets
  // none. Per-estimate override (client 2-Jul: heavy solid-colour jobs waste
  // more) wins over the auto value with the shared tier helpers (round 5: the
  // auto-printing evaluator uses the SAME helpers so its candidate nesting
  // matches the real run exactly).
  const printWastagePct = outerWastagePct(req, rates.printWastagePct, rates.printFoilWastagePct);
  const innerWastagePct = innerWastagePctOf(req, rates.printWastagePct, rates.printFoilWastagePct);

  // Print size drives the paper size (client doc Step 1): the chosen print size
  // must fit the chosen paper sheet in some orientation, or the paper can't be
  // cut down to it.
  // The paper's SIZE LABEL is quoted alongside its stored dimensions: a rate row
  // whose label disagrees with its width_in/height_in (a rate-card typo — e.g.
  // "30x 20" saved as 23x22) otherwise produces a message that reads like an
  // engine bug, since the numbers shown match nothing the user picked.
  type FitCheck = { label: string; wrap: { sheet: Sheet; printSheet?: Sheet } | undefined; sizeLabel?: string };
  const checks: FitCheck[] = [
    { label: "outer", wrap: rates.outer, sizeLabel: paperLabelOf(req.wrapping?.outer) },
    { label: "inner", wrap: rates.inner, sizeLabel: paperLabelOf(req.wrapping?.inner) },
    // Per-component wraps (client item 2) get the same print-fits-paper check.
    ...Object.entries(rates.perComponent ?? {}).flatMap(([component, e]) => [
      {
        label: `${component} outer`,
        wrap: e.outer,
        sizeLabel: paperLabelOf(req.wrapping?.perComponent?.[component]?.outer),
      },
      {
        label: `${component} inner`,
        wrap: e.inner,
        sizeLabel: paperLabelOf(req.wrapping?.perComponent?.[component]?.inner),
      },
    ]),
    ...(rates.foams ?? []).map((f, i) => ({
      label: `foam ${i + 1} cover`,
      wrap: f.cover,
      sizeLabel: req.inserts?.foams?.[i]?.cover?.paperSizeLabel,
    })),
    // Round-5 printed stocks: their print must fit their paper too.
    {
      label: "sleeve",
      wrap: rates.sleeve,
      sizeLabel:
        req.inserts?.sleeve?.stock.material === "special"
          ? req.inserts.sleeve.stock.specialSizeLabel
          : req.inserts?.sleeve?.stock.paperSizeLabel,
    },
    { label: "beading", wrap: rates.beading, sizeLabel: req.inserts?.beading?.stock.paperSizeLabel },
    { label: "card partition", wrap: rates.cardPartitions, sizeLabel: req.inserts?.cardPartitions?.stock.paperSizeLabel },
    { label: "custom partition", wrap: rates.customPartition, sizeLabel: req.inserts?.customPartition?.stock.paperSizeLabel },
  ];
  for (const { label, wrap, sizeLabel } of checks) {
    if (wrap?.printSheet) {
      const p = wrap.printSheet;
      const s = wrap.sheet;
      const fits =
        (p.width_in <= s.width_in && p.height_in <= s.height_in) ||
        (p.height_in <= s.width_in && p.width_in <= s.height_in);
      if (!fits) {
        const sheetDesc = sizeLabel
          ? `"${sizeLabel}", whose sheet size is ${s.width_in}x${s.height_in} in`
          : `${s.width_in}x${s.height_in} in`;
        throw new EstimateError(
          `The ${label} printing size (${p.width_in}x${p.height_in} in) is larger than the ` +
            `selected paper ${sheetDesc}. Pick a paper size that fits the print, or a ` +
            `smaller print size.` +
            (sizeLabel && !labelMatchesSheet(sizeLabel, s)
              ? ` Note: that paper's name does not match its stored sheet size — check the ` +
                `row on the Rates page.`
              : ""),
        );
      }
    }
  }

  return {
    boxType: req.boxType,
    dims: req.dims,
    vars: req.vars,
    // Engine 1 nests the PRODUCTION run (client item 3): boxes actually made,
    // wastage included. Absent / not larger than the order = the ordered qty,
    // so pre-round-7 snapshots nest exactly as before.
    quantity: productionQuantity(req),
    board: { sheet: rates.board.sheet },
    outerPaper: rates.outer
      ? {
          sheet: rates.outer.sheet,
          foldingAllowance_mm: rates.foldingAllowance_mm,
          wastagePct: printWastagePct,
          printSheet: rates.outer.printSheet,
        }
      : undefined,
    // Inner lining blank = board keyline exactly (reduction defaults to 0).
    innerPaper: rates.inner
      ? {
          sheet: rates.inner.sheet,
          printSheet: rates.inner.printSheet,
          wastagePct: innerWastagePct,
        }
      : undefined,
    // Per-component wraps (client item 2): components listed here nest on
    // their OWN stock; the engine still groups identically-wrapped parts so
    // they share sheets and one plate. Each part's printed wastage tier keys
    // off ITS OWN foil/UV finishing, like the shared layers do.
    ...perComponentPaperInputs(req, rates),
    foams: (() => {
      const sels = req.inserts?.foams ?? (req.inserts?.foam ? [req.inserts.foam] : []);
      if (!sels.length || !rates.foams) return undefined;
      return sels.map((sel, i) => {
        const r = rates.foams![i];
        const c = sel.cover;
        const piecesPerBox = c ? (c.top ? 1 : 0) + (c.bottom ? 1 : 0) : 0;
        return {
          insert: sel.insert,
          sheet: r.sheet,
          punchingMargin_mm: sel.punchingMargin_mm,
          cover:
            c && piecesPerBox > 0 && r.cover
              ? {
                  piecesPerBox,
                  sheet: r.cover.sheet,
                  printSheet: r.cover.printSheet,
                  // Printed covers run extra sheets like any printed paper: +10%
                  // print-only, +15% when the cover now carries foil/UV finishing
                  // (client 7-Jul parity — same tier as the outer/inner wrap).
                  wastagePct: c.printing
                    ? (c.finishing ?? []).some((f) => f.kind === "foiling" || f.kind === "uv")
                      ? rates.printFoilWastagePct
                      : rates.printWastagePct
                    : 0,
                }
              : undefined,
        };
      });
    })(),
    reverseBoard:
      req.inserts?.reverseBoard && rates.reverseBoard
        ? {
            insertHeight_in: req.inserts.reverseBoard.insertHeight_in,
            boardSheet: rates.reverseBoard.sheet,
            topPaperSheet: rates.topPaper?.sheet,
          }
        : undefined,
    // Round-5 inserts (client 13-Jul; sleeve reworked round 6). Sleeve: blank
    // from the box type's own sleeve formula (matchbox default), cut straight
    // from its card stock — keyline exact, no folding allowance, no board.
    // Printed sleeve takes the 10/15 wastage tier by its OWN foil/UV
    // finishing. Card stocks: printed = always the 10% tier (lamination-only,
    // foil/UV rejected in validate()).
    sleeve:
      req.inserts?.sleeve && rates.sleeve
        ? {
            blank: sleeveBlank(req.boxType, req.inserts.sleeve.dims),
            stock: {
              sheet: rates.sleeve.sheet,
              printSheet: rates.sleeve.printSheet,
              wastagePct: rates.sleeve.printing
                ? (req.inserts.sleeve.stock.finishing ?? []).some(
                    (f) => f.kind === "foiling" || f.kind === "uv",
                  )
                  ? rates.printFoilWastagePct
                  : rates.printWastagePct
                : 0,
            },
          }
        : undefined,
    beading:
      req.inserts?.beading && rates.beading
        ? {
            blank: beadingBlank(req.dims, req.inserts.beading.height_in, req.inserts.beading.thickness_in),
            stock: cardStockInput(rates.beading, rates.printWastagePct),
          }
        : undefined,
    cardPartitions:
      req.inserts?.cardPartitions && rates.cardPartitions
        ? {
            blanks: partitionBlanks(req.dims, req.inserts.cardPartitions.countL, req.inserts.cardPartitions.countW),
            stock: cardStockInput(rates.cardPartitions, rates.printWastagePct),
          }
        : undefined,
    customPartition:
      req.inserts?.customPartition && rates.customPartition
        ? {
            blank: {
              component: "custom_partition",
              width_in: req.inserts.customPartition.size.length_in,
              height_in: req.inserts.customPartition.size.width_in,
              count_per_box: req.inserts.customPartition.count,
            },
            stock: cardStockInput(rates.customPartition, rates.printWastagePct),
          }
        : undefined,
    window:
      req.addons?.window && rates.window
        ? {
            footprint: {
              length_in: req.addons.window.size.length_in,
              width_in: req.addons.window.size.width_in,
            },
            sheet: rates.window.sheet,
            // Punching allowance (client 13-Jul: +10 mm/side, editable). Old
            // snapshots carry no field -> 0 -> legacy nesting unchanged.
            punchingMargin_mm: req.addons.window.punchingMargin_mm ?? 0,
          }
        : undefined,
    handlesPerBox: req.addons?.handles?.count,
    locksPerBox: req.addons?.locks?.count,
    accessories: { magnetsPerBox: req.accessories?.magnetsPerBox },
    overrides: req.overrides,
    // Board-cutting method (client 7-Jul): "single" forces per-component sheets;
    // "auto"/undefined allows combination nesting (kept only when it wins).
    combine: req.nestingMode !== "single",
    // Mixed-orientation nesting (round 5) — gated on the request's nesting
    // version so pre-round-5 snapshots recompute exactly as they were costed.
    mixed: (req.nestingVersion ?? 1) >= 2,
    // Free pieces (foam / cover / window film) joined mixed nesting at v3 —
    // v2 estimates were quoted with pure grids there and must stay that way.
    mixedPieces: (req.nestingVersion ?? 1) >= 3,
    // Inner-lining model (round 10) — its OWN version, not nestingVersion:
    // round-5..9 estimates were quoted with the full-keyline lining and must
    // keep it, so reusing that flag would silently re-price them.
    liningVersion: req.liningVersion,
    // Separate print jobs (client 13-Jul): wrap layers stop sharing sheets
    // across components; Engine 2 charges offset minimums per component.
    printingMode: req.printingMode,
  };
}

/**
 * Recompute Engine 1's material quantities for an ALREADY-SAVED estimate, from
 * its frozen specs_snapshot + rates_snapshot only — no fresh DB rates read, so
 * the result matches exactly what was costed at save time even if rates have
 * since changed. Used by the estimate detail view (materials/nesting/print-on-
 * paper layout aren't persisted, only cost_breakdown is). Throws on a legacy or
 * malformed snapshot the current engine can't parse — callers should catch and
 * fall back to "materials unavailable" rather than fail the whole page.
 */
export function recomputeMaterials(
  specsSnapshot: EstimateRequest,
  ratesSnapshot: ResolvedRates,
): MaterialQuantities {
  const req = applySections(specsSnapshot);
  return estimateMaterials(buildMaterialInput(req, ratesSnapshot));
}

/**
 * Build a full estimate from a request: validate, load the real rates from the
 * DB, run Engine 1 then Engine 2, and assemble the snapshots. Uses the service-
 * role admin client by default for rate reads (rates are global config and
 * margin_config is admin-only at RLS); the route verifies the session first.
 * A different client can be injected for testing.
 *
 * `ownerId`: null reads the shared master rate card (admin/staff — the
 * default, so every offline script and existing caller that doesn't pass one
 * stays byte-identical); a trial user's id reads ONLY their own private
 * clone. Always derive this from the session via ownerScopeFor() in
 * lib/auth.ts — never trust a client-sent value.
 */
/**
 * What Engine 2 should charge for tape, resolved from the request.
 *
 * Three-way, most-specific first:
 *   board section off   -> 0   (tape tapes the board components)
 *   tapeUsed === false  -> 0   (the job uses no tape; any amount is ignored)
 *   otherwise           -> tapeTotal when given, else `undefined`, which
 *                          leaves Engine 2 on its auto per-tray/lid path
 *
 * `tapeUsed` is ABSENT on every snapshot saved before the toggle existed and
 * defaults to "used", so this is a no-op for them — the property that
 * scripts/validate-tape-toggle.ts pins.
 *
 * Exported purely so that branch is testable without a database; buildEstimate
 * needs a Supabase client, this does not.
 */
export function resolveTapeOverride(
  manual: EstimateRequest["manual"],
  includeBoardCost: boolean,
): number | undefined {
  if (!includeBoardCost) return 0;
  if (manual?.tapeUsed === false) return 0;
  return manual?.tapeTotal;
}

export async function buildEstimate(
  rawReq: EstimateRequest,
  supabase: SupabaseClient = createAdminClient(),
  ownerId: string | null = null,
): Promise<BuiltEstimate> {
  validate(rawReq);

  // Fit allowance (round 6, client 15-Jul): the over-sliding piece (telescopic
  // lid, shoulder lid, drawer sleeve) grows by the board thickness per side.
  // Injected into the request HERE — before applySections and the snapshot —
  // so specs_snapshot carries the value and recomputeMaterials stays a pure
  // replay: old snapshots (no var) keep their original blanks, new ones are
  // deterministic. Never derive this inside buildMaterialInput/recompute.
  const fit = fitAllowanceIn(rawReq.boxType, rawReq.boardThickness_mm);
  if (fit != null && rawReq.vars?.fitAllowance_in == null) {
    rawReq = { ...rawReq, vars: { ...rawReq.vars, fitAllowance_in: fit } };
  }

  // Window punching allowance (client final doc item 4C): "the formula should
  // always add +10mm on each side automatically" — not a staff-editable knob.
  // Forced HERE (not left to the client payload) so it can't be sent as 0 or
  // omitted, and so specs_snapshot always carries the true value — old
  // snapshots (saved before this was locked down) keep whatever they recorded.
  if (rawReq.addons?.window) {
    rawReq = {
      ...rawReq,
      addons: {
        ...rawReq.addons,
        window: { ...rawReq.addons.window, punchingMargin_mm: WINDOW_PUNCHING_MARGIN_MM },
      },
    };
  }

  const applied = applySections(rawReq);
  const includeBoardCost = rawReq.sections?.board !== false;

  // Auto-economical printing (round 5): concretize `auto` selections into the
  // cheapest sizeLabel + paperSizeLabel BEFORE resolving rates, so the rest of
  // the pipeline (resolver, engines, fit-check, snapshots) runs unchanged.
  // specsSnapshot below still stores the RAW request (with `auto`), so a
  // re-run re-optimizes; the frozen rates make recompute deterministic.
  const { req, autoPicks } = await resolveAutoPrinting(supabase, applied, ownerId);

  const rates = await loadEstimateRates(supabase, req, ownerId);
  if (autoPicks.length > 0) rates.autoPicks = autoPicks;
  const materialInput = buildMaterialInput(req, rates);

  let materials: MaterialQuantities;
  try {
    materials = estimateMaterials(materialInput);
  } catch (err) {
    // Formula/engine input problems (e.g. missing required variable) are the
    // caller's fault -> surface as a 400.
    throw new EstimateError((err as Error).message);
  }

  const costRates: CostRates = {
    // Partial estimate: board excluded -> board nesting still ran (paper blanks
    // need the keyline) but the board itself isn't charged; tape (taping the
    // board tray/lid) is dropped with it.
    boardCostPerSheet: includeBoardCost ? rates.board.costPerSheet : 0,
    outerPaperCostPerSheet: rates.outer?.costPerSheet,
    innerPaperCostPerSheet: rates.inner?.costPerSheet,
    printing: rates.printing,
    innerPrinting: rates.innerPrinting,
    // Per-component wrap rates (client item 2), aligned with the engine's
    // groups by reading each group's own components — never by assuming an
    // order. Only emitted when the estimate actually has per-component wraps,
    // so the shared-wrap path stays literally untouched.
    ...(rates.perComponent
      ? {
          outerGroups: materials.outerPaperGroups?.map((g) => {
            const e = rates.perComponent?.[g.components[0]];
            return e?.outer
              ? {
                  paperCostPerSheet: e.outer.costPerSheet,
                  printing: e.outer.printing,
                  finishing: e.finishing ?? rates.finishing,
                }
              : {
                  paperCostPerSheet: rates.outer?.costPerSheet,
                  printing: rates.printing,
                  finishing: rates.finishing,
                };
          }),
          innerGroups: materials.innerPaperGroups?.map((g) => {
            const e = rates.perComponent?.[g.components[0]];
            return e?.inner
              ? {
                  paperCostPerSheet: e.inner.costPerSheet,
                  printing: e.inner.printing,
                  finishing: e.innerFinishing ?? rates.innerFinishing,
                }
              : {
                  paperCostPerSheet: rates.inner?.costPerSheet,
                  printing: rates.innerPrinting,
                  finishing: rates.innerFinishing,
                };
          }),
        }
      : {}),
    // Per-print-job offset charging (round 6): any request that carries a
    // printingMode (every new form estimate) pays one plate fee per print job.
    // Pre-round-5 snapshots (no field) keep legacy one-job-per-layer pricing.
    perJobPrinting: req.printingMode != null || undefined,
    finishing: rates.finishing,
    innerFinishing: rates.innerFinishing,
    foams: rates.foams?.map((f) => ({
      costPerSheet: f.costPerSheet,
      cover: f.cover
        ? {
            paperCostPerSheet: f.cover.costPerSheet,
            printing: f.cover.printing,
            finishing: f.cover.finishing,
          }
        : undefined,
    })),
    reverseBoardCostPerSheet: rates.reverseBoard?.costPerSheet,
    topPaperCostPerSheet: rates.topPaper?.costPerSheet,
    // Custom card insert is a manual open cost (Level-1 RM, so overhead + margin apply).
    cardCost: req.inserts?.card?.total,
    // Round-5 inserts (client 13-Jul; sleeve = card stock since round 6).
    sleeve: rates.sleeve
      ? {
          paperCostPerSheet: rates.sleeve.costPerSheet,
          printing: rates.sleeve.printing,
          finishing: rates.sleeve.finishing,
        }
      : undefined,
    beading: rates.beading
      ? {
          paperCostPerSheet: rates.beading.costPerSheet,
          printing: rates.beading.printing,
          finishing: rates.beading.finishing,
        }
      : undefined,
    cardPartitions: rates.cardPartitions
      ? {
          paperCostPerSheet: rates.cardPartitions.costPerSheet,
          printing: rates.cardPartitions.printing,
          finishing: rates.cardPartitions.finishing,
        }
      : undefined,
    customPartition: rates.customPartition
      ? {
          paperCostPerSheet: rates.customPartition.costPerSheet,
          printing: rates.customPartition.printing,
          finishing: rates.customPartition.finishing,
        }
      : undefined,
    // Ribbon tag auto-includes by box type; an inserts-excluded estimate
    // (e.g. wrapping-only) must not charge it.
    ribbonTagEach: rawReq.sections?.inserts === false ? undefined : rates.ribbonTagEach,
    handleEach: rates.handleEach,
    lockEach: rates.lockEach,
    windowCostPerSheet: rates.window?.costPerSheet,
    tapeCostOverride: resolveTapeOverride(req.manual, includeBoardCost),
    accessories: {
      magnetEach: rates.magnetEach ?? 0,
      washerEach: rates.washerEach ?? 0,
      tapePerUnit: rates.tapePerUnit,
    },
    glueCost: req.manual?.glueTotal,
    metlockCost: req.manual?.metlockTotal,
    // Manual line edits (item 9) — validated in validate(); the engine applies
    // them before summing Level 1 so overhead/margin recalculate on the edit.
    adjustments: req.adjustments?.length ? req.adjustments : undefined,
    labour: rates.labour,
    overheadPct: rates.overheadPct,
    marginPct: rates.marginPct,
    // Costs are computed on the production run; the box price is quoted
    // against the order (client item 3).
    orderedQuantity: req.quantity,
    // Miscellaneous add-ons (client 8-Jul): price is a manual open input frozen
    // in the snapshot; the engine just sums units × price as one RM line.
    // Round 10: `perBox` (staff-facing "per box" toggle) scales units by the
    // production run, same as handles/locks — absent stays a flat total.
    addonsMisc: req.addons?.misc?.length
      ? req.addons.misc.map((m) => ({
          label: m.label,
          amount: m.units * m.pricePerUnit * (m.perBox ? productionQuantity(req) : 1),
        }))
      : undefined,
    // ChargeLine (round 3): flatten qty×rate (or legacy totals) for the engine.
    additional: req.additional
      ? {
          die: chargeTotal(req.additional.die),
          mould: chargeTotal(req.additional.mould),
          block: chargeTotal(req.additional.block),
          designer: req.additional.designer,
        }
      : undefined,
    // Included in the per-box price, or quoted as their own line (client
    // 28-Jul). Absent = the pre-28-Jul behaviour (included).
    additionalMode: req.additionalMode,
  };

  const cost = estimateCost(materials, costRates);

  // Snapshot the RAW request (incl. section toggles + any selections in
  // excluded sections) so re-editing restores the full form state.
  return { specsSnapshot: rawReq, ratesSnapshot: rates, materials, cost };
}

/** Cost breakdown with the profit-margin fields removed (for Staff responses). */
export type StaffCostBreakdown = Omit<CostBreakdown, "margin" | "subtotalAfterMargin">;

/**
 * Shape the cost breakdown for the caller's role. Staff see all costs + the
 * final price but NOT the margin amount or the after-margin subtotal (that's
 * the COMPANY's real margin on shared work). Admin and trial see everything —
 * a trial user's margin is just their own markup input on their own private
 * estimate (their own cloned margin_config row), not a secret. Enforced here,
 * at the API boundary — never rely on the UI to hide it.
 */
export function costForRole(
  cost: CostBreakdown,
  role: string | null,
): CostBreakdown | StaffCostBreakdown {
  if (role === "admin" || role === "trial") return cost;
  // Default to the restricted view for staff and any other role.
  const { margin: _margin, subtotalAfterMargin: _sub, ...staffView } = cost;
  void _margin;
  void _sub;
  return staffView;
}
