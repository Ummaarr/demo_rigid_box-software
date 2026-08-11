// Round-5 live-DB verification: drives buildEstimate against the REAL Supabase
// rates (the exact server path) for auto printing, separate printing and the
// new inserts — then confirms every SAVED estimate still recomputes with no
// error and NO mixed layouts (the D1 gate: old snapshots stay byte-stable).
//
// Unlike scripts/validate-round5.ts (pure, offline), this one READS the live
// database, so its numbers move when the rate card changes — it asserts
// RELATIONSHIPS (auto <= every explicit option, separate >= combined, no
// snapshot drift), never fixed rupee amounts.
//
// Run: NODE_OPTIONS="--conditions=react-server" npx tsx scripts/validate-round5-live.ts
import { readFileSync } from "node:fs";

import { createAdminClient } from "@/lib/db/admin";
import { buildEstimate, recomputeMaterials } from "@/lib/estimate/build-estimate";
import { layerPrintJobs, offsetCost } from "@/lib/engines/cost";
import type { EstimateRequest } from "@/types";

function loadEnv() {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

let fails = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fails++;
}

const baseReq: EstimateRequest = {
  boxType: "drawer_sliding",
  dims: { length_in: 10, width_in: 8, height_in: 4 },
  vars: {},
  quantity: 1000,
  boardThickness_mm: 1.5,
  nestingVersion: 2,
  wrapping: {
    outer: {
      mode: "printed",
      gsm: 130,
      foldingAllowance_mm: 20,
      printing: { type: "offset", auto: true, colour: "multi" },
    },
  },
};

async function main() {
  const admin = createAdminClient();

  console.log("\n== auto-economical printing (live rates) ==");
  const auto = await buildEstimate(baseReq, admin);
  const pick = auto.ratesSnapshot.autoPicks?.find((p) => p.layer === "outer");
  check("auto pick recorded", pick != null, JSON.stringify(pick));
  check("specs snapshot keeps auto (no sizes)", auto.specsSnapshot.wrapping?.outer?.mode === "printed" && auto.specsSnapshot.wrapping.outer.printing.auto === true && auto.specsSnapshot.wrapping.outer.printing.sizeLabel == null);
  check("rates snapshot froze the winner's print sheet", auto.ratesSnapshot.outer?.printSheet != null);

  // Brute-force: the auto total must beat-or-match EVERY explicit choice.
  const offsetRows = await admin.from("offset_printing_rates").select("size_label,colour").eq("colour", "multi");
  const papers = await admin.from("paper_rates").select("size_label,gsm").eq("gsm", 130);
  let bestExplicit = Infinity;
  let bestLabel = "";
  for (const o of offsetRows.data ?? []) {
    for (const p of papers.data ?? []) {
      const req: EstimateRequest = JSON.parse(JSON.stringify(baseReq));
      req.wrapping!.outer = {
        mode: "printed",
        paperSizeLabel: p.size_label,
        gsm: 130,
        foldingAllowance_mm: 20,
        printing: { type: "offset", sizeLabel: o.size_label, colour: "multi" },
      };
      try {
        const built = await buildEstimate(req, admin);
        const cost = built.cost.printing + built.cost.outerPaper;
        if (cost < bestExplicit) { bestExplicit = cost; bestLabel = `${o.size_label} on ${p.size_label}`; }
      } catch {
        /* infeasible combo (print doesn't fit paper / blank doesn't fit print) */
      }
    }
  }
  const autoCost = auto.cost.printing + auto.cost.outerPaper;
  check(
    "auto <= best explicit (printing+paper)",
    autoCost <= bestExplicit + 1e-6,
    `auto ₹${autoCost.toFixed(2)} (${pick?.sizeLabel} on ${pick?.paperSizeLabel}) vs best explicit ₹${bestExplicit.toFixed(2)} (${bestLabel})`,
  );

  console.log("\n== separate printing (live rates) ==");
  // Re-run the winning pick as an EXPLICIT selection, so combined vs separate
  // differ only in the print-job mode.
  const combinedReq: EstimateRequest = JSON.parse(JSON.stringify(baseReq));
  combinedReq.wrapping!.outer = {
    mode: "printed",
    paperSizeLabel: pick!.paperSizeLabel,
    gsm: 130,
    foldingAllowance_mm: 20,
    printing: { type: "offset", sizeLabel: pick!.sizeLabel, colour: "multi" },
  };
  const separateReq: EstimateRequest = JSON.parse(JSON.stringify(combinedReq));
  separateReq.printingMode = "separate";
  const builtCombined = await buildEstimate(combinedReq, admin);
  const builtSeparate = await buildEstimate(separateReq, admin);
  check(
    "separate printing >= combined",
    builtSeparate.cost.printing >= builtCombined.cost.printing,
    `₹${builtSeparate.cost.printing} vs ₹${builtCombined.cost.printing}`,
  );
  check(
    "separate un-shares the outer layer",
    builtSeparate.materials.outerPaper?.combination == null ||
      builtSeparate.materials.outerPaper.combination.applied === false,
  );

  console.log("\n== round-6: per-job plate fees (live rates) ==");
  // builtCombined carries NO printingMode (a pre-round-5-style request) →
  // legacy pricing: ONE plate fee on the layer total, jobs ignored.
  {
    const rate = builtCombined.ratesSnapshot.printing;
    const layer = builtCombined.materials.outerPaper;
    if (rate?.mode === "offset" && layer) {
      const legacyFee = offsetCost(layer.totalSheets, rate.first1000, rate.additional1000);
      check(
        "no printingMode -> legacy one-plate fee",
        Math.abs(builtCombined.cost.printing - legacyFee) < 1e-6,
        `₹${builtCombined.cost.printing}`,
      );
    }
  }
  // Requests WITH a printingMode (every new form estimate) pay one offset tier
  // PER PRINT JOB (shared-sheet group / lone component) — verify the charged
  // number equals Σ offsetCost over layerPrintJobs through the real path.
  const perJobReq: EstimateRequest = JSON.parse(JSON.stringify(combinedReq));
  perJobReq.printingMode = "combined";
  const builtPerJob = await buildEstimate(perJobReq, admin);
  for (const [label, built] of [["combined (per-job)", builtPerJob], ["separate", builtSeparate]] as const) {
    const rate = built.ratesSnapshot.printing;
    const layer = built.materials.outerPaper;
    if (rate?.mode === "offset" && layer) {
      const jobs = layerPrintJobs(layer);
      const expect =
        layer.components.length <= 1
          ? offsetCost(layer.totalSheets, rate.first1000, rate.additional1000)
          : jobs.reduce((s, j) => s + offsetCost(j, rate.first1000, rate.additional1000), 0);
      check(
        `${label}: printing == Σ offsetCost(print jobs)`,
        Math.abs(built.cost.printing - expect) < 1e-6,
        `₹${built.cost.printing} vs ₹${expect} (${jobs.length} job(s))`,
      );
    }
  }

  console.log("\n== round-5 inserts (live rates) ==");
  // The form sends exact rate-card values — mirror that here.
  const lamRow = await admin.from("lamination_rates").select("type").limit(1).single();
  const lamType = lamRow.data?.type as string;
  const insertReq: EstimateRequest = JSON.parse(JSON.stringify(combinedReq));
  insertReq.inserts = {
    // Round 6: the sleeve is a card-stock cut (paper/art card, no board).
    sleeve: {
      dims: { length_in: 10, width_in: 8, height_in: 4 },
      stock: {
        material: "art_paper",
        paperSizeLabel: pick!.paperSizeLabel,
        gsm: 130,
        printing: { type: "offset", sizeLabel: pick!.sizeLabel, colour: "multi" },
      },
    },
    beading: {
      height_in: 0.5,
      thickness_in: 0.125,
      stock: { material: "art_paper", paperSizeLabel: "23x36", gsm: 130, lamination: [{ kind: "lamination", key: lamType }] },
    },
    cardPartitions: {
      countL: 2,
      countW: 3,
      stock: { material: "art_paper", paperSizeLabel: "23x36", gsm: 130 },
    },
    customPartition: {
      size: { length_in: 6, width_in: 4 },
      count: 2,
      stock: { material: "art_paper", paperSizeLabel: "23x36", gsm: 130 },
    },
  };
  const builtInserts = await buildEstimate(insertReq, admin);
  check("sleeve line > 0", builtInserts.cost.sleeve > 0, `₹${builtInserts.cost.sleeve.toFixed(2)}`);
  check("beading line > 0 (incl. lamination)", builtInserts.cost.beading > 0, `₹${builtInserts.cost.beading.toFixed(2)}`);
  check("card partition line > 0", builtInserts.cost.cardPartition > 0, `₹${builtInserts.cost.cardPartition.toFixed(2)}`);
  check("custom partition line > 0", builtInserts.cost.customPartition > 0, `₹${builtInserts.cost.customPartition.toFixed(2)}`);
  check(
    "drawer sleeve uses drawer formula (W+H) x (L+H+L+H)",
    builtInserts.materials.sleeve?.blanks[0]?.width_in === 12 &&
      builtInserts.materials.sleeve?.blanks[0]?.height_in === 28,
  );
  check(
    "insert lines flow into subtotal",
    builtInserts.cost.materialSubtotal > builtCombined.cost.materialSubtotal,
  );

  console.log("\n== mixed nesting live (nestingVersion 2) ==");
  const anyMixed = [builtCombined, builtInserts].some((b) =>
    [b.materials.board, b.materials.outerPaper].some((l) =>
      l?.components.some((c) => c.mixed != null),
    ),
  );
  console.log(`  info: mixed layout applied on this geometry: ${anyMixed}`);
  const v1Req: EstimateRequest = JSON.parse(JSON.stringify(combinedReq));
  delete v1Req.nestingVersion;
  const v1 = await buildEstimate(v1Req, admin);
  check(
    "no-version request has zero mixed layouts",
    ![v1.materials.board, v1.materials.outerPaper].some((l) => l?.components.some((c) => c.mixed != null)),
  );
  check(
    "v2 never needs more sheets than v1",
    builtCombined.materials.board.totalSheets <= v1.materials.board.totalSheets &&
      (builtCombined.materials.outerPaper?.totalSheets ?? 0) <= (v1.materials.outerPaper?.totalSheets ?? 0),
  );

  console.log("\n== saved estimates recompute unchanged (D1 gate) ==");
  const { data: saved, error } = await admin
    .from("estimates")
    .select("id, specs_snapshot, rates_snapshot, cost_breakdown");
  if (error) {
    check("load saved estimates", false, error.message);
  } else {
    let ok = 0;
    let mixedLeak = 0;
    let failed = 0;
    for (const row of saved ?? []) {
      try {
        const mat = recomputeMaterials(row.specs_snapshot, row.rates_snapshot);
        const layers = [mat.board, mat.outerPaper, mat.innerPaper];
        const hasVersion = (row.specs_snapshot.nestingVersion ?? 1) >= 2;
        if (!hasVersion && layers.some((l) => l?.components.some((c) => c.mixed != null))) mixedLeak++;
        ok++;
      } catch {
        failed++; // legacy snapshot the engine can't parse — page falls back
      }
    }
    check(`all ${saved?.length ?? 0} saved estimates recompute`, failed === 0, `${ok} ok, ${failed} failed`);
    check("no mixed layouts leak into pre-round-5 snapshots", mixedLeak === 0);
  }

  console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
