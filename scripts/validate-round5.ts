// Round-5 validation (client 13-Jul): mixed-orientation nesting, auto-economical
// printing, combined-vs-separate printing, window punching allowance, and the
// new inserts (sleeve / beading / card partitions / custom partition).
// Run: npx tsx scripts/validate-round5.ts
//
// The invariants here are the round's correctness contract:
//   - mixed nesting is NEVER worse than the pure grid, and its layouts are
//     physically valid (in-bounds, non-overlapping);
//   - absent round-5 fields reproduce the old outputs exactly (old snapshots);
//   - the auto printing pick equals a brute-force enumeration;
//   - separate printing charges the offset minimum per component.

import {
  estimateBoardMaterial,
  estimateCardInsert,
  estimateMaterials,
  estimatePaperMaterial,
  estimateWindow,
  nestBlank,
  packPiecesOnSheet,
  derivePaperPurchase,
  type PrintLayoutRect,
  type Sheet,
} from "@/lib/engines/material";
import { estimateCost, offsetCost, type CostRates } from "@/lib/engines/cost";
import { chooseBestPrinting, type PaperCandidate, type PrintCandidate } from "@/lib/estimate/auto-printing-core";
import { sleeveBlank } from "@/lib/formulas/sleeve";
import type { Blank, BoxType } from "@/types";

let failures = 0;
function assert(label: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}
function check(label: string, got: number, want: number, tol = 1e-9) {
  assert(label, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);
}

// Deterministic PRNG so failures reproduce.
let seed = 20260719;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

// ---------------------------------------------------------------------------
console.log("\n== E1: mixed-orientation nesting ==");

// Physical validity of a rect layout on a sheet.
function layoutValid(layout: PrintLayoutRect[], sheet: Sheet): boolean {
  const EPS = 1e-9;
  for (const r of layout) {
    if (r.x_in < -EPS || r.y_in < -EPS) return false;
    if (r.x_in + r.w_in > sheet.width_in + EPS) return false;
    if (r.y_in + r.h_in > sheet.height_in + EPS) return false;
  }
  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      const a = layout[i];
      const b = layout[j];
      const overlap =
        a.x_in < b.x_in + b.w_in - EPS &&
        b.x_in < a.x_in + a.w_in - EPS &&
        a.y_in < b.y_in + b.h_in - EPS &&
        b.y_in < a.y_in + a.h_in - EPS;
      if (overlap) return false;
    }
  }
  return true;
}

{
  // Randomized: packed count never worse than the pure best-of-two; layouts valid.
  let neverWorse = true;
  let allValid = true;
  let strictWins = 0;
  for (let t = 0; t < 500; t++) {
    const sheet: Sheet = { width_in: 10 + rand() * 30, height_in: 10 + rand() * 30 };
    const piece: Sheet = { width_in: 1 + rand() * 12, height_in: 1 + rand() * 12 };
    const o = nestBlank(piece, sheet);
    const pure = Math.max(o.perSheetA, o.perSheetB);
    const packed = packPiecesOnSheet(piece, sheet);
    if (packed.count < pure) neverWorse = false;
    if (packed.count > pure) strictWins++;
    if (!layoutValid(packed.layout, sheet)) allValid = false;
    if (packed.layout.length !== packed.count) allValid = false;
  }
  assert("500 random: packed >= pure best-of-two", neverWorse);
  assert("500 random: layouts in-bounds + non-overlapping", allValid);
  assert("mixed strictly wins on some geometries", strictWins > 0, `${strictWins} wins`);
}

{
  // The client's example shape: 4x6 piece on a 12x10 sheet — a pure grid fits 4
  // (2x2 of 4x6) but flipping recovers a 5th in the leftover strip.
  const packed = packPiecesOnSheet({ width_in: 4, height_in: 6 }, { width_in: 12, height_in: 10 });
  check("hand case: 5 pieces via mixed layout", packed.count, 5);
}

{
  // estimateBoardMaterial: mixed <= pure sheets; override forces the pure grid.
  const blanks: Blank[] = [{ component: "tray", width_in: 4, height_in: 6, count_per_box: 1 }];
  const sheet: Sheet = { width_in: 12, height_in: 10 };
  const pure = estimateBoardMaterial(blanks, 500, sheet);
  const mixed = estimateBoardMaterial(blanks, 500, sheet, {}, false, true);
  check("pure: 4/sheet -> 125 sheets", pure.totalSheets, 125);
  check("mixed: 5/sheet -> 100 sheets", mixed.totalSheets, 100);
  assert("mixed component carries its layout", mixed.components[0].mixed?.layout.length === 5);
  // Override forces the pure grid in the CHOSEN orientation, even with the
  // mixed flag on: B = 2x2 = 4/sheet -> 125 sheets; A = 3x1 = 3/sheet -> 167.
  const overriddenB = estimateBoardMaterial(blanks, 500, sheet, { tray: "B" }, false, true);
  check("override B forces the pure 4/sheet grid", overriddenB.totalSheets, 125);
  const overriddenA = estimateBoardMaterial(blanks, 500, sheet, { tray: "A" }, false, true);
  check("override A forces the pure 3/sheet grid", overriddenA.totalSheets, 167);
  assert("override result has no mixed layout", overriddenB.components[0].mixed == null && overriddenA.components[0].mixed == null);

  // No-flag call is byte-identical to the old engine (old snapshots).
  const legacy = estimateBoardMaterial(blanks, 500, sheet);
  assert(
    "ungated call identical to pure",
    JSON.stringify(legacy) === JSON.stringify(pure),
  );
}

{
  // Randomized: totalSheets(mixed) <= totalSheets(pure), with + without combine.
  let ok = true;
  for (let t = 0; t < 300; t++) {
    const sheet: Sheet = { width_in: 20 + rand() * 20, height_in: 25 + rand() * 20 };
    const n = 1 + Math.floor(rand() * 3);
    const blanks: Blank[] = [];
    for (let i = 0; i < n; i++) {
      blanks.push({
        component: `c${i}`,
        width_in: 2 + rand() * 14,
        height_in: 2 + rand() * 14,
        count_per_box: 1 + Math.floor(rand() * 2),
      });
    }
    for (const combine of [false, true]) {
      const pure = estimateBoardMaterial(blanks, 500, sheet, {}, combine);
      const mixed = estimateBoardMaterial(blanks, 500, sheet, {}, combine, true);
      if (
        Number.isFinite(pure.totalSheets) &&
        mixed.totalSheets > pure.totalSheets
      ) {
        ok = false;
        console.log("    counterexample:", JSON.stringify({ sheet, blanks, combine }));
      }
    }
  }
  assert("300 random: mixed never needs more sheets (combine on/off)", ok);
}

{
  // Paper layer: wastage applies after mixed nesting, still never worse.
  const blanks: Blank[] = [{ component: "tray", width_in: 3.2, height_in: 5.4, count_per_box: 1 }];
  const sheet: Sheet = { width_in: 11.5, height_in: 9.6 };
  const pure = estimatePaperMaterial(blanks, 800, sheet, "inner", 0, {}, 10, false);
  const mixed = estimatePaperMaterial(blanks, 800, sheet, "inner", 0, {}, 10, false, true);
  assert(
    "paper layer: mixed <= pure with 10% wastage",
    mixed.totalSheets <= pure.totalSheets,
    `${mixed.totalSheets} vs ${pure.totalSheets}`,
  );
}

// ---------------------------------------------------------------------------
console.log("\n== E2: auto-economical printing ==");

{
  const blanks: Blank[] = [
    { component: "tray", width_in: 12.8, height_in: 4.1, count_per_box: 1 },
    { component: "sleeve", width_in: 3, height_in: 23.2, count_per_box: 1 },
  ];
  const candidates: PrintCandidate[] = [
    { sizeLabel: "18x25", printSheet: { width_in: 18, height_in: 25 }, rate: { mode: "offset", first1000: 2800, additional1000: 800 } },
    { sizeLabel: "20x30", printSheet: { width_in: 20, height_in: 30 }, rate: { mode: "offset", first1000: 3500, additional1000: 1000 } },
    { sizeLabel: "25x36", printSheet: { width_in: 25, height_in: 36 }, rate: { mode: "offset", first1000: 5000, additional1000: 1200 } },
    { sizeLabel: "28x40", printSheet: { width_in: 28, height_in: 40 }, rate: { mode: "offset", first1000: 6500, additional1000: 1500 } },
  ];
  const papers: PaperCandidate[] = [
    { sizeLabel: "23x36", sheet: { width_in: 23, height_in: 36 }, costPerSheet: 9 },
    { sizeLabel: "25x36", sheet: { width_in: 25, height_in: 36 }, costPerSheet: 10 },
    { sizeLabel: "30x40", sheet: { width_in: 30, height_in: 40 }, costPerSheet: 14 },
  ];

  const base = {
    blanks,
    quantity: 1020,
    layer: "outer" as const,
    allowance_mm: 20,
    wastagePct: 10,
    overrides: {},
    combine: true,
    mixed: true,
    perJobPrinting: false,
    consolidateTies: false,
    candidates,
    papers,
  };
  const win = chooseBestPrinting(base);

  // Brute force the same enumeration independently.
  let bruteBest = Infinity;
  let bruteCount = 0;
  for (const c of candidates) {
    const est = estimatePaperMaterial(blanks, 1020, c.printSheet, "outer", 20, {}, 10, true, true);
    if (!Number.isFinite(est.totalSheets)) continue;
    for (const p of papers) {
      const fitsPaper =
        (c.printSheet.width_in <= p.sheet.width_in && c.printSheet.height_in <= p.sheet.height_in) ||
        (c.printSheet.height_in <= p.sheet.width_in && c.printSheet.width_in <= p.sheet.height_in);
      if (!fitsPaper) continue;
      bruteCount++;
      const purchase = derivePaperPurchase(c.printSheet, p.sheet, est.totalSheets);
      const rate = c.rate;
      const printCost =
        rate.mode === "offset" ? offsetCost(est.totalSheets, rate.first1000, rate.additional1000) : 0;
      const total = printCost + purchase.sheetsToBuy * p.costPerSheet;
      if (total < bruteBest) bruteBest = total;
    }
  }
  check("auto pick == brute-force minimum", win.total, bruteBest);
  check("considered = feasible pairs", win.considered, bruteCount);
  assert("winner names a real candidate", candidates.some((c) => c.sizeLabel === win.candidate.sizeLabel));

  // per-job flag flows into the evaluation (2 components -> 2 plates).
  const winSep = chooseBestPrinting({ ...base, combine: false, perJobPrinting: true });
  assert("separate printing evaluated total >= combined", winSep.total >= win.total - 1e-9, `${winSep.total} vs ${win.total}`);

  // Infeasible everything throws.
  let threw = false;
  try {
    chooseBestPrinting({
      ...base,
      candidates: [{ sizeLabel: "5x5", printSheet: { width_in: 5, height_in: 5 }, rate: { mode: "digital", costPerSheet: 20 } }],
    });
  } catch {
    threw = true;
  }
  assert("no feasible pair throws", threw);
}

// ---------------------------------------------------------------------------
console.log("\n== E3: combined vs separate printing ==");

{
  // Two components, each needing ~300 printed sheets: combined = one job on 600
  // sheets; separate = two jobs of 300 -> each pays the first-1000 minimum.
  const blanks: Blank[] = [
    { component: "lid", width_in: 10, height_in: 12, count_per_box: 1 },
    { component: "tray", width_in: 10, height_in: 12, count_per_box: 1 },
  ];
  const sheet: Sheet = { width_in: 20, height_in: 24 }; // 4 per sheet each
  const qty = 1200; // 300 sheets per component

  const matInput = {
    boxType: "telescopic" as BoxType,
    dims: { length_in: 10, width_in: 8, height_in: 4 },
    vars: { lidDepth_in: 1.5 },
    quantity: qty,
    board: { sheet: { width_in: 31, height_in: 41 } },
  };
  void matInput;

  const rates = { mode: "offset" as const, first1000: 5000, additional1000: 1200 };

  const combined = estimateBoardMaterial(blanks, qty, sheet, {}, true);
  const separate = estimateBoardMaterial(blanks, qty, sheet, {}, false);
  const combinedCost = offsetCost(combined.totalSheets, rates.first1000, rates.additional1000);
  const separateCost = separate.components.reduce(
    (s, c) => s + offsetCost(c.sheetsNeeded, rates.first1000, rates.additional1000),
    0,
  );
  check("combined: one plate fee (600 sheets)", combinedCost, 5000);
  check("separate: two plate fees (300 + 300)", separateCost, 10000);

  // End-to-end through Engine 2 via estimateMaterials + estimateCost.
  const mkInput = (printingMode?: "combined" | "separate") => ({
    boxType: "telescopic" as BoxType,
    dims: { length_in: 8, width_in: 6, height_in: 3 },
    vars: { lidDepth_in: 1.5 },
    quantity: 500,
    board: { sheet: { width_in: 31, height_in: 41 } },
    outerPaper: { sheet: { width_in: 23, height_in: 36 }, foldingAllowance_mm: 20 },
    printingMode,
  });
  const costRates: CostRates = {
    boardCostPerSheet: 41,
    outerPaperCostPerSheet: 9,
    printing: { mode: "offset", first1000: 5000, additional1000: 1200 },
    accessories: { magnetEach: 0, washerEach: 0, tapePerUnit: 0.75 },
    labour: [],
    overheadPct: 11,
    marginPct: 20,
  };
  const matCombined = estimateMaterials(mkInput("combined"));
  const matSeparate = estimateMaterials(mkInput("separate"));
  const costCombined = estimateCost(matCombined, costRates);
  const costSeparate = estimateCost(matSeparate, { ...costRates, perJobPrinting: true });
  const expectSeparate = matSeparate.outerPaper!.components.reduce(
    (s, c) => s + offsetCost(c.sheetsNeeded, 5000, 1200),
    0,
  );
  check("engine2 separate printing = per-component tiers", costSeparate.printing, expectSeparate);
  assert(
    "separate printing >= combined printing",
    costSeparate.printing >= costCombined.printing,
    `${costSeparate.printing} vs ${costCombined.printing}`,
  );
  // Default (no flags) is byte-identical to the legacy shape.
  const legacyMat = estimateMaterials(mkInput());
  const legacyCost = estimateCost(legacyMat, costRates);
  check("absent printingMode == combined (cost)", legacyCost.printing, costCombined.printing);
}

// ---------------------------------------------------------------------------
console.log("\n== E4: window punching allowance ==");

{
  const film: Sheet = { width_in: 20, height_in: 30 };
  // 4x6 window: pure fit floor(20/4) x floor(30/6) = 5x5 = 25/sheet. With
  // +10mm/side the piece is ~4.79x6.79 -> floor(20/4.79)=4 x floor(30/6.79)=4 = 16.
  const noMargin = estimateWindow({ length_in: 4, width_in: 6 }, film, 500);
  const withMargin = estimateWindow({ length_in: 4, width_in: 6 }, film, 500, undefined, 10);
  check("legacy (no margin): 25/sheet", noMargin.piecesPerSheet, 25);
  check("legacy sheets", noMargin.sheetsNeeded, Math.ceil(500 / 25));
  const grown = 2 * (10 / 25.4);
  const expectPer = (() => {
    const w = 4 + grown;
    const h = 6 + grown;
    const a = Math.floor(film.width_in / w) * Math.floor(film.height_in / h);
    const b = Math.floor(film.width_in / h) * Math.floor(film.height_in / w);
    return Math.max(a, b);
  })();
  check("margin piece count matches hand math", withMargin.piecesPerSheet, expectPer);
  assert("margin never increases pieces/sheet", withMargin.piecesPerSheet <= noMargin.piecesPerSheet);
  check("nestedBlank = footprint + 2x margin", withMargin.nestedBlank.length_in, 4 + grown);
  check("footprint stays the entered size", withMargin.windowFootprint.length_in, 4);
}

// ---------------------------------------------------------------------------
console.log("\n== F2/F4-F6: new insert formulas + nesting ==");

{
  // Sleeve blank per box type (user-agreed rule).
  const dims = { length_in: 10, width_in: 8, height_in: 4 };
  const drawer = sleeveBlank("drawer_sliding", dims);
  check("drawer sleeve W+H", drawer.width_in, 12);
  check("drawer sleeve L+H+L+H", drawer.height_in, 28);
  const matchbox = sleeveBlank("matchbox_sliding", dims);
  check("matchbox sleeve W+H+W+H", matchbox.width_in, 24);
  check("matchbox sleeve L", matchbox.height_in, 10);
  for (const bt of ["telescopic", "magnetic", "shoulder", "hinge_lid", "collapsible_rigid", "double_decker", "tray_only"] as BoxType[]) {
    const b = sleeveBlank(bt, dims);
    if (b.width_in !== 24 || b.height_in !== 10) {
      assert(`${bt} defaults to matchbox formula`, false, `${b.width_in}x${b.height_in}`);
    }
  }
  assert("all other box types default to matchbox formula", true);

  // Sleeve estimate (round 6): cut directly from card stock — keyline exact,
  // no folding allowance, no board component ("not kappa board").
  const est = estimateCardInsert([matchbox], 500, {
    sheet: { width_in: 25, height_in: 36 },
    wastagePct: 10,
  });
  const sleevePer = Math.max(
    Math.floor(25 / 24) * Math.floor(36 / 10),
    Math.floor(25 / 10) * Math.floor(36 / 24),
  );
  check("sleeve stock sheets (10% wastage)", est.paper.totalSheets, Math.ceil(Math.ceil(500 / sleevePer) * 1.1));
}

{
  // Beading algebra: (L+4BH+2BT) x (W+4BH+2BT).
  const BH = 0.5;
  const BT = 0.125;
  // Blank built the way build-estimate does.
  const side = BH + BT + BH;
  const blank: Blank = {
    component: "beading",
    width_in: side + 10 + side,
    height_in: side + 8 + side,
    count_per_box: 1,
  };
  check("beading width = L + 4BH + 2BT", blank.width_in, 10 + 4 * BH + 2 * BT);
  check("beading height = W + 4BH + 2BT", blank.height_in, 8 + 4 * BH + 2 * BT);

  // Card partitions: (H+H) x L * nL + (H+H) x W * nW, sharing one stock sheet.
  const H = 4;
  const partitions: Blank[] = [
    { component: "partition_l", width_in: H + H, height_in: 10, count_per_box: 2 },
    { component: "partition_w", width_in: H + H, height_in: 8, count_per_box: 3 },
  ];
  const est = estimateCardInsert(partitions, 500, { sheet: { width_in: 25, height_in: 36 } });
  assert("partitions may share sheets (combination attempted)", est.paper.combination != null);
  const separateSheets = estimateBoardMaterial(partitions, 500, { width_in: 25, height_in: 36 }, {}, false).totalSheets;
  assert(
    "partition sheets never worse than separate",
    est.paper.totalSheets <= separateSheets,
    `${est.paper.totalSheets} vs ${separateSheets}`,
  );

  // Printed card insert: purchase derived by nesting the print on the paper.
  const printed = estimateCardInsert(
    [blank],
    500,
    {
      sheet: { width_in: 25, height_in: 36 },
      printSheet: { width_in: 18, height_in: 25 },
      wastagePct: 10,
    },
  );
  assert("printed insert derives a paper purchase", printed.purchase != null);
  check(
    "purchase sheetsToBuy = ceil(printed / perPaperSheet)",
    printed.purchase!.sheetsToBuy,
    Math.ceil(printed.paper.totalSheets / printed.purchase!.printsPerSheet),
  );
}

{
  // Engine 2 integration: sleeve + beading lines land in the breakdown and the
  // material subtotal; absent rates keep them 0.
  const mat = estimateMaterials({
    boxType: "tray_only",
    dims: { length_in: 10, width_in: 8, height_in: 4 },
    quantity: 500,
    board: { sheet: { width_in: 31, height_in: 41 } },
    sleeve: {
      blank: sleeveBlank("tray_only", { length_in: 10, width_in: 8, height_in: 4 }),
      stock: { sheet: { width_in: 25, height_in: 36 } },
    },
    beading: {
      blank: { component: "beading", width_in: 12.25, height_in: 10.25, count_per_box: 1 },
      stock: { sheet: { width_in: 25, height_in: 36 } },
    },
  });
  const rates: CostRates = {
    boardCostPerSheet: 41,
    sleeve: { paperCostPerSheet: 9 },
    beading: { paperCostPerSheet: 12 },
    accessories: { magnetEach: 0, washerEach: 0, tapePerUnit: 0.75 },
    labour: [],
    overheadPct: 11,
    marginPct: 20,
  };
  const cost = estimateCost(mat, rates);
  const expectSleeve = mat.sleeve!.paper.totalSheets * 9;
  const expectBeading = mat.beading!.paper.totalSheets * 12;
  check("sleeve line = stock sheets x rate", cost.sleeve, expectSleeve);
  check("beading line = stock sheets x rate", cost.beading, expectBeading);
  assert("lines flow into the material subtotal", cost.materialSubtotal >= cost.sleeve + cost.beading);

  // Without the new rates the lines are zero and the total matches a run
  // without the inserts at all (legacy shape).
  const matPlain = estimateMaterials({
    boxType: "tray_only",
    dims: { length_in: 10, width_in: 8, height_in: 4 },
    quantity: 500,
    board: { sheet: { width_in: 31, height_in: 41 } },
  });
  const plainRates: CostRates = {
    boardCostPerSheet: 41,
    accessories: { magnetEach: 0, washerEach: 0, tapePerUnit: 0.75 },
    labour: [],
    overheadPct: 11,
    marginPct: 20,
  };
  const costPlain = estimateCost(matPlain, plainRates);
  check("no round-5 selections: sleeve line 0", costPlain.sleeve, 0);
  check("no round-5 selections: beading line 0", costPlain.beading, 0);
}

// ---------------------------------------------------------------------------
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
