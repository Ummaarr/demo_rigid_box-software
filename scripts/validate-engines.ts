// End-to-end Phase 3 validation: Engine 1 (material) -> Engine 2 (cost) for a
// known telescopic box. Asserts the deterministic nesting counts and the cost-
// layer arithmetic (overhead/margin/total/price-per-box consistency), then
// prints the full breakdown for eyeballing. Run: npx tsx scripts/validate-engines.ts
//
// When a real past order arrives, add it here as another case and compare the
// engine's price-per-box to the client's actual number.

import { estimateMaterials } from "@/lib/engines/material";
import { estimateCost, type CostRates } from "@/lib/engines/cost";

let failures = 0;
function check(label: string, got: number, want: number, tol = 1e-6) {
  const ok = Math.abs(got - want) <= tol;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: got ${got}${ok ? "" : `, want ${want}`}`);
  if (!ok) failures++;
}

// --- Inputs -----------------------------------------------------------------
const mat = estimateMaterials({
  boxType: "telescopic",
  dims: { length_in: 10, width_in: 8, height_in: 4 },
  vars: { lidDepth_in: 1.5 },
  quantity: 500,
  board: { sheet: { width_in: 31, height_in: 41 } },
  outerPaper: { sheet: { width_in: 23, height_in: 36 }, foldingAllowance_mm: 20 },
  innerPaper: { sheet: { width_in: 23, height_in: 36 } }, // reduction defaults to 0
});

const rates: CostRates = {
  boardCostPerSheet: 41, // 1.5mm dummy
  outerPaperCostPerSheet: 9, // 23x36 130gsm dummy
  innerPaperCostPerSheet: 9,
  printing: { mode: "offset", first1000: 5000, additional1000: 1200 }, // 23x36
  finishing: [{ kind: "lamination", ratePer100sqin: 0.9 }], // matte
  accessories: { magnetEach: 0, washerEach: 0, tapePerUnit: 0.75 },
  labour: [{ role: "cutting", unit: "day", rate: 1560, quantity: 2 }],
  overheadPct: 11,
  marginPct: 20,
};

const cost = estimateCost(mat, rates);

// --- Assert material quantities (deterministic) -----------------------------
console.log("Engine 1 — material quantities (telescopic 10x8x4, qty 500):");
// Combination nesting (client's real "cut different parts together" method) puts
// 2 trays (18x16) + 2 lids (13x11) on one 31x41 board sheet -> ceil(500/2) = 250,
// vs 250 + 84 = 334 if each component were cut on its own sheets. Board only.
check("board sheets (combined)", mat.board.totalSheets, 250);
check("board sheets (separate baseline)", mat.board.combination!.separateSheets, 334);
check("outer paper sheets", mat.outerPaper!.totalSheets, 500);
check("inner paper sheets", mat.innerPaper!.totalSheets, 375);
check("tape units (tray+lid x 500)", mat.accessories.tape, 1000);
check("magnets (none for telescopic)", mat.accessories.magnets, 0);

// --- Assert cost-layer arithmetic consistency -------------------------------
console.log("\nEngine 2 — cost-layer consistency:");
check("level1 = materials + labour", cost.level1, cost.materialSubtotal + cost.labour);
check("overhead = 11% of level1", cost.overhead, (cost.level1 * 11) / 100);
check("level2 = level1 + overhead", cost.costBeforeMargin, cost.level1 + cost.overhead);
check("margin = 20% of level2", cost.margin, (cost.costBeforeMargin * 20) / 100);
check("total = afterMargin + additional", cost.total, cost.subtotalAfterMargin + cost.additional.total);
check("pricePerBox = total / qty", cost.pricePerBox, cost.total / 500);

// --- Print full breakdown ---------------------------------------------------
const inr = (n: number) => "₹" + n.toFixed(2);
console.log("\nFull cost breakdown:");
console.log(`  Board                ${inr(cost.board)}`);
console.log(`  Outer wrapping paper ${inr(cost.outerPaper)}`);
console.log(`  Inner lining paper   ${inr(cost.innerPaper)}`);
console.log(`  Printing (offset)    ${inr(cost.printing)}`);
console.log(`  Finishing (matte)    ${inr(cost.finishing)}`);
console.log(`  Tape                 ${inr(cost.accessories.tape)}`);
console.log(`  ------------------------------------`);
console.log(`  Materials subtotal   ${inr(cost.materialSubtotal)}`);
console.log(`  Labour               ${inr(cost.labour)}`);
console.log(`  Level 1              ${inr(cost.level1)}`);
console.log(`  Overhead (11%)       ${inr(cost.overhead)}`);
console.log(`  Level 2              ${inr(cost.costBeforeMargin)}`);
console.log(`  Margin (20%)         ${inr(cost.margin)}`);
console.log(`  ====================================`);
console.log(`  TOTAL (pre-GST)      ${inr(cost.total)}`);
console.log(`  PRICE PER BOX        ${inr(cost.pricePerBox)}`);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
