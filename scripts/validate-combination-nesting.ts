// Validates combination nesting (client's "cut different parts on one sheet"
// method). Two guarantees we care about:
//   1. Combined is NEVER worse than separate nesting.
//   2. When components differ a lot in size, combining actually wins.
// Run: npx tsx scripts/validate-combination-nesting.ts

import { estimateBoardMaterial, estimateMaterials, estimatePaperMaterial } from "@/lib/engines/material";
import type { Blank, BoxType, BoxDimensions, BoxVariables } from "@/types";

let failures = 0;
function assert(label: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  <- ${detail}`}`);
  if (!cond) failures++;
}

const SHEET = { width_in: 31, height_in: 41 };
const QTY = 500;

// --- Case 1: two full-height parts that only tile as SIDE-BY-SIDE strips ------
// A (16x41) and B (15x41) each fill the sheet height; 16+15=31 = full width.
// Separate: A -> 1/sheet -> 500; B -> floor(31/15)=2 across x 1 -> 2/sheet -> 250 = 750.
// Combined (cols): one 16-wide strip of A + one 15-wide strip of B = 1 box/sheet
// -> ceil(500/1) = 500 < 750. This win needs the vertical-strip direction.
{
  const blanks: Blank[] = [
    { component: "panel_a", width_in: 16, height_in: 41, count_per_box: 1 },
    { component: "panel_b", width_in: 15, height_in: 41, count_per_box: 1 },
  ];
  const est = estimateBoardMaterial(blanks, QTY, SHEET, {}, true);
  const c = est.combination!;
  const g = c.groups[0];
  console.log(
    `Case 1 (panel 16x41 + panel 15x41, qty ${QTY}): separate=${c.separateSheets}, ` +
      `combined=${c.combinedSheets}, applied=${c.applied}, dir=${g?.direction}, ` +
      `boxes/sheet=${g?.boxesPerSheet}, total=${est.totalSheets}`,
  );
  assert("Case 1 separate is 750", c.separateSheets === 750, `got ${c.separateSheets}`);
  assert("Case 1 combination applied", c.applied === true);
  assert("Case 1 one combined group of both parts", c.groups.length === 1 && g.components.length === 2);
  assert("Case 1 used column direction", g?.direction === "cols", `dir ${g?.direction}`);
  assert("Case 1 total < separate", est.totalSheets < c.separateSheets, `total ${est.totalSheets} !< ${c.separateSheets}`);
  assert("Case 1 total == combined (500)", est.totalSheets === 500, `total ${est.totalSheets}`);
}

// --- Case 1b: PARTIAL combination — doc's "1+2 with 3 alone" must be found ----
// Panels A (16x41) and B (15x41) combine perfectly (Case 1). Add a small card
// (6x5): alone it packs 5x8=40/sheet -> 13 sheets. Forcing it INTO the shared
// sheet would break the perfect 16+15=31 width fit, so the best plan is
// {A+B combined} + {card separate} = 500 + 13 = 513. All-combined or
// all-separate are both worse — only the partition search finds 513.
{
  const blanks: Blank[] = [
    { component: "panel_a", width_in: 16, height_in: 41, count_per_box: 1 },
    { component: "panel_b", width_in: 15, height_in: 41, count_per_box: 1 },
    { component: "card", width_in: 6, height_in: 5, count_per_box: 1 },
  ];
  const est = estimateBoardMaterial(blanks, QTY, SHEET, {}, true);
  const c = est.combination!;
  console.log(
    `Case 1b (16x41 + 15x41 + card 6x5, qty ${QTY}): separate=${c.separateSheets}, ` +
      `combined=${c.combinedSheets}, groups=[${c.groups.map((x) => x.components.join("+")).join(", ")}], ` +
      `alone=[${c.separateComponents.join(", ")}]`,
  );
  assert("Case 1b applied", c.applied === true);
  assert("Case 1b total is 513", est.totalSheets === 513, `got ${est.totalSheets}`);
  assert(
    "Case 1b card cut alone",
    c.separateComponents.length === 1 && c.separateComponents[0] === "card",
    `alone=[${c.separateComponents.join(",")}]`,
  );
}

// --- Case 2: identical-size components — combining can't beat separate --------
// Two identical 12x10 blanks. Separate = 2 * ceil(500/ (2*4=8)) = 2*63 = 126.
// Combined must not exceed that (never-worse invariant); typically equals it.
{
  const blanks: Blank[] = [
    { component: "lid", width_in: 12, height_in: 10, count_per_box: 1 },
    { component: "tray", width_in: 12, height_in: 10, count_per_box: 1 },
  ];
  const est = estimateBoardMaterial(blanks, QTY, SHEET, {}, true);
  const separate = est.combination!.separateSheets;
  console.log(
    `Case 2 (two 12x10, qty ${QTY}): separate=${separate}, combined=${est.combination!.combinedSheets}, total=${est.totalSheets}`,
  );
  assert("Case 2 never worse", est.totalSheets <= separate, `total ${est.totalSheets} > ${separate}`);
}

// --- Case 3: never-worse invariant across many random shapes -----------------
{
  let checked = 0;
  let wins = 0;
  const rnd = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
  for (let i = 0; i < 2000; i++) {
    const n = rnd(2, 4);
    const blanks: Blank[] = Array.from({ length: n }, (_, j) => ({
      component: `c${j}`,
      width_in: rnd(4, 28),
      height_in: rnd(4, 38),
      count_per_box: rnd(1, 2),
    }));
    // Skip shapes that don't fit the sheet at all in either orientation.
    const fits = blanks.every(
      (b) =>
        (b.width_in <= SHEET.width_in && b.height_in <= SHEET.height_in) ||
        (b.height_in <= SHEET.width_in && b.width_in <= SHEET.height_in),
    );
    if (!fits) continue;
    const est = estimateBoardMaterial(blanks, rnd(100, 2000), SHEET, {}, true);
    const c = est.combination!;
    if (!Number.isFinite(c.separateSheets)) continue;
    checked++;
    if (est.totalSheets > c.separateSheets) {
      failures++;
      console.log(`  FAIL  never-worse violated: ${JSON.stringify(blanks)} total=${est.totalSheets} sep=${c.separateSheets}`);
      break;
    }
    if (c.applied) wins++;
  }
  console.log(`Case 3: ${checked} random layouts checked, ${wins} combined-wins, 0 violations expected`);
  assert("Case 3 never-worse held across all random layouts", true);
}

// --- Case 4: real box types via the full orchestrator ------------------------
{
  const cases: { boxType: BoxType; dims: BoxDimensions; vars: BoxVariables }[] = [
    { boxType: "magnetic", dims: { length_in: 10, width_in: 8, height_in: 4 }, vars: { flapLength_in: 1, panels: 4 } },
    { boxType: "shoulder", dims: { length_in: 9, width_in: 6, height_in: 3 }, vars: { lidDepth_in: 1.5, neckHeight_in: 1, bottomHeight_in: 2.5 } },
    { boxType: "double_decker", dims: { length_in: 12, width_in: 9, height_in: 6 }, vars: { flapLength_in: 1, trayHeight1_in: 3, trayHeight2_in: 3 } },
  ];
  for (const c of cases) {
    const mat = estimateMaterials({
      boxType: c.boxType,
      dims: c.dims,
      vars: c.vars,
      quantity: QTY,
      board: { sheet: SHEET },
    });
    const combo = mat.board.combination;
    const sep = combo?.separateSheets ?? mat.board.totalSheets;
    console.log(
      `Case 4 ${c.boxType}: components=${mat.board.components.length}, separate=${sep}, ` +
        `total=${mat.board.totalSheets}, applied=${combo?.applied ?? false}`,
    );
    assert(`Case 4 ${c.boxType} never worse`, mat.board.totalSheets <= sep, `total ${mat.board.totalSheets} > ${sep}`);
  }
}

// --- Case 5: paper combination via estimatePaperMaterial (2026-07-08 ext.) ---
// Same shapes as Case 1 (16x41 + 15x41 combine to 500 vs 750 separate), but
// routed through estimatePaperMaterial with allowance_mm=0 (paper blank ==
// board blank) to confirm the new `combine` param threads through correctly.
{
  const blanks: Blank[] = [
    { component: "panel_a", width_in: 16, height_in: 41, count_per_box: 1 },
    { component: "panel_b", width_in: 15, height_in: 41, count_per_box: 1 },
  ];
  const est = estimatePaperMaterial(blanks, QTY, SHEET, "outer", 0, {}, 0, true);
  const c = est.combination!;
  console.log(
    `Case 5 (paper, same shapes as Case 1): separate=${c.separateSheets}, ` +
      `combined=${c.combinedSheets}, total=${est.totalSheets}`,
  );
  assert("Case 5 paper combination applied", c.applied === true);
  assert("Case 5 paper total == combined (500)", est.totalSheets === 500, `got ${est.totalSheets}`);
}

// --- Case 6: wastage inflation is combination-aware, not the old buggy resum -
// Same shapes as Case 1b (group {A+B}=500, alone {card}=13, combined total
// 513 pre-wastage) with 10% wastage. Correct: inflate the GROUP once (500 ->
// 550) + the alone part individually (13 -> 15) = 565. The bug being fixed
// would have re-summed each ORIGINAL SEPARATE component's inflated count
// instead (panel_a 500->550, panel_b 250->275, card 13->15 = 840) — assert
// the result is the correct 565 and explicitly NOT the buggy 840.
{
  const blanks: Blank[] = [
    { component: "panel_a", width_in: 16, height_in: 41, count_per_box: 1 },
    { component: "panel_b", width_in: 15, height_in: 41, count_per_box: 1 },
    { component: "card", width_in: 6, height_in: 5, count_per_box: 1 },
  ];
  const est = estimatePaperMaterial(blanks, QTY, SHEET, "outer", 0, {}, 10, true);
  const c = est.combination!;
  console.log(
    `Case 6 (paper + 10% wastage, same shapes as Case 1b): combined=${c.combinedSheets}, ` +
      `separate(inflated)=${c.separateSheets}, total=${est.totalSheets}`,
  );
  assert("Case 6 total is 565 (group inflated once + alone part inflated)", est.totalSheets === 565, `got ${est.totalSheets}`);
  assert("Case 6 total is NOT the old buggy re-sum (840)", est.totalSheets !== 840, `got ${est.totalSheets}`);
  assert("Case 6 still never worse than separate", est.totalSheets <= c.separateSheets, `total ${est.totalSheets} > sep ${c.separateSheets}`);
}

// --- Case 7: never-worse holds under wastage across many random shapes -------
// Same random-shape approach as Case 3, but through estimatePaperMaterial
// with a random wastagePct each iteration — the invariant must survive
// independent per-group rounding after inflation (see applyWastage's proof).
{
  let checked = 0;
  let wins = 0;
  const rnd = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
  for (let i = 0; i < 2000; i++) {
    const n = rnd(2, 4);
    const blanks: Blank[] = Array.from({ length: n }, (_, j) => ({
      component: `c${j}`,
      width_in: rnd(4, 28),
      height_in: rnd(4, 38),
      count_per_box: rnd(1, 2),
    }));
    const fits = blanks.every(
      (b) =>
        (b.width_in <= SHEET.width_in && b.height_in <= SHEET.height_in) ||
        (b.height_in <= SHEET.width_in && b.width_in <= SHEET.height_in),
    );
    if (!fits) continue;
    const wastagePct = rnd(0, 20);
    const est = estimatePaperMaterial(blanks, rnd(100, 2000), SHEET, "outer", 0, {}, wastagePct, true);
    const c = est.combination!;
    if (!Number.isFinite(c.separateSheets)) continue;
    checked++;
    if (est.totalSheets > c.separateSheets) {
      failures++;
      console.log(
        `  FAIL  never-worse (wastage) violated: ${JSON.stringify(blanks)} wastage=${wastagePct}% ` +
          `total=${est.totalSheets} sep=${c.separateSheets}`,
      );
      break;
    }
    if (c.applied) wins++;
  }
  console.log(`Case 7: ${checked} random layouts (with random wastage) checked, ${wins} combined-wins, 0 violations expected`);
  assert("Case 7 never-worse held across all random layouts under wastage", true);
}

// --- Case 8: end-to-end through estimateMaterials, printed outer wrap --------
// Real box type (telescopic: tray + lid, 2 components) with a printed outer
// wrap. printSheet == sheet (printsPerSheet=1) so sheetsToBuy should track
// totalSheets directly, confirming derivePaperPurchase correctly consumes
// the now-combination-aware totalSheets with zero changes of its own.
{
  const mat = estimateMaterials({
    boxType: "telescopic",
    dims: { length_in: 10, width_in: 8, height_in: 4 },
    vars: { lidDepth_in: 1.5 },
    quantity: QTY,
    board: { sheet: SHEET },
    outerPaper: { sheet: SHEET, printSheet: SHEET, wastagePct: 10 },
  });
  const outer = mat.outerPaper!;
  const purchase = mat.outerPaperPurchase!;
  console.log(
    `Case 8 (telescopic, printed outer wrap): components=${outer.components.length}, ` +
      `applied=${outer.combination?.applied ?? false}, totalSheets=${outer.totalSheets}, ` +
      `sheetsToBuy=${purchase.sheetsToBuy}, printsPerSheet=${purchase.printsPerSheet}`,
  );
  assert("Case 8 outer wrap has a combination result", outer.combination !== undefined);
  assert(
    "Case 8 sheetsToBuy == ceil(totalSheets / printsPerSheet)",
    purchase.sheetsToBuy === Math.ceil(outer.totalSheets / purchase.printsPerSheet),
    `sheetsToBuy=${purchase.sheetsToBuy} totalSheets=${outer.totalSheets} printsPerSheet=${purchase.printsPerSheet}`,
  );
  if (outer.combination?.applied) {
    assert(
      "Case 8 combined total sheets < separate (combination is winning here)",
      outer.totalSheets < outer.combination.separateSheets,
      `total ${outer.totalSheets} !< sep ${outer.combination.separateSheets}`,
    );
  }
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
