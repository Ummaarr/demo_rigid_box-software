// Validates the print-size-driven paper flow (client doc Step 1: "printing size
// determines what paper size we will use") + the per-estimate wastage override
// plumbing at the engine level.
//   - blanks nest on the PRINT area, not the full paper sheet
//   - paper purchase = print size nested on the paper sheet (2x 18x25 per 25x36)
//   - paper cost uses purchased sheets; printing + lamination use printed sheets
//   - print == paper size reduces exactly to the old behaviour
// Run: npx tsx scripts/validate-print-paper.ts

import {
  estimateMaterials,
  derivePaperPurchase,
  packPrintsOnSheet,
} from "@/lib/engines/material";
import { estimateCost, type CostRates } from "@/lib/engines/cost";

let failures = 0;
function check(label: string, got: number, want: number, tol = 1e-6) {
  const ok = Math.abs(got - want) <= tol;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: got ${got}${ok ? "" : `, want ${want}`}`);
  if (!ok) failures++;
}

// --- Case A: half-sheet printing — 18x25 print bought as 25x36 paper ---------
// Telescopic 10x8x4 qty 500. Outer blanks (board keyline + 20mm/side):
//   tray 19.57x17.57 -> on 18x25 print: A 0, B 1x1 = 1/sheet -> 500 printed
//   lid  14.57x12.57 -> on 18x25 print: A 1x1 (2x12.57=25.15 just misses 25),
//        B 1x1 -> 1/sheet -> 500 printed
// wastage 10% per component -> 550 + 550 = 1100 printed sheets.
// Purchase: 18x25 on 25x36 paper: A floor(25/18)x floor(36/25)=1, B floor(25/25)x
// floor(36/18)=2 -> 2 prints/sheet -> ceil(1100/2) = 550 sheets to buy.
{
  const mat = estimateMaterials({
    boxType: "telescopic",
    dims: { length_in: 10, width_in: 8, height_in: 4 },
    vars: { lidDepth_in: 1.5 },
    quantity: 500,
    board: { sheet: { width_in: 31, height_in: 41 } },
    outerPaper: {
      sheet: { width_in: 25, height_in: 36 },
      printSheet: { width_in: 18, height_in: 25 },
      foldingAllowance_mm: 20,
      wastagePct: 10,
    },
  });
  console.log("Case A — telescopic, 18x25 print on 25x36 paper, 10% wastage:");
  check("printed sheets (tray 550 + lid 550)", mat.outerPaper!.totalSheets, 1100);
  check("prints per paper sheet", mat.outerPaperPurchase!.printsPerSheet, 2);
  check("paper sheets to buy", mat.outerPaperPurchase!.sheetsToBuy, 550);
  check("purchase mirrors printed sheets", mat.outerPaperPurchase!.printedSheets, 1100);

  // Cost: paper on purchased sheets; printing + lamination on printed sheets.
  const rates: CostRates = {
    boardCostPerSheet: 33.75,
    outerPaperCostPerSheet: 10,
    printing: { mode: "digital", costPerSheet: 20 },
    finishing: [{ kind: "lamination", ratePer100sqin: 0.9 }],
    accessories: { magnetEach: 0, washerEach: 0, tapePerUnit: 0.75 },
    labour: [],
    overheadPct: 11,
    marginPct: 20,
  };
  const cost = estimateCost(mat, rates);
  check("paper cost = 550 x 10", cost.outerPaper, 5500);
  check("printing cost = 1100 x 20", cost.printing, 22000);
  // Lamination runs the PRINTED sheets: 1100 x (18x25) x 0.9/100.
  check("lamination on printed area", cost.finishing, (1100 * 18 * 25 * 0.9) / 100);
}

// --- Case B: print == paper size — must equal the old behaviour --------------
{
  const base = estimateMaterials({
    boxType: "telescopic",
    dims: { length_in: 10, width_in: 8, height_in: 4 },
    vars: { lidDepth_in: 1.5 },
    quantity: 500,
    board: { sheet: { width_in: 31, height_in: 41 } },
    outerPaper: { sheet: { width_in: 23, height_in: 36 }, foldingAllowance_mm: 20 },
  });
  const driven = estimateMaterials({
    boxType: "telescopic",
    dims: { length_in: 10, width_in: 8, height_in: 4 },
    vars: { lidDepth_in: 1.5 },
    quantity: 500,
    board: { sheet: { width_in: 31, height_in: 41 } },
    outerPaper: {
      sheet: { width_in: 23, height_in: 36 },
      printSheet: { width_in: 23, height_in: 36 },
      foldingAllowance_mm: 20,
    },
  });
  console.log("Case B — 23x36 print on 23x36 paper (identity):");
  check("printed sheets unchanged", driven.outerPaper!.totalSheets, base.outerPaper!.totalSheets);
  check("1 print per sheet", driven.outerPaperPurchase!.printsPerSheet, 1);
  check("buy == printed", driven.outerPaperPurchase!.sheetsToBuy, driven.outerPaper!.totalSheets);
}

// --- Case C: purchase math directly ------------------------------------------
{
  console.log("Case C — derivePaperPurchase edge math:");
  const p = derivePaperPurchase(
    { width_in: 13, height_in: 19 },
    { width_in: 25, height_in: 36 },
    101,
  );
  // 13x19 on 25x36: A floor(25/13)=1 x floor(36/19)=1 = 1; B floor(25/19)=1 x
  // floor(36/13)=2 = 2 -> 2/sheet -> ceil(101/2) = 51.
  check("13x19 prints per 25x36 sheet", p.printsPerSheet, 2);
  check("sheets to buy", p.sheetsToBuy, 51);
  let threw = false;
  try {
    derivePaperPurchase({ width_in: 28, height_in: 40 }, { width_in: 23, height_in: 36 }, 10);
  } catch {
    threw = true;
  }
  check("oversize print throws", threw ? 1 : 0, 1);
}

// --- Case D: mixed-orientation packing recovers an extra rotated print -------
// Client 7-Jul: "1 more print would fit in the wasted space if we flip it to
// landscape." print 4x6 on 12x10 paper: uniform best is B floor(12/6)*floor(10/4)
// = 2*2 = 4; but a main grid of 3 across the top (4x6 -> 12x6) leaves a 12x4
// band that fits 2 rotated prints (6x4) -> 5 total. Guaranteed never worse.
{
  console.log("Case D — 4x6 print on 12x10: mixed orientation beats uniform:");
  const uniformA = Math.floor(12 / 4) * Math.floor(10 / 6); // 3*1 = 3
  const uniformB = Math.floor(12 / 6) * Math.floor(10 / 4); // 2*2 = 4
  const uniformBest = Math.max(uniformA, uniformB); // 4
  const packed = packPrintsOnSheet({ width_in: 4, height_in: 6 }, { width_in: 12, height_in: 10 });
  check("uniform baseline", uniformBest, 4);
  check("packed prints per sheet", packed.count, 5);
  check("packed never worse than uniform", packed.count >= uniformBest ? 1 : 0, 1);
  check("layout rect count matches", packed.layout.length, 5);

  const p = derivePaperPurchase({ width_in: 4, height_in: 6 }, { width_in: 12, height_in: 10 }, 10);
  check("sheets to buy = ceil(10/5)", p.sheetsToBuy, 2);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
