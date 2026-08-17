// Round 5 (client 13-Jul): server-side half of the auto-economical printing
// pick — loads the candidate printing/paper rows from the DB and concretizes
// an `auto` request via the pure evaluator (lib/estimate/auto-printing-core).
//
// buildEstimate calls resolveAutoPrinting BEFORE loadEstimateRates: the
// request comes back with the winning sizeLabel + paperSizeLabel filled in, so
// the resolver, engines, print-fit check and snapshots all run unchanged — the
// winner is frozen in rates_snapshot exactly as if the user had picked it by
// hand, and recomputeMaterials stays deterministic. specs_snapshot keeps
// `auto`, so RE-RUNNING a saved estimate re-optimizes at that day's rates.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getBlanks } from "@/lib/formulas";
import { innerLiningBlanksFor } from "@/lib/formulas/inner-lining";
import { configValue } from "@/lib/db/rates";
import { EstimateError } from "@/lib/estimate/errors";
import {
  chooseBestPrinting,
  innerWastagePctOf,
  outerWastagePct,
  productionQuantity,
  type AutoPick,
  type PaperCandidate,
  type PrintCandidate,
} from "@/lib/estimate/auto-printing-core";
import type { EstimateRequest } from "@/types";

export type { AutoPick } from "@/lib/estimate/auto-printing-core";

// --- candidate loaders ------------------------------------------------------

async function loadPrintCandidates(
  supabase: SupabaseClient,
  type: "offset" | "digital",
  colour: "multi" | "single",
  ownerId: string | null,
  vendor?: string,
): Promise<PrintCandidate[]> {
  // Round 10: with a vendor chosen, Auto compares only that vendor's sizes.
  // With none, it compares EVERY row — including several vendors' — so the
  // pick genuinely weighs plate cost against paper cost across printers.
  // Owner-scoped (trial-role isolation) the same way lib/db/rates.ts's
  // row()/printRow() are: null = shared master card, a user id = that
  // trial user's own clone.
  if (type === "digital") {
    let q = supabase
      .from("digital_printing_rates")
      .select("size_label, cost_per_sheet, width_in, height_in, vendor");
    q = vendor ? q.eq("vendor", vendor) : q;
    q = ownerId == null ? q.is("owner_id", null) : q.eq("owner_id", ownerId);
    const { data, error } = await q;
    if (error) throw new EstimateError(`Could not load digital printing sizes: ${error.message}`);
    return (data ?? []).map((r) => ({
      sizeLabel: r.size_label,
      vendor: (r.vendor as string | null) ?? undefined,
      printSheet: { width_in: Number(r.width_in), height_in: Number(r.height_in) },
      rate: { mode: "digital", costPerSheet: Number(r.cost_per_sheet) },
    }));
  }

  // Offset: filter by colour; a pre-migration-offset-colour DB has no such
  // column (the filter errors) — retry unfiltered, exactly like rate-options.
  const cols = "size_label, first_1000, additional_1000, width_in, height_in, vendor";
  let q1 = supabase.from("offset_printing_rates").select(cols).eq("colour", colour);
  q1 = vendor ? q1.eq("vendor", vendor) : q1;
  q1 = ownerId == null ? q1.is("owner_id", null) : q1.eq("owner_id", ownerId);
  let res = await q1;
  if (res.error) {
    let q2 = supabase.from("offset_printing_rates").select(cols);
    q2 = vendor ? q2.eq("vendor", vendor) : q2;
    q2 = ownerId == null ? q2.is("owner_id", null) : q2.eq("owner_id", ownerId);
    res = await q2;
  }
  if (res.error) throw new EstimateError(`Could not load offset printing sizes: ${res.error.message}`);
  return (res.data ?? []).map((r) => ({
    sizeLabel: r.size_label,
    vendor: (r.vendor as string | null) ?? undefined,
    printSheet: { width_in: Number(r.width_in), height_in: Number(r.height_in) },
    rate: {
      mode: "offset",
      first1000: Number(r.first_1000),
      additional1000: Number(r.additional_1000),
    },
  }));
}

async function loadPaperCandidates(
  supabase: SupabaseClient,
  gsm: number,
  ownerId: string | null,
): Promise<PaperCandidate[]> {
  let q = supabase.from("paper_rates").select("size_label, cost_per_sheet, width_in, height_in").eq("gsm", gsm);
  q = ownerId == null ? q.is("owner_id", null) : q.eq("owner_id", ownerId);
  const { data, error } = await q;
  if (error) throw new EstimateError(`Could not load paper sizes: ${error.message}`);
  return (data ?? []).map((r) => ({
    sizeLabel: r.size_label,
    sheet: { width_in: Number(r.width_in), height_in: Number(r.height_in) },
    costPerSheet: Number(r.cost_per_sheet),
  }));
}

// --- request concretization -------------------------------------------------

/**
 * Replace `auto` printing selections on the (sections-applied) request with
 * the cheapest concrete sizeLabel + paperSizeLabel. Returns the original
 * request untouched when nothing is auto. `autoPicks` records what won (and
 * how many pairs were compared) for the UI and the rates_snapshot.
 */
export async function resolveAutoPrinting(
  supabase: SupabaseClient,
  req: EstimateRequest,
  ownerId: string | null,
): Promise<{ req: EstimateRequest; autoPicks: AutoPick[] }> {
  const outerSel = req.wrapping?.outer;
  const innerSel = req.wrapping?.inner;
  const outerAuto = outerSel?.mode === "printed" && outerSel.printing.auto === true;
  const innerAuto =
    innerSel != null &&
    innerSel.mode !== "special" &&
    innerSel.mode !== "white" &&
    innerSel.printing?.auto === true;
  if (!outerAuto && !innerAuto) return { req, autoPicks: [] };

  // Same config reads (and defaults) as loadEstimateRates.
  const [printPct, foilPct, configFolding] = await Promise.all([
    configValue(supabase, "app_config", "print_wastage_pct", ownerId),
    configValue(supabase, "app_config", "print_foil_wastage_pct", ownerId),
    configValue(supabase, "app_config", "folding_allowance_mm", ownerId),
  ]);
  const printWastage = printPct ?? 10;
  const foilWastage = foilPct ?? 15;

  const blanks = getBlanks(req.boxType, req.dims, req.vars ?? {});
  // The INNER layer nests the lining blanks, not the board keylines (round 10).
  // This must use the SAME gate and mapping as estimateMaterials, or the auto
  // pick would be priced on geometry the real run never uses.
  const liningBlanks =
    (req.liningVersion ?? 1) >= 2
      ? innerLiningBlanksFor(req.boxType, blanks, req.dims, req.vars ?? {})
      : blanks;
  // Same flags as buildMaterialInput/estimateMaterials use for the real run —
  // the candidate nesting must match it exactly or the pick could be wrong.
  const overrides = req.overrides ?? {};
  const combine = req.nestingMode !== "single" && req.printingMode !== "separate";
  const mixed = (req.nestingVersion ?? 1) >= 2;
  // Round 6: a printingMode on the request (every new form estimate) switches
  // on plate-aware nesting + per-job plate fees — both, atomically, exactly
  // like estimateMaterials + estimateCost will run.
  const perJobPrinting = req.printingMode != null;
  const consolidateTies = req.printingMode != null;

  const out: EstimateRequest = { ...req, wrapping: { ...req.wrapping } };
  const autoPicks: AutoPick[] = [];

  if (outerAuto && outerSel.mode === "printed") {
    const [candidates, papers] = await Promise.all([
      loadPrintCandidates(
        supabase,
        outerSel.printing.type,
        outerSel.printing.colour ?? "multi",
        ownerId,
        outerSel.printing.vendor,
      ),
      loadPaperCandidates(supabase, outerSel.gsm, ownerId),
    ]);
    const win = chooseBestPrinting({
      blanks,
      quantity: productionQuantity(req),
      layer: "outer",
      allowance_mm: outerSel.foldingAllowance_mm ?? configFolding ?? 20,
      wastagePct: outerWastagePct(req, printWastage, foilWastage),
      overrides,
      combine,
      mixed,
      perJobPrinting,
      consolidateTies,
      candidates,
      papers,
    });
    out.wrapping!.outer = {
      ...outerSel,
      paperSizeLabel: win.paper.sizeLabel,
      printing: {
        ...outerSel.printing,
        sizeLabel: win.candidate.sizeLabel,
        // Round 10: pin the WINNER's vendor onto the concretized request.
        // Without this the resolver would fall back to the un-named row and
        // could price a different rate than the evaluator compared. The key is
        // OMITTED when the winner has no vendor, so nothing changes for a DB
        // that has never named one.
        ...(win.candidate.vendor ? { vendor: win.candidate.vendor } : {}),
      },
    };
    autoPicks.push({
      layer: "outer",
      sizeLabel: win.candidate.sizeLabel,
      paperSizeLabel: win.paper.sizeLabel,
      considered: win.considered,
      ...(win.candidate.vendor ? { vendor: win.candidate.vendor } : {}),
    });
  }

  if (innerAuto && innerSel.printing) {
    const [candidates, papers] = await Promise.all([
      loadPrintCandidates(
        supabase,
        innerSel.printing.type,
        innerSel.printing.colour ?? "multi",
        ownerId,
        innerSel.printing.vendor,
      ),
      loadPaperCandidates(supabase, innerSel.gsm, ownerId),
    ]);
    const win = chooseBestPrinting({
      blanks: liningBlanks,
      quantity: productionQuantity(req),
      layer: "inner",
      allowance_mm: 0, // inner lining = the lining blank exactly (no allowance)
      wastagePct: innerWastagePctOf(req, printWastage, foilWastage),
      overrides,
      combine,
      mixed,
      perJobPrinting,
      consolidateTies,
      candidates,
      papers,
    });
    out.wrapping!.inner = {
      ...innerSel,
      paperSizeLabel: win.paper.sizeLabel,
      printing: {
        ...innerSel.printing,
        sizeLabel: win.candidate.sizeLabel,
        ...(win.candidate.vendor ? { vendor: win.candidate.vendor } : {}),
      },
    };
    autoPicks.push({
      layer: "inner",
      sizeLabel: win.candidate.sizeLabel,
      paperSizeLabel: win.paper.sizeLabel,
      considered: win.considered,
      ...(win.candidate.vendor ? { vendor: win.candidate.vendor } : {}),
    });
  }

  return { req: out, autoPicks };
}

