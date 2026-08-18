// Round 5 — PURE core of the auto-economical printing pick (client 13-Jul) +
// the shared printed-paper wastage tier helpers. No DB, no server-only: this
// module is imported by build-estimate (tiers), by the server-side
// resolveAutoPrinting (lib/estimate/auto-printing.ts), and directly by
// scripts/validate-round5.ts, which checks chooseBestPrinting against a
// brute-force enumeration. Keeping it dependency-free also breaks what would
// otherwise be an import cycle (build-estimate -> auto-printing -> tiers).

import {
  derivePaperPurchase,
  estimatePaperMaterial,
  type MaterialEstimate,
  type Sheet,
} from "@/lib/engines/material";
import { layerPrintJobs, offsetCost, type PrintingRate } from "@/lib/engines/cost";
import { EstimateError } from "@/lib/estimate/errors";
import type { Blank, EstimateRequest } from "@/types";

// --- quantities ------------------------------------------------------------

/**
 * Boxes actually produced (client final doc item 3). The request's `quantity`
 * is what the customer ORDERED; `productionQuantity` adds the wastage run
 * (order 100 -> produce 105). Everything the engines compute runs on THIS;
 * only the final per-box rate divides by the ordered quantity. A missing or
 * smaller value falls back to the order, so every pre-round-7 snapshot nests
 * and costs exactly as it always did.
 *
 * Lives here (pure, no server-only) because both buildMaterialInput and the
 * auto-printing evaluator need it and must agree — importing it from
 * build-estimate would create a cycle.
 */
export function productionQuantity(req: EstimateRequest): number {
  const p = req.productionQuantity;
  return typeof p === "number" && Number.isFinite(p) && p > req.quantity
    ? p
    : req.quantity;
}

// --- printed-paper wastage tiers (shared: real run + candidate evaluation) ---

/**
 * Printed-paper wastage tier for the OUTER wrap (client review 2026-06: +10%
 * printing only, +15% printing + foiling/UV; the per-estimate override wins).
 * Used by buildMaterialInput AND the auto-printing evaluator, so a candidate's
 * nesting is inflated exactly like the real run's.
 */
export function outerWastagePct(
  req: EstimateRequest,
  printPct: number,
  foilPct: number,
): number {
  const outerSel = req.wrapping?.outer;
  if (outerSel?.mode !== "printed") return 0;
  if (outerSel.wastagePctOverride != null) return outerSel.wastagePctOverride;
  const hasFoilOrUv = (req.finishing ?? []).some(
    (f) => f.kind === "foiling" || f.kind === "uv",
  );
  return hasFoilOrUv ? foilPct : printPct;
}

/** Same tier rule for the PRINTED inner lining (keys off the INNER's finishing). */
export function innerWastagePctOf(
  req: EstimateRequest,
  printPct: number,
  foilPct: number,
): number {
  const innerSel = req.wrapping?.inner;
  const innerIsPrinted =
    innerSel != null &&
    innerSel.mode !== "special" &&
    innerSel.mode !== "white" &&
    innerSel.printing != null;
  if (!innerIsPrinted) return 0;
  const hasFoilOrUv = (innerSel.finishing ?? []).some(
    (f) => f.kind === "foiling" || f.kind === "uv",
  );
  return hasFoilOrUv ? foilPct : printPct;
}

// --- candidate shapes -------------------------------------------------------

/** One printing rate row, as a candidate for the economical pick. */
export interface PrintCandidate {
  sizeLabel: string;
  printSheet: Sheet;
  rate: PrintingRate;
  /** Round 10: which printer quoted this row. Absent = the un-named default. */
  vendor?: string;
}

/** One paper stock row the winning print could be cut from. */
export interface PaperCandidate {
  sizeLabel: string;
  sheet: Sheet;
  costPerSheet: number;
}

/** What the auto pick chose for one wrap layer (recorded in rates_snapshot). */
export interface AutoPick {
  layer: "outer" | "inner";
  sizeLabel: string;
  paperSizeLabel: string;
  considered: number;
  /** Round 10: the winning row's printer, when it names one. */
  vendor?: string;
}

export interface AutoEvalInput {
  /** Board blanks of the box (the wrap blanks derive from them). */
  blanks: Blank[];
  quantity: number;
  layer: "outer" | "inner";
  /** Outer: folding allowance mm. Inner: lining reduction (0). */
  allowance_mm: number;
  wastagePct: number;
  overrides: Record<string, "A" | "B">;
  combine: boolean;
  mixed: boolean;
  /** Per-job offset charging (round 6): one plate fee per print job. */
  perJobPrinting: boolean;
  /** Printed-layer tie consolidation (round 6): a sheet tie saves a plate. */
  consolidateTies: boolean;
  candidates: PrintCandidate[];
  papers: PaperCandidate[];
}

export interface AutoWinner {
  candidate: PrintCandidate;
  paper: PaperCandidate;
  total: number;
  /** Feasible (print × paper) pairs that were compared. */
  considered: number;
}

// --- evaluation -------------------------------------------------------------

/** Does `piece` fit inside `sheet` in either orientation? */
function fits(piece: Sheet, sheet: Sheet): boolean {
  return (
    (piece.width_in <= sheet.width_in && piece.height_in <= sheet.height_in) ||
    (piece.height_in <= sheet.width_in && piece.width_in <= sheet.height_in)
  );
}

/** Printing cost of one candidate — mirrors Engine 2's per-layer logic
 *  (layerPrintingCost in cost.ts), sharing layerPrintJobs so the evaluator
 *  genuinely trades plate count against paper cost. */
function printingCostOf(
  rate: PrintingRate,
  layerEst: MaterialEstimate,
  perJob: boolean,
): number {
  const sheets = layerEst.totalSheets;
  if (rate.mode === "digital") return sheets * rate.costPerSheet;
  if (rate.mode !== "offset") return 0;
  if (!perJob || layerEst.components.length <= 1) {
    return offsetCost(sheets, rate.first1000, rate.additional1000);
  }
  return layerPrintJobs(layerEst).reduce(
    (sum, job) =>
      sum +
      (Number.isFinite(job)
        ? offsetCost(job, rate.first1000, rate.additional1000)
        : 0),
    0,
  );
}

const area = (s: Sheet) => s.width_in * s.height_in;
const EPS = 1e-9;

/**
 * Pick the cheapest (printing size × paper size) pair for one wrap layer.
 * Every candidate is nested through the SAME engine path as the real run
 * (wastage inflation included), so the winner's numbers are exactly what the
 * estimate will charge. Ties break to the smaller print area, then the smaller
 * paper area (less press + less stock for the same money — deterministic).
 * Throws when NO pair is feasible.
 */
export function chooseBestPrinting(input: AutoEvalInput): AutoWinner {
  let best: AutoWinner | null = null;
  let considered = 0;

  for (const candidate of input.candidates) {
    // --- cheap screens, before the expensive nesting run --------------------
    //
    // estimatePaperMaterial() carries the full combination search (set
    // partitions x guillotine directions x orientation masks x band recursion)
    // and runs ONCE PER CANDIDATE. With a handful of seeded sizes that was
    // free; per-business sheet catalogues make it the hot loop, so the two
    // conditions that provably rule a candidate out are tested by rectangle
    // arithmetic first.
    //
    // Neither prunes a candidate that could have won:
    //   1. a blank that does not fit the print sheet makes totalSheets
    //      Infinity, which the `continue` below already discards — the nesting
    //      run can only confirm it, at full cost;
    //   2. a print sheet no paper can take never reaches the inner loop, since
    //      every pairing fails the same `fits` test used there.
    if (
      !input.blanks.every((b) =>
        fits({ width_in: b.width_in, height_in: b.height_in }, candidate.printSheet),
      )
    ) {
      continue;
    }
    if (!input.papers.some((paper) => fits(candidate.printSheet, paper.sheet))) continue;

    // Nest the wrap blanks on this print size. Infinite sheets = doesn't fit.
    const est = estimatePaperMaterial(
      input.blanks,
      input.quantity,
      candidate.printSheet,
      input.layer,
      input.allowance_mm,
      input.overrides,
      input.wastagePct,
      input.combine,
      input.mixed,
      input.consolidateTies,
    );
    if (!Number.isFinite(est.totalSheets)) continue;

    for (const paper of input.papers) {
      if (!fits(candidate.printSheet, paper.sheet)) continue;
      considered++;

      const purchase = derivePaperPurchase(candidate.printSheet, paper.sheet, est.totalSheets);
      const total =
        printingCostOf(candidate.rate, est, input.perJobPrinting) +
        purchase.sheetsToBuy * paper.costPerSheet;

      let better = false;
      if (!best || total < best.total - EPS) {
        better = true;
      } else if (Math.abs(total - best.total) <= EPS) {
        const dPrint = area(candidate.printSheet) - area(best.candidate.printSheet);
        if (dPrint < -EPS) better = true;
        else if (Math.abs(dPrint) <= EPS) {
          const dPaper = area(paper.sheet) - area(best.paper.sheet);
          if (dPaper < -EPS) better = true;
          // Round 10: two vendors can quote an identical price for an identical
          // size. Break that on vendor name so the winner never depends on row
          // order — without this the pick could differ between two runs of the
          // same estimate. Un-named rows sort first (they are the default).
          else if (Math.abs(dPaper) <= EPS)
            better = (candidate.vendor ?? "") < (best.candidate.vendor ?? "");
        }
      }
      if (better) best = { candidate, paper, total, considered: 0 };
    }
  }

  if (!best) {
    throw new EstimateError(
      `No ${input.layer} printing size can fit these blanks on any available paper ` +
        `sheet at the chosen GSM. Check the box dimensions, or add larger ` +
        `printing/paper sizes on the Rates page.`,
    );
  }
  return { ...best, considered };
}
