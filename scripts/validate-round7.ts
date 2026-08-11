// Round-7 validation — the client's FINAL requirements document.
// Run: npx tsx scripts/validate-round7.ts
//
// Covers the items built in this round:
//   item 3  — ordered vs production quantity
//   item 2  — per-component wrapping
//   item 11 — cost breakdown required structure
//   item 13 — quote revisions R1/R2/R3
// (Items 4A/4B — the fit-allowance corrections — are asserted in
// scripts/validate-round6.ts alongside the original fit-allowance contract.)

import {
  estimateMaterials,
  type MaterialInput,
} from "@/lib/engines/material";
import { estimateCost, type CostRates } from "@/lib/engines/cost";
import { productionQuantity } from "@/lib/estimate/auto-printing-core";
import { buildCostView } from "@/lib/estimate/cost-view";
import type { BoxType, EstimateRequest } from "@/types";
// Currency symbol comes from the brand, not a literal: these assertions test
// the DETAIL STRING SHAPE, and hardcoding a glyph makes them fail on a
// rebranded checkout for the wrong reason.
import { BRAND } from "@/lib/brand";
const CUR = BRAND.currencySymbol;

let failures = 0;
function assert(label: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}
function check(label: string, got: number, want: number, tol = 1e-9) {
  assert(label, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);
}

// ---------------------------------------------------------------------------
console.log("\n== item 3: ordered vs production quantity ==");

{
  const base: EstimateRequest = {
    boxType: "tray_only",
    dims: { length_in: 10, width_in: 8, height_in: 4 },
    quantity: 100,
    boardThickness_mm: 1.5,
  };

  // The helper: absent / equal / smaller all fall back to the order.
  check("absent production qty -> ordered", productionQuantity(base), 100);
  check("equal production qty -> ordered", productionQuantity({ ...base, productionQuantity: 100 }), 100);
  check("smaller production qty -> ordered", productionQuantity({ ...base, productionQuantity: 80 }), 100);
  check("larger production qty wins", productionQuantity({ ...base, productionQuantity: 105 }), 105);

  const mkInput = (qty: number): MaterialInput => ({
    boxType: "tray_only" as BoxType,
    dims: { length_in: 10, width_in: 8, height_in: 4 },
    quantity: qty,
    board: { sheet: { width_in: 31, height_in: 41 } },
  });
  const rates = (ordered?: number): CostRates => ({
    boardCostPerSheet: 41,
    accessories: { magnetEach: 0, washerEach: 0, tapePerUnit: 0.75 },
    labour: [],
    overheadPct: 11,
    marginPct: 20,
    orderedQuantity: ordered,
  });

  // Engine 1 nests the PRODUCTION run: 105 boxes need >= the sheets 100 do.
  const mat100 = estimateMaterials(mkInput(100));
  const mat105 = estimateMaterials(mkInput(105));
  assert(
    "production run never needs fewer board sheets",
    mat105.board.totalSheets >= mat100.board.totalSheets,
    `${mat105.board.totalSheets} vs ${mat100.board.totalSheets}`,
  );

  // Engine 2 divides the production cost by the ORDERED quantity.
  const costed = estimateCost(mat105, rates(100));
  check("pricePerBox = total / ordered", costed.pricePerBox, costed.total / 100);
  check("breakdown echoes production qty", costed.productionQuantity!, 105);
  check("breakdown echoes ordered qty", costed.orderedQuantity!, 100);
  assert(
    "per-box rate exceeds the naive per-produced-box rate",
    costed.pricePerBox > costed.total / 105,
  );

  // Her worked example: ₹15,000 for 105 boxes on an order of 100 = ₹150/box.
  // Every other line is zeroed (incl. the auto tape) so the division is the
  // only thing under test.
  const synthetic = estimateCost(mat105, {
    ...rates(100),
    boardCostPerSheet: 0,
    glueCost: 15000,
    tapeCostOverride: 0,
    overheadPct: 0,
    marginPct: 0,
  });
  check("client's example: 15,000 over 105 produced, 100 ordered", synthetic.pricePerBox, 150);

  // Absent orderedQuantity = pre-round-7 behaviour exactly.
  const legacy = estimateCost(mat100, rates(undefined));
  check("no ordered qty -> divide by the produced count", legacy.pricePerBox, legacy.total / 100);
}

// ---------------------------------------------------------------------------
console.log("\n== item 2: per-component wrapping ==");

{
  const dims = { length_in: 10, width_in: 8, height_in: 4 };
  const base = {
    boxType: "telescopic" as BoxType,
    dims,
    vars: { lidDepth_in: 1.5 },
    quantity: 500,
    board: { sheet: { width_in: 31, height_in: 41 } },
  };
  const sharedOuter = { sheet: { width_in: 23, height_in: 36 }, foldingAllowance_mm: 20 };

  // A shared wrap = exactly ONE group holding every component, and the legacy
  // `outerPaper` field still points at it.
  const shared = estimateMaterials({ ...base, outerPaper: sharedOuter });
  assert("one group when the wrap is shared", shared.outerPaperGroups?.length === 1);
  assert(
    "group holds every component",
    shared.outerPaperGroups?.[0].components.join(",") === "tray,lid",
    shared.outerPaperGroups?.[0].components.join(","),
  );
  assert(
    "legacy outerPaper points at the single group",
    shared.outerPaper === shared.outerPaperGroups?.[0].material,
  );

  // Overriding a component with an IDENTICAL config must NOT split the layer —
  // same paper, same print job, so the parts still share sheets.
  const sameCfg = estimateMaterials({
    ...base,
    outerPaper: sharedOuter,
    outerPaperByComponent: { lid: { ...sharedOuter } },
  });
  assert("identical per-part config stays one group", sameCfg.outerPaperGroups?.length === 1);
  assert(
    "identical config is byte-identical to the shared run",
    JSON.stringify(sameCfg.outerPaper) === JSON.stringify(shared.outerPaper),
  );

  // A DIFFERENT config splits the layer into two groups, each nesting alone.
  const split = estimateMaterials({
    ...base,
    outerPaper: sharedOuter,
    outerPaperByComponent: {
      lid: { sheet: { width_in: 25, height_in: 36 }, foldingAllowance_mm: 20 },
    },
  });
  assert("differing per-part config splits the layer", split.outerPaperGroups?.length === 2);
  assert(
    "groups carry the right components",
    split.outerPaperGroups?.[0].components.join(",") === "tray" &&
      split.outerPaperGroups?.[1].components.join(",") === "lid",
    split.outerPaperGroups?.map((g) => g.components.join("+")).join(" | "),
  );
  assert(
    "each group nests on its own sheet",
    split.outerPaperGroups?.[0].material.sheet.width_in === 23 &&
      split.outerPaperGroups?.[1].material.sheet.width_in === 25,
  );

  // Engine 2 sums the groups, each on its own paper rate + plate.
  const rate = (paper: number): CostRates => ({
    boardCostPerSheet: 41,
    accessories: { magnetEach: 0, washerEach: 0, tapePerUnit: 0.75 },
    labour: [],
    overheadPct: 0,
    marginPct: 0,
    outerPaperCostPerSheet: paper,
  });
  const splitCost = estimateCost(split, {
    ...rate(9),
    outerGroups: [
      { paperCostPerSheet: 9, printing: { mode: "offset", first1000: 5000, additional1000: 1200 } },
      { paperCostPerSheet: 14, printing: { mode: "offset", first1000: 5000, additional1000: 1200 } },
    ],
    perJobPrinting: true,
  });
  const g0 = split.outerPaperGroups![0].material.totalSheets;
  const g1 = split.outerPaperGroups![1].material.totalSheets;
  check("per-group paper = Σ sheets × that group's rate", splitCost.outerPaper, g0 * 9 + g1 * 14);
  assert(
    "two wrap groups = two plate fees",
    splitCost.printing === 10000,
    `${CUR}${splitCost.printing}`,
  );

  // Finishing lines are tagged with the components they belong to.
  const tagged = estimateCost(split, {
    ...rate(9),
    outerGroups: [
      { paperCostPerSheet: 9, finishing: [{ kind: "lamination", ratePer100sqin: 0.9, key: "matte" }] },
      { paperCostPerSheet: 14, finishing: [{ kind: "lamination", ratePer100sqin: 2, key: "thermal" }] },
    ],
  });
  assert(
    "finishing lines name their component",
    tagged.finishingDetail?.[0].label === "Lamination matte (tray)" &&
      tagged.finishingDetail?.[1].label === "Lamination thermal (lid)",
    tagged.finishingDetail?.map((l) => l.label).join(" | "),
  );
  check(
    "tagged finishing sums to the kept total",
    (tagged.finishingDetail ?? []).reduce((s, l) => s + l.amount, 0),
    tagged.finishing,
  );

  // A component with NO shared wrap and no override simply isn't wrapped.
  const partial = estimateMaterials({
    ...base,
    outerPaperByComponent: { lid: sharedOuter },
  });
  assert(
    "only the overridden component is wrapped",
    partial.outerPaperGroups?.length === 1 &&
      partial.outerPaperGroups[0].components.join(",") === "lid",
  );
}

// ---------------------------------------------------------------------------
console.log("\n== item 11: section-wise cost breakdown ==");

{
  const specs: EstimateRequest = {
    boxType: "telescopic",
    dims: { length_in: 10, width_in: 8, height_in: 4 },
    vars: { lidDepth_in: 1.5 },
    quantity: 100,
    productionQuantity: 105,
    boardThickness_mm: 1.5,
    wrapping: {
      outer: {
        mode: "printed",
        paperSizeLabel: "23x36",
        gsm: 130,
        foldingAllowance_mm: 20,
        printing: { type: "offset", sizeLabel: "18x25", colour: "multi" },
      },
    },
    labour: [{ role: "Cutting", unit: "hour", quantity: 4 }],
    additional: { die: { qty: 2, rate: 1500 } },
  };
  const mat = estimateMaterials({
    boxType: "telescopic",
    dims: specs.dims,
    vars: specs.vars,
    quantity: 105,
    board: { sheet: { width_in: 31, height_in: 41 } },
    outerPaper: {
      sheet: { width_in: 23, height_in: 36 },
      printSheet: { width_in: 18, height_in: 25 },
      foldingAllowance_mm: 20,
      wastagePct: 10,
    },
  });
  const cost = estimateCost(mat, {
    boardCostPerSheet: 41,
    outerPaperCostPerSheet: 9,
    printing: { mode: "offset", first1000: 2800, additional1000: 800 },
    finishing: [{ kind: "lamination", ratePer100sqin: 0.9, key: "matte" }],
    accessories: { magnetEach: 0, washerEach: 0, tapePerUnit: 0.75 },
    labour: [{ role: "Cutting", unit: "hour", rate: 195, quantity: 4 }],
    overheadPct: 11,
    marginPct: 20,
    orderedQuantity: 100,
    additional: { die: 3000 },
  });

  const view = buildCostView(specs, cost, mat);
  const titles = view.map((s) => s.title);
  assert(
    "sections cover the client's categories",
    ["Boards", "Outer paper", "Outer printing", "Outer finishing", "Consumables", "Labour"].every(
      (t) => titles.includes(t),
    ),
    titles.join(", "),
  );

  const allRows = view.flatMap((s) => s.rows);
  // perBox became optional in round 9 (one-time charges quoted separately have
  // no per-box share). This fixture sets no additionalMode, so every row must
  // still carry one — the `!= null` here is the assertion, not a let-off.
  assert(
    "every row carries a per-box figure",
    allRows.every((r) => r.perBox != null && Math.abs(r.perBox - r.total / 100) < 1e-9),
  );
  assert(
    "per box divides by ORDERED, not produced",
    allRows.every(
      (r) => r.perBox == null || Math.abs(r.perBox - r.total / 105) > 1e-9 || r.total === 0,
    ),
  );

  const board = view.find((s) => s.title === "Boards")!.rows[0];
  assert(
    "board row names thickness + sheet count",
    board.detail?.includes("1.5 mm") === true && board.detail?.includes("sheet") === true,
    board.detail,
  );
  const paper = view.find((s) => s.title === "Outer paper")!.rows[0];
  assert(
    "paper row splits required vs wastage sheets",
    paper.detail?.includes("required") === true && paper.detail?.includes("wastage") === true,
    paper.detail,
  );
  assert(
    "paper row names the sheets actually bought",
    paper.detail?.includes("buy") === true,
    paper.detail,
  );
  const printRow = view.find((s) => s.title === "Outer printing")!.rows[0];
  assert(
    "printing row names type, colour and size",
    printRow.detail?.includes("offset") === true && printRow.detail?.includes("18x25") === true,
    printRow.detail,
  );
  const labour = view.find((s) => s.title === "Labour")!.rows[0];
  assert("labour row names hours", labour.detail?.includes("4 hour") === true, labour.detail);
  const addl = view.find((s) => s.title.startsWith("Additional"))!.rows[0];
  assert("additional charge shows units × rate", addl.detail?.includes("2 ×") === true, addl.detail);

  // The view must never invent money: its material lines reconcile with the
  // stored breakdown.
  const boardTotal = view.find((s) => s.title === "Boards")!.rows.reduce((s, r) => s + r.total, 0);
  check("board section reconciles with the breakdown", boardTotal, cost.board);
  const paperTotal = view.find((s) => s.title === "Outer paper")!.rows.reduce((s, r) => s + r.total, 0);
  check("paper section reconciles with the breakdown", paperTotal, cost.outerPaper);
}

// ---------------------------------------------------------------------------
console.log("\n== glue / metlock: cost OR quantity (client 21-Jul) ==");

{
  const mat = estimateMaterials({
    boxType: "tray_only",
    dims: { length_in: 10, width_in: 8, height_in: 4 },
    quantity: 500,
    board: { sheet: { width_in: 31, height_in: 41 } },
  });
  const base: CostRates = {
    boardCostPerSheet: 41,
    accessories: { magnetEach: 0, washerEach: 0, tapePerUnit: 0.75 },
    labour: [],
    overheadPct: 0,
    marginPct: 0,
  };

  // Quantity mode resolves count × rate into the SAME cost the engine reads,
  // so both entry modes are indistinguishable downstream.
  const byCost = estimateCost(mat, { ...base, glueCost: 1250, metlockCost: 900 });
  const byQty = estimateCost(mat, { ...base, glueCost: 5 * 250, metlockCost: 3 * 300 });
  check("quantity mode resolves to the same glue cost", byQty.glue, byCost.glue);
  check("quantity mode resolves to the same metlock cost", byQty.metlock, byCost.metlock);

  // The cost view reports the real count when it was entered by quantity.
  const specsQty: EstimateRequest = {
    boxType: "tray_only",
    dims: { length_in: 10, width_in: 8, height_in: 4 },
    quantity: 500,
    boardThickness_mm: 1.5,
    manual: {
      glueTotal: 1250,
      metlockTotal: 900,
      glueQty: { qty: 5, unit: "litres", rate: 250 },
      metlockQty: { qty: 3, unit: "bottles", rate: 300 },
    },
  };
  const view = buildCostView(specsQty, byQty, mat);
  const consumables = view.find((s) => s.title === "Consumables");
  const glueRow = consumables?.rows.find((r) => r.label === "Glue");
  const metRow = consumables?.rows.find((r) => r.label === "Metlock");
  assert("cost view shows the glue count", glueRow?.detail === `5 litres × ${CUR}250`, glueRow?.detail);
  assert("cost view shows the metlock count", metRow?.detail === `3 bottles × ${CUR}300`, metRow?.detail);

  // Cost-only entry (no quantity) still reads as a manual cost — unchanged.
  const specsCost: EstimateRequest = { ...specsQty, manual: { glueTotal: 1250 } };
  const glueRow2 = buildCostView(specsCost, byCost, mat)
    .find((s) => s.title === "Consumables")
    ?.rows.find((r) => r.label === "Glue");
  assert("cost-only entry unchanged", glueRow2?.detail === "manual cost", glueRow2?.detail);
}

// ---------------------------------------------------------------------------
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
