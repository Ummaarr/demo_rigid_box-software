// Engine 2 — Cost Estimator.
//
// Input: material quantities from Engine 1 + a rates object (loaded from the DB
// in Phase 4 and frozen into rates_snapshot on each estimate). Output: an
// itemised cost breakdown following CLAUDE.md "Costing Layers (in order)".
//
// Pure function: no DB, no rate hardcoding. Every number comes from `rates`.
// NOTE on roles: this engine computes margin + full costs. Stripping margin/cost
// fields for Staff happens at the API layer (CLAUDE.md), never here.
//
// Cost layering (client doc):
//   Level 1 = raw materials + labour
//   Level 2 = Level 1 + overhead (11% of Level 1)
//   Margin  = 20% of Level 2 (admin-only downstream)
//   Then    + additional costs (manual, no margin) -> pre-GST total
//   GST is applied at the quotation stage (Phase 8), not here.
//
// Costing-basis decisions (user-confirmed): finishing area = printed sheets x
// full sheet area; labour = role x (per-hour|per-day rate) x quantity; glue,
// metlock and additional charges are per-order manual open inputs.

import { layerPrintJobs, wrapGroupsOf } from "@/lib/engines/material";
import type {
  MaterialEstimate,
  MaterialQuantities,
  WrapGroupEstimate,
} from "@/lib/engines/material";

// layerPrintJobs MOVED to material.ts in round 10 — it only ever reads a
// MaterialEstimate, and the cost-free raw-material PDF needs it to show the
// print-run split without importing this (cost-bearing) module. Re-exported
// here so every existing importer keeps working unchanged.
export { layerPrintJobs };

// --- Rate shapes (mirror the DB rows Engine 2 needs) ----------------------

/** Printing is offset (tiered), digital (per sheet), or none (special paper). */
export type PrintingRate =
  | { mode: "none" }
  | { mode: "digital"; costPerSheet: number }
  | { mode: "offset"; first1000: number; additional1000: number };

/** Display identity of a finishing pass (round-6 itemization): the rate-card
 *  key ("matte", "gold", "spot"…) and, for foiling, its matte/glossy finish.
 *  Absent on pre-round-6 rates_snapshots → kind-only fallback labels. */
interface FinishingId {
  key?: string;
  finish?: string;
}

/** One finishing pass applied to the printed area. */
export type FinishingRate =
  | ({ kind: "lamination"; ratePer100sqin: number } & FinishingId)
  // Per-sq-inch finishes carry their own design area (resolved from FinishingSelection.designArea
  // or box footprint default). Each item is independent — two foil items can have different sizes.
  | ({ kind: "foiling"; ratePerSqin: number; designAreaSqIn: number } & FinishingId)
  | ({ kind: "uv"; rate: number; unit: "per_100sqin" | "per_sqin"; designAreaSqIn?: number } & FinishingId)
  | ({ kind: "relief"; ratePerSqin: number; designAreaSqIn: number } & FinishingId);

/** One labour line: a role worked for some hours or days at the matching rate. */
export interface LabourLine {
  role: string;
  unit: "hour" | "day";
  rate: number; // the per-hour or per-day rate for this role
  quantity: number; // hours or days
}

/** Rates for one wrap group (client item 2: per-component paper/print/finish). */
export interface WrapGroupRate {
  paperCostPerSheet?: number;
  printing?: PrintingRate;
  finishing?: FinishingRate[];
}

/** Rates for one round-5 card-stock insert (beading / partitions). */
export interface CardStockCostRate {
  paperCostPerSheet: number;
  printing?: PrintingRate;
  finishing?: FinishingRate[];
}

export interface CostRates {
  boardCostPerSheet: number;
  outerPaperCostPerSheet?: number;
  innerPaperCostPerSheet?: number;
  printing?: PrintingRate; // outer-wrap printing
  innerPrinting?: PrintingRate; // inner-liner printing (optional)
  /**
   * Per-wrap-group rates (client final doc item 2), aligned by index with
   * `mat.outerPaperGroups` / `mat.innerPaperGroups`. Each group is a distinct
   * paper + print + finish job, so it carries its own stock rate, printing
   * rate and finishing passes. Absent (or a missing entry) falls back to the
   * shared outer/inner rates above — which is exactly the pre-round-7 model.
   */
  outerGroups?: WrapGroupRate[];
  innerGroups?: WrapGroupRate[];
  /**
   * Per-print-job offset charging (round 6, replaces round 5's
   * separatePrinting): when true, OFFSET plate fees are charged per PRINT JOB
   * of each wrap layer — one job per shared-sheet combination group, one per
   * component still cut alone (layerPrintJobs). Separate printing needs no
   * special case: its layers never combine, so jobs == components. Absent =
   * one job per layer (legacy — pre-round-5 snapshots cost identically).
   */
  perJobPrinting?: boolean;
  finishing?: FinishingRate[];
  innerFinishing?: FinishingRate[]; // finishing on the inner liner
  /** Per-foam-insert rates, aligned by index with `mat.foams` (client 2-Jul:
   *  several foams, each priced per mm; optional paper/card cover with the same
   *  purchase + printing formulas as the outer/inner wrap). */
  foams?: {
    costPerSheet: number;
    cover?: {
      paperCostPerSheet: number;
      printing?: PrintingRate;
      // Finishing on the cover (client 7-Jul: full wrap parity). Same shape/
      // costing as the outer/inner wrap; folded into the foam total below.
      finishing?: FinishingRate[];
    };
  }[];
  reverseBoardCostPerSheet?: number;
  topPaperCostPerSheet?: number;
  /** Custom card insert — a manual open cost (dimension/price entered per order). */
  cardCost?: number;
  /** Sleeve insert (round 6): card stock only ("not kappa board") — the
   *  card-insert model with FULL finishing instead of lamination-only. */
  sleeve?: CardStockCostRate;
  /** Beading / card partition / custom partition stocks (round 5). Aligned
   *  with mat.beading / mat.cardPartitions / mat.customPartition. */
  beading?: CardStockCostRate;
  cardPartitions?: CardStockCostRate;
  customPartition?: CardStockCostRate;
  ribbonTagEach?: number;
  /** Customisation add-ons (doc 2026-06-19): handles/locks per-each, window per film sheet. */
  handleEach?: number;
  lockEach?: number;
  windowCostPerSheet?: number;
  /**
   * Miscellaneous add-on lines (client 8-Jul: sleeve / satin / velvet / …).
   * Amounts are pre-computed (units × manual price) in build-estimate; the
   * engine only sums them into a Level-1 RM line.
   */
  addonsMisc?: { label: string; amount: number }[];
  accessories: {
    magnetEach: number;
    washerEach: number;
    tapePerUnit: number; // 0.75 per tray/lid
  };
  /** Fixed RM costs entered manually per order (vary too much to rate-card). */
  glueCost?: number;
  metlockCost?: number;
  /** Open-input override for tape cost (replaces the computed per-tray/lid tape). */
  tapeCostOverride?: number;
  /** Labour lines (Step 2). Total labour = sum of rate x quantity. */
  labour: LabourLine[];
  overheadPct: number; // % of Level 1 (RM + labour); standard 11
  marginPct: number; // % of Level 2; standard 20 (admin-only downstream)
  /**
   * ORDERED quantity (client final doc item 3). Every cost above is computed
   * on the PRODUCTION quantity (mat.quantity — boxes actually made, incl.
   * wastage); the final per-box rate divides by this instead. Absent = quote
   * per produced box, i.e. exactly the pre-round-7 behaviour.
   */
  orderedQuantity?: number;
  /** Additional charges entered manually per order, applied AFTER margin. */
  additional?: {
    die?: number;
    mould?: number;
    block?: number; // auto-prompt with foiling/emboss/deboss
    designer?: number;
  };
  /**
   * Whether the charges above are amortised into the per-box price (client
   * 28-Jul — see EstimateRequest.additionalMode). "separate" divides only the
   * box subtotal by the ordered quantity; `total` is unaffected either way.
   * Absent = "included", the pre-28-Jul behaviour.
   */
  additionalMode?: "included" | "separate";
  /**
   * Manual per-line edits (client final doc item 9, confirmed 22-Jul: "I would
   * want to mend, say, the total foam price to account for their transport
   * costs — none of the raw material prices take that into account").
   *
   * Each entry REPLACES one computed Level-1 line, and the ladder above it
   * re-runs — so overhead and margin recalculate on the edited base, which is
   * the "engine recalculating downstream costs" half of the ask. The rate card
   * is never touched: rates_snapshot stays a faithful record of the rates, and
   * the edit rides on the request (see EstimateRequest.adjustments), so it is
   * reproducible, reversible and visible rather than a fudged rate.
   */
  adjustments?: CostAdjustment[];
}

/** Adjustable Level-1 lines. Overhead/margin have their own % inputs, and the
 *  post-margin total is deliberately NOT adjustable — editing it would both
 *  fall outside "within the rate calculation" and let staff back-solve the
 *  margin they are not allowed to see. */
export const ADJUSTABLE_LINES = [
  "board",
  "outerPaper",
  "innerPaper",
  "printing",
  "innerPrinting",
  "finishing",
  "innerFinishing",
  "foam",
  "reverseBoard",
  "topPaper",
  "card",
  "sleeve",
  "beading",
  "cardPartition",
  "customPartition",
  "handles",
  "locks",
  "window",
  "addonsMisc",
  "accessories",
  "glue",
  "metlock",
  "labour",
] as const;

export type AdjustableLine = (typeof ADJUSTABLE_LINES)[number];

/** One manual line edit: "make this line cost exactly `to`". */
export interface CostAdjustment {
  line: AdjustableLine;
  /** The amount the line should become (absolute, >= 0). */
  to: number;
  /** Optional free-text reason, shown beside the edited figure. */
  note?: string;
  /**
   * What the engine computed for this line AT THE MOMENT THE EDIT WAS MADE.
   * Recorded so a later spec change can be detected: an edit is an absolute
   * amount, so if the specs move underneath it the pinned figure silently stops
   * matching the job. Comparing this against the freshly computed value flags
   * that (see AppliedAdjustment.stale). Absent = edit made before this was
   * tracked, or set programmatically; staleness is then simply not asserted.
   */
  basis?: number;
}

/** What an adjustment actually did, recorded so the UI/PDF can show the
 *  original engine figure beside the edited one. */
export interface AppliedAdjustment {
  line: AdjustableLine;
  computed: number;
  applied: number;
  delta: number;
  note?: string;
  /**
   * The specs changed since this edit was made — the line now computes to a
   * different figure than the one the user was looking at. The edit still
   * applies (it was deliberate), but the UI must surface it rather than let a
   * pinned amount quietly misprice a job.
   */
  stale?: boolean;
}

// --- Output ---------------------------------------------------------------

export interface AccessoryCost {
  magnets: number;
  washers: number;
  tape: number;
  ribbonTag: number;
  total: number;
}

export interface AdditionalCost {
  die: number;
  mould: number;
  block: number;
  designer: number;
  total: number;
}

export interface CostBreakdown {
  // Level 1 — raw materials
  board: number;
  outerPaper: number;
  innerPaper: number;
  printing: number; // outer printing
  innerPrinting: number; // inner liner printing (0 when not used)
  finishing: number; // outer finishing
  innerFinishing: number; // inner liner finishing (0 when not used)
  /** Itemized finishing lines (round 6): one per pass, summing to the totals
   *  above. Absent on estimates saved before round 6. */
  finishingDetail?: FinishingDetailLine[];
  innerFinishingDetail?: FinishingDetailLine[];
  /**
   * Itemized printing lines (round 10): the offset plate fee and the
   * additional-1000 blocks behind `printing` / `innerPrinting`, one set per
   * print job. Absent on estimates saved before round 10 and whenever there is
   * no printing at all.
   */
  printingDetail?: PrintingDetailLine[];
  innerPrintingDetail?: PrintingDetailLine[];
  foam: number;
  /** Per-foam itemisation (foam stock / cover stock / cover printing /
   *  cover finishing), summing to `foam`. Absent on pre-21-Jul estimates. */
  foamDetail?: FinishingDetailLine[];
  /** Manual line edits that were applied (item 9), each carrying the ORIGINAL
   *  computed figure so an estimate opened months later reads as deliberately
   *  edited rather than mis-calculated. Absent when nothing was edited. */
  adjustments?: AppliedAdjustment[];
  reverseBoard: number;
  topPaper: number;
  card: number; // custom card insert (manual open cost)
  /** Round-5 inserts (client 13-Jul) — 0 when not selected. */
  sleeve: number; // board + wrap paper + printing + finishing, folded
  beading: number; // stock + printing + lamination
  cardPartition: number;
  customPartition: number;
  handles: number; // customisation add-on (count x rate)
  locks: number; // customisation add-on (count x rate)
  window: number; // window film (nested sheets x rate)
  addonsMisc: number; // miscellaneous add-ons (sum of units x manual price)
  accessories: AccessoryCost;
  glue: number; // manual
  metlock: number; // manual
  materialSubtotal: number; // sum of all raw-material lines above
  // Level 1 — labour
  labour: number;
  level1: number; // materialSubtotal + labour
  // Level 2
  overhead: number; // overheadPct% of level1
  costBeforeMargin: number; // level1 + overhead (= Level 2)
  // Margin
  margin: number; // marginPct% of Level 2
  subtotalAfterMargin: number; // costBeforeMargin + margin
  // Step 5 — additional (no margin)
  additional: AdditionalCost;
  /** How `additional` was priced (client 28-Jul). Echoed from the request so
   *  the quote layer can follow the same choice from the stored breakdown
   *  alone. Absent on estimates saved before the toggle existed. */
  additionalMode?: "included" | "separate";
  // Pre-GST total (boxes + additional, under BOTH modes)
  total: number;
  /** Per-box rate ÷ ORDERED quantity (client item 3), so production wastage is
   *  carried by the quoted box price. Divides `total` when the additional
   *  charges are included, `subtotalAfterMargin` when they are quoted
   *  separately (client 28-Jul). */
  pricePerBox: number;
  /** Boxes actually made (what every cost above was computed on). Present
   *  from round 7; absent on older stored breakdowns. */
  productionQuantity?: number;
  /** Boxes ordered (what pricePerBox divides by). Present from round 7. */
  orderedQuantity?: number;
}

// --- Helpers --------------------------------------------------------------

/** Offset is a plate fee (first 1000) plus a block fee per additional 1000.
 *  Exported for the auto-printing candidate evaluator (round 5). */
export function offsetCost(
  sheets: number,
  first1000: number,
  additional1000: number,
): number {
  if (sheets <= 0) return 0;
  if (sheets <= 1000) return first1000;
  return first1000 + Math.ceil((sheets - 1000) / 1000) * additional1000;
}

/**
 * Printing cost for one wrap layer (client 13-Jul "combined printing" +
 * round-6 per-job charging): digital is per-sheet, so jobs never matter.
 * OFFSET without perJob = one plate fee on the layer total (legacy — old
 * snapshots cost identically). OFFSET with perJob = one tier per print job
 * (layerPrintJobs): fully-shared layers still pay one fee, un-shared
 * components each pay their own plate (Σ per-component tiers — the "double
 * printing costs" the client described for a lid + base printed separately).
 * A single-component layer is structurally identical to legacy.
 */
function layerPrintingCost(
  rate: PrintingRate | undefined,
  layer: MaterialEstimate | undefined,
  perJob: boolean,
): number {
  const printSheets = layer?.totalSheets ?? 0;
  if (!rate || printSheets <= 0) return 0;
  if (rate.mode === "digital") return printSheets * rate.costPerSheet;
  if (rate.mode !== "offset") return 0; // "none": special paper, no print cost
  if (!perJob || !layer || layer.components.length <= 1) {
    return offsetCost(printSheets, rate.first1000, rate.additional1000);
  }
  return layerPrintJobs(layer).reduce(
    (sum, job) =>
      sum +
      (Number.isFinite(job)
        ? offsetCost(job, rate.first1000, rate.additional1000)
        : 0),
    0,
  );
}

/**
 * One itemized printing line (round 10, client 5-Aug: "printing need to know
 * the split — standard printing costs / additional 1000 sheets (if any)").
 * Offset is billed as a plate fee for the first 1000 sheets plus a block fee
 * per additional 1000, but only the collapsed total ever surfaced.
 */
export interface PrintingDetailLine {
  label: string;
  amount: number;
  /** Sheets this tier covers. Σ over a job's lines === that job's sheets. */
  sheets: number;
  tier: "first1000" | "additional1000" | "digital";
}

/**
 * The tier breakdown behind `layerPrintingCost` for one wrap layer.
 *
 * MUST mirror layerPrintingCost's branching exactly — same digital/offset
 * split, same `!perJob || components.length <= 1` condition, same
 * non-finite-job skip — so `Σ lines.amount` reproduces the charged total.
 * Deliberately NOT refactored into a shared "compute lines then sum" helper:
 * float addition is not associative, and layerPrintingCost's existing
 * per-job summation order is what every saved estimate was costed with.
 * The duplication is the price of leaving a costed path untouched.
 */
function layerPrintingLines(
  rate: PrintingRate | undefined,
  layer: MaterialEstimate | undefined,
  perJob: boolean,
): PrintingDetailLine[] {
  const printSheets = layer?.totalSheets ?? 0;
  if (!rate || printSheets <= 0 || !Number.isFinite(printSheets)) return [];
  if (rate.mode === "digital") {
    return [
      {
        label: `Digital · ${printSheets} sheets`,
        amount: printSheets * rate.costPerSheet,
        sheets: printSheets,
        tier: "digital",
      },
    ];
  }
  if (rate.mode !== "offset") return []; // "none": special paper, no print cost

  const jobs =
    !perJob || !layer || layer.components.length <= 1
      ? [printSheets]
      : layerPrintJobs(layer);

  const lines: PrintingDetailLine[] = [];
  const many = jobs.length > 1;
  jobs.forEach((job, i) => {
    if (!Number.isFinite(job) || job <= 0) return;
    const plate = many ? `Plate ${i + 1} — ` : "";
    lines.push({
      label: `${plate}first 1000 sheets`,
      amount: rate.first1000,
      sheets: Math.min(job, 1000),
      tier: "first1000",
    });
    if (job > 1000) {
      const runs = Math.ceil((job - 1000) / 1000);
      lines.push({
        label: `${plate}additional ${job - 1000} sheets (${runs} × 1000)`,
        amount: runs * rate.additional1000,
        sheets: job - 1000,
        tier: "additional1000",
      });
    }
  });
  return lines;
}

function sheetArea(sheet: { width_in: number; height_in: number }): number {
  return sheet.width_in * sheet.height_in;
}

/** One itemized finishing line (round 6 — repeated client ask). */
export interface FinishingDetailLine {
  label: string;
  amount: number;
}

const FINISHING_KIND_LABELS: Record<FinishingRate["kind"], string> = {
  lamination: "Lamination",
  foiling: "Foiling",
  uv: "UV",
  relief: "Emboss/deboss",
};

/** Display label: "Foiling gold (matte)" / "Lamination matte" / kind-only when
 *  the snapshot predates round 6 (no key stored). */
function finishingLabel(f: FinishingRate): string {
  let label = FINISHING_KIND_LABELS[f.kind];
  if (f.key) label += ` ${f.key}`;
  if (f.finish) label += ` (${f.finish})`;
  return label;
}

/**
 * Itemized cost of a set of finishing passes — one line per pass. Whole-sheet
 * finishes (lamination, full UV, drip-off, aquas) run the printed sheets →
 * `wholeSheetArea` (printed sheets × sheet area) × rate. Per-sq-inch finishes
 * (foiling, spot UV, relief/emboss) charge `designAreaSqIn × itemCount × rate`,
 * where itemCount is the number of finished pieces (box quantity for a wrap;
 * quantity × pieces-per-box for a foam cover). Shared by the outer wrap, inner
 * liner, and foam cover; summing the lines reproduces the old single total
 * exactly (same terms, same order).
 */
function finishingDetailLines(
  finishes: FinishingRate[] | undefined,
  wholeSheetArea: number,
  itemCount: number,
): FinishingDetailLine[] {
  const lines: FinishingDetailLine[] = [];
  for (const f of finishes ?? []) {
    let amount: number;
    if (f.kind === "lamination") {
      amount = (wholeSheetArea * f.ratePer100sqin) / 100;
    } else if (f.kind === "foiling" || f.kind === "relief") {
      amount = f.designAreaSqIn * itemCount * f.ratePerSqin;
    } else {
      // UV: per_100sqin = whole-sheet (full UV, drip-off, aquas); per_sqin = spot UV.
      amount =
        f.unit === "per_100sqin"
          ? (wholeSheetArea * f.rate) / 100
          : (f.designAreaSqIn ?? 0) * itemCount * f.rate;
    }
    lines.push({ label: finishingLabel(f), amount });
  }
  return lines;
}

/** Summed finishing cost (the pre-round-6 single number). */
function finishingCost(
  finishes: FinishingRate[] | undefined,
  wholeSheetArea: number,
  itemCount: number,
): number {
  return finishingDetailLines(finishes, wholeSheetArea, itemCount).reduce(
    (total, l) => total + l.amount,
    0,
  );
}

// --- Engine ---------------------------------------------------------------

export function estimateCost(
  mat: MaterialQuantities,
  rates: CostRates,
): CostBreakdown {
  const qty = mat.quantity;

  // 1. Board
  const board = mat.board.totalSheets * rates.boardCostPerSheet;

  // 2/3/4/5. Wrap layers. Per-component wrapping (client item 2) splits a
  // layer into GROUPS of identically-wrapped components, each its own paper
  // purchase, print job and finishing pass. With no overrides there is exactly
  // one group and every sum below collapses to the pre-round-7 single term.
  const outerGroupList = wrapGroupsOf(mat, "outer");
  const innerGroupList = wrapGroupsOf(mat, "inner");
  const outerRateAt = (i: number): WrapGroupRate =>
    rates.outerGroups?.[i] ?? {
      paperCostPerSheet: rates.outerPaperCostPerSheet,
      printing: rates.printing,
      finishing: rates.finishing,
    };
  const innerRateAt = (i: number): WrapGroupRate =>
    rates.innerGroups?.[i] ?? {
      paperCostPerSheet: rates.innerPaperCostPerSheet,
      printing: rates.innerPrinting,
      finishing: rates.innerFinishing,
    };

  // Paper: when printing drives the paper size (purchase present) buy stock
  // sheets — several prints can be cut from one sheet (e.g. two 18x25 prints
  // per 25x36); otherwise sheets = nested sheets.
  const outerPaper = outerGroupList.reduce((sum, g, i) => {
    const rate = outerRateAt(i).paperCostPerSheet;
    if (!rate) return sum;
    return sum + (g.purchase?.sheetsToBuy ?? g.material.totalSheets) * rate;
  }, 0);

  // Inner lining paper (same purchase rule as outer).
  const innerPaper = innerGroupList.reduce((sum, g, i) => {
    const rate = innerRateAt(i).paperCostPerSheet;
    if (!rate) return sum;
    return sum + (g.purchase?.sheetsToBuy ?? g.material.totalSheets) * rate;
  }, 0);

  // Printing — per-job (round 6) = one offset tier per shared-sheet group /
  // lone component; legacy = one job per layer. Each WRAP group is its own
  // design, so its plate fees are charged independently.
  const perJob = rates.perJobPrinting === true;
  const printing = outerGroupList.reduce(
    (sum, g, i) => sum + layerPrintingCost(outerRateAt(i).printing, g.material, perJob),
    0,
  );
  const innerPrinting = innerGroupList.reduce(
    (sum, g, i) => sum + layerPrintingCost(innerRateAt(i).printing, g.material, perJob),
    0,
  );

  // Tier itemisation for the two totals above (round 10). Tagged per wrap group
  // exactly like groupFinishing, so a per-component wrap says WHICH part each
  // plate belongs to. Purely additive — `printing` / `innerPrinting` above are
  // untouched, and Σ these lines reproduces them.
  const groupPrinting = (
    list: WrapGroupEstimate[],
    rateAt: (i: number) => WrapGroupRate,
  ): PrintingDetailLine[] =>
    list.flatMap((g, i) => {
      const lines = layerPrintingLines(rateAt(i).printing, g.material, perJob);
      if (list.length <= 1 || g.components.length === 0) return lines;
      const tag = g.components.map((c) => c.replace(/_/g, " ")).join(", ");
      return lines.map((l) => ({ ...l, label: `${l.label} (${tag})` }));
    });
  const printingDetail = groupPrinting(outerGroupList, outerRateAt);
  const innerPrintingDetail = groupPrinting(innerGroupList, innerRateAt);

  // Finishing. Whole-sheet finishes (lamination, full UV, drip-off, aquas) =
  // printed sheets x full sheet area (the laminator runs whole sheets).
  // Per-sq-inch finishes (foiling, spot UV, relief/emboss) each carry their own
  // designAreaSqIn from the per-item input (or box footprint default). With
  // several wrap groups, each line is tagged with its components so the
  // breakdown says WHICH part it belongs to.
  const groupFinishing = (
    list: WrapGroupEstimate[],
    rateAt: (i: number) => WrapGroupRate,
  ): FinishingDetailLine[] =>
    list.flatMap((g, i) => {
      const area = g.material.totalSheets * sheetArea(g.material.sheet);
      const lines = finishingDetailLines(rateAt(i).finishing, area, qty);
      if (list.length <= 1 || g.components.length === 0) return lines;
      const tag = g.components.map((c) => c.replace(/_/g, " ")).join(", ");
      return lines.map((l) => ({ ...l, label: `${l.label} (${tag})` }));
    });

  const finishingDetail = groupFinishing(outerGroupList, outerRateAt);
  const finishing = finishingDetail.reduce((s, l) => s + l.amount, 0);
  const innerFinishingDetail = groupFinishing(innerGroupList, innerRateAt);
  const innerFinishing = innerFinishingDetail.reduce((s, l) => s + l.amount, 0);

  // 6. Inserts — foam(s) + reverse board (+ its top paper).
  // Each foam is priced with its own rate (aligned by index). A cover adds its
  // paper cost (purchased sheets — several prints may cut from one stock sheet)
  // and, when printed, the printing cost on the printed sheet count — the same
  // model as the outer/inner wrap.
  let foam = 0;
  // Itemisation (client final doc item 11: "if foam with card — size, card
  // type, number of sheets, total printing cost breakdown"). The foam total is
  // unchanged; these lines split it so the breakdown can show where it went.
  // Summing every amount reproduces `foam` exactly.
  const foamDetail: FinishingDetailLine[] = [];
  (mat.foams ?? []).forEach((f, i, all) => {
    const r = rates.foams?.[i];
    if (!r) return;
    const tag = all.length > 1 ? ` ${i + 1}` : "";
    const add = (label: string, amount: number) => {
      foam += amount;
      if (amount) foamDetail.push({ label, amount });
    };
    add(`Foam${tag}`, f.sheetsNeeded * r.costPerSheet);
    if (f.cover && r.cover) {
      const coverSheetsToBuy = f.cover.purchase?.sheetsToBuy ?? f.cover.sheetsNeeded;
      add(`Foam${tag} cover stock`, coverSheetsToBuy * r.cover.paperCostPerSheet);
      const cp = r.cover.printing;
      if (cp && f.cover.sheetsNeeded > 0) {
        if (cp.mode === "digital")
          add(`Foam${tag} cover printing`, f.cover.sheetsNeeded * cp.costPerSheet);
        else if (cp.mode === "offset")
          add(
            `Foam${tag} cover printing`,
            offsetCost(f.cover.sheetsNeeded, cp.first1000, cp.additional1000),
          );
      }
      // Finishing on the cover (client 7-Jul). Whole-sheet finishes run the
      // printed cover sheets; per-sq-inch finishes charge per finished piece
      // (qty × pieces-per-box = top and/or bottom).
      const coverWholeSheetArea = f.cover.sheetsNeeded * sheetArea(f.cover.sheet);
      add(
        `Foam${tag} cover finishing`,
        finishingCost(r.cover.finishing, coverWholeSheetArea, qty * f.cover.piecesPerBox),
      );
    }
  });
  const reverseBoard =
    mat.reverseBoard && rates.reverseBoardCostPerSheet
      ? mat.reverseBoard.board.totalSheets * rates.reverseBoardCostPerSheet
      : 0;
  const topPaper =
    mat.reverseBoard?.topPaper && rates.topPaperCostPerSheet
      ? mat.reverseBoard.topPaper.totalSheets * rates.topPaperCostPerSheet
      : 0;
  // Custom card insert — manual open cost entered per order.
  const card = rates.cardCost ?? 0;

  // 6c. Round-5 inserts (client 13-Jul; sleeve reworked round 6).
  // Card-stock inserts: purchased stock sheets + printing (one job each — an
  // insert is a single design/plate) + finishing on the printed-sheet area.
  // The sleeve is card stock too (client 15-Jul: "not kappa board"), with full
  // finishing where beading/partitions allow lamination only.
  const cardInsertCost = (
    est: MaterialQuantities["beading"],
    r: CardStockCostRate | undefined,
    piecesPerBox: number,
  ): number => {
    if (!est || !r) return 0;
    let cost = (est.purchase?.sheetsToBuy ?? est.paper.totalSheets) * r.paperCostPerSheet;
    const p = r.printing;
    const printSheets = est.paper.totalSheets;
    if (p && printSheets > 0) {
      if (p.mode === "digital") cost += printSheets * p.costPerSheet;
      else if (p.mode === "offset") cost += offsetCost(printSheets, p.first1000, p.additional1000);
    }
    cost += finishingCost(r.finishing, printSheets * sheetArea(est.paper.sheet), qty * piecesPerBox);
    return cost;
  };
  const beadingPieces = mat.beading?.blanks.reduce((s, b) => s + b.count_per_box, 0) ?? 0;
  const partitionPieces = mat.cardPartitions?.blanks.reduce((s, b) => s + b.count_per_box, 0) ?? 0;
  const customPieces = mat.customPartition?.blanks.reduce((s, b) => s + b.count_per_box, 0) ?? 0;
  const sleeve = cardInsertCost(mat.sleeve, rates.sleeve, 1);
  const beading = cardInsertCost(mat.beading, rates.beading, beadingPieces);
  const cardPartition = cardInsertCost(mat.cardPartitions, rates.cardPartitions, partitionPieces);
  const customPartition = cardInsertCost(mat.customPartition, rates.customPartition, customPieces);

  // 6b. Customisation add-ons (doc 2026-06-19) — Level-1 RM (overhead + margin apply).
  // Handles/locks = total count x per-each rate; window = nested film sheets x rate.
  const handles = mat.addons.handles * (rates.handleEach ?? 0);
  const locks = mat.addons.locks * (rates.lockEach ?? 0);
  const window =
    mat.addons.window && rates.windowCostPerSheet
      ? mat.addons.window.sheetsNeeded * rates.windowCostPerSheet
      : 0;
  // Miscellaneous add-ons (client 8-Jul) — manual amounts, summed as one RM line.
  const addonsMisc = (rates.addonsMisc ?? []).reduce((s, m) => s + m.amount, 0);

  // 7. Accessories (magnets, washers, tape, ribbon tag).
  // Tape: use the open-input override when given (e.g. collapsible — rate varies),
  // else the auto per-tray/lid computation.
  const a = mat.accessories;
  const tape =
    rates.tapeCostOverride != null
      ? rates.tapeCostOverride
      : a.tape * rates.accessories.tapePerUnit;
  const accessories: AccessoryCost = {
    magnets: a.magnets * rates.accessories.magnetEach,
    washers: a.washers * rates.accessories.washerEach,
    tape,
    ribbonTag: a.ribbonTag * (rates.ribbonTagEach ?? 0),
    total: 0,
  };
  accessories.total =
    accessories.magnets +
    accessories.washers +
    accessories.tape +
    accessories.ribbonTag;

  // 8. Fixed RM manual costs (glue + metlock, per order).
  const glue = rates.glueCost ?? 0;
  const metlock = rates.metlockCost ?? 0;

  // Step 2 — Labour (sum of lines).
  const labourComputed = rates.labour.reduce((sum, l) => sum + l.rate * l.quantity, 0);

  // --- Manual line edits (item 9) ------------------------------------------
  // Applied BEFORE the Level-1 sum, so overhead and margin recalculate on the
  // edited base. With no adjustments every value below is the computed one and
  // this whole block is a no-op — pre-existing estimates are byte-identical.
  const lines = {
    board, outerPaper, innerPaper, printing, innerPrinting, finishing, innerFinishing,
    foam, reverseBoard, topPaper, card, sleeve, beading, cardPartition, customPartition,
    handles, locks, window, addonsMisc,
    accessories: accessories.total,
    glue, metlock,
    labour: labourComputed,
  } satisfies Record<AdjustableLine, number>;

  const adjustments: AppliedAdjustment[] = [];
  for (const a of rates.adjustments ?? []) {
    const computed = lines[a.line];
    // Unknown line, or a non-finite/negative target, is ignored rather than
    // poisoning the total — build-estimate rejects these before they get here.
    if (computed == null || !Number.isFinite(a.to) || a.to < 0) continue;
    lines[a.line] = a.to;
    // Stale = the line computes to something else now than when the edit was
    // made, i.e. the specs moved underneath an absolute amount. Sub-cent
    // differences are float noise, not a real change.
    const stale =
      a.basis != null && Number.isFinite(a.basis) && Math.abs(a.basis - computed) > 0.005;
    adjustments.push({
      line: a.line,
      computed,
      applied: a.to,
      delta: a.to - computed,
      note: a.note,
      ...(stale ? { stale: true } : {}),
    });
  }
  // The accessory sub-rows (magnets/washers/tape/ribbon) keep their computed
  // values; only the group total the breakdown charges on is edited.
  if (lines.accessories !== accessories.total) accessories.total = lines.accessories;

  const materialSubtotal =
    lines.board +
    lines.outerPaper +
    lines.innerPaper +
    lines.printing +
    lines.innerPrinting +
    lines.finishing +
    lines.innerFinishing +
    lines.foam +
    lines.reverseBoard +
    lines.topPaper +
    lines.card +
    lines.sleeve +
    lines.beading +
    lines.cardPartition +
    lines.customPartition +
    lines.handles +
    lines.locks +
    lines.window +
    lines.addonsMisc +
    lines.accessories +
    lines.glue +
    lines.metlock;

  const labour = lines.labour;

  const level1 = materialSubtotal + labour;

  // Step 3 — Overhead: % of Level 1 (RM + labour).
  const overhead = (level1 * rates.overheadPct) / 100;
  const costBeforeMargin = level1 + overhead; // Level 2

  // Step 4 — Margin: % of Level 2.
  const margin = (costBeforeMargin * rates.marginPct) / 100;
  const subtotalAfterMargin = costBeforeMargin + margin;

  // Step 5 — Additional charges (manual, no margin). Die/mould/block shown separately on PDF.
  const additional: AdditionalCost = {
    die: rates.additional?.die ?? 0,
    mould: rates.additional?.mould ?? 0,
    block: rates.additional?.block ?? 0,
    designer: rates.additional?.designer ?? 0,
    total: 0,
  };
  additional.total =
    additional.die + additional.mould + additional.block + additional.designer;

  // Pre-GST total (GST applied at quotation / Phase 8).
  // Per-box rate is quoted against the ORDERED quantity while every cost above
  // was computed on the PRODUCTION quantity (client item 3), so the wastage
  // boxes are paid for by the order. Absent orderedQuantity = quote per
  // produced box, the pre-round-7 behaviour.
  const total = subtotalAfterMargin + additional.total;
  const orderedQty =
    rates.orderedQuantity != null && rates.orderedQuantity > 0
      ? rates.orderedQuantity
      : qty;
  // Client 28-Jul: one-time charges may be quoted as their own line instead of
  // being divided into every box. `total` is the whole pre-GST figure either
  // way (estimates.total_price stores it) — only this numerator moves.
  const perBoxBase =
    rates.additionalMode === "separate" ? subtotalAfterMargin : total;
  const pricePerBox = orderedQty > 0 ? perBoxBase / orderedQty : 0;

  return {
    // Spread the (possibly edited) Level-1 lines so the breakdown always shows
    // what was actually charged; `adjustments` carries the original figures.
    ...lines,
    accessories,
    ...(finishingDetail.length ? { finishingDetail } : {}),
    ...(innerFinishingDetail.length ? { innerFinishingDetail } : {}),
    ...(printingDetail.length ? { printingDetail } : {}),
    ...(innerPrintingDetail.length ? { innerPrintingDetail } : {}),
    ...(foamDetail.length ? { foamDetail } : {}),
    ...(adjustments.length ? { adjustments } : {}),
    materialSubtotal,
    labour,
    level1,
    overhead,
    costBeforeMargin,
    margin,
    subtotalAfterMargin,
    additional,
    // Omitted (not emitted as undefined) when unset, so a pre-28-Jul snapshot
    // recomputes byte-identically.
    ...(rates.additionalMode ? { additionalMode: rates.additionalMode } : {}),
    total,
    pricePerBox,
    productionQuantity: qty,
    orderedQuantity: orderedQty,
  };
}
