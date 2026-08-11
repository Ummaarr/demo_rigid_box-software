// Dev demo: full pipeline Engine 1 -> Engine 2 for a telescopic box, using the
// seed rates (dummy board/paper + real printing/lamination). Proves the whole
// estimate flow end to end. Run: npx tsx scripts/full-estimate-demo.ts

import { estimateMaterials } from "@/lib/engines/material";
import { estimateCost, type CostRates } from "@/lib/engines/cost";

const mat = estimateMaterials({
  boxType: "telescopic",
  dims: { length_in: 10, width_in: 8, height_in: 4 },
  vars: { lidDepth_in: 1.5 },
  quantity: 500,
  board: { sheet: { width_in: 31, height_in: 41 } }, // kappa
  outerPaper: { sheet: { width_in: 30, height_in: 40 }, foldingAllowance_mm: 20 },
  innerPaper: { sheet: { width_in: 23, height_in: 36 }, liningReduction_mm: 10 },
  // telescopic: no foam, no magnets, no tray -> no accessories
});

// Rates pulled from seed.sql (dummy board/paper, real offset + lamination + labour).
const rates: CostRates = {
  boardCostPerSheet: 41, // 1.5mm kappa (DUMMY)
  outerPaperCostPerSheet: 16, // 30x40 157gsm (DUMMY)
  innerPaperCostPerSheet: 8, // 23x36 120gsm (DUMMY)
  printing: { mode: "offset", first1000: 5000, additional1000: 1200 }, // 25x36 (REAL)
  finishing: [{ kind: "lamination", ratePer100sqin: 0.9 }], // matte (REAL)
  accessories: {
    magnetEach: 1.5,
    washerEach: 0.4,
    tapePerUnit: 0.75, // per tray/lid (REAL)
  },
  glueCost: 0, // manual open input (per order)
  metlockCost: 0, // manual open input (per order)
  labour: [
    { role: "Cutting", unit: "day", rate: 1560, quantity: 1 }, // REAL
    { role: "Floorwork", unit: "hour", rate: 1083.9, quantity: 4 }, // REAL
  ],
  overheadPct: 11, // REAL (editable)
  marginPct: 20, // REAL (editable, admin-only downstream)
  additional: { designer: 800 }, // manual one-off (REAL day-rate as example)
};

const cost = estimateCost(mat, rates);

const r = (n: number) => n.toFixed(2);
console.log("Telescopic 10x8x4, qty 500\n");
console.log("MATERIAL QUANTITIES");
console.log(`  board sheets:       ${mat.board.totalSheets}`);
console.log(`  outer paper sheets: ${mat.outerPaper?.totalSheets}`);
console.log(`  inner paper sheets: ${mat.innerPaper?.totalSheets}`);
console.log("\nCOST BREAKDOWN (Rs)");
console.log(`  1. board             ${r(cost.board)}`);
console.log(`  2. outer paper       ${r(cost.outerPaper)}`);
console.log(`  3. inner paper       ${r(cost.innerPaper)}`);
console.log(`  4. printing          ${r(cost.printing)}`);
console.log(`  5. finishing         ${r(cost.finishing)}`);
console.log(`  6. foam              ${r(cost.foam)}`);
console.log(`     reverse board     ${r(cost.reverseBoard)}`);
console.log(`  7. accessories       ${r(cost.accessories.total)}`);
console.log(`  8. glue + metlock    ${r(cost.glue + cost.metlock)}`);
console.log(`     material subtotal  ${r(cost.materialSubtotal)}`);
console.log(`     labour             ${r(cost.labour)}`);
console.log(`     LEVEL 1            ${r(cost.level1)}`);
console.log(`     overhead (11%)     ${r(cost.overhead)}`);
console.log(`     LEVEL 2            ${r(cost.costBeforeMargin)}`);
console.log(`     margin (20%)       ${r(cost.margin)}`);
console.log(`     after margin       ${r(cost.subtotalAfterMargin)}`);
console.log(`     additional         ${r(cost.additional.total)}`);
console.log(`     TOTAL (pre-GST)    ${r(cost.total)}`);
console.log(`     PRICE PER BOX      ${r(cost.pricePerBox)}`);
