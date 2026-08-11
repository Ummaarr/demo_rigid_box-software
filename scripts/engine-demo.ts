// Dev demo: exercise every box-type formula + Engine 1 board nesting with
// example inputs and print the blanks + sheets needed. Not a test suite — just
// a quick "do the numbers look sane" harness. Run: npx tsx scripts/engine-demo.ts

import type { BoxDimensions, BoxType, BoxVariables } from "@/types";
import { getBlanks } from "@/lib/formulas";
import { estimateBoardMaterial, type Sheet } from "@/lib/engines/material";

const BOARD: Sheet = { width_in: 31, height_in: 41 }; // standard kappa
const QTY = 500;
const dims: BoxDimensions = { length_in: 10, width_in: 8, height_in: 4 };

// Example variables sufficient for every box type.
const vars: BoxVariables = {
  lidDepth_in: 1.5,
  neckHeight_in: 2,
  bottomHeight_in: 4,
  flapLength_in: 1.5,
  panels: 4,
  flapHeight_in: 1,
  trayHeight1_in: 2,
  trayHeight2_in: 2,
};

const boxTypes: BoxType[] = [
  "telescopic",
  "magnetic",
  "shoulder",
  "drawer_sliding",
  "matchbox_sliding",
  "hinge_lid",
  "collapsible_rigid",
  "double_decker",
];

console.log(`Box ${dims.length_in}x${dims.width_in}x${dims.height_in} in, qty ${QTY}, board ${BOARD.width_in}x${BOARD.height_in}\n`);

for (const boxType of boxTypes) {
  console.log(`=== ${boxType} ===`);
  try {
    const blanks = getBlanks(boxType, dims, vars);
    const est = estimateBoardMaterial(blanks, QTY, BOARD);
    for (const c of est.components) {
      const o = c.orientation;
      console.log(
        `  ${c.component.padEnd(10)} ${c.blank.width_in}x${c.blank.height_in}` +
          `  A=${o.perSheetA} B=${o.perSheetB} -> ${c.perSheet}/sheet (${c.chosen})` +
          `  sheets=${c.sheetsNeeded}`,
      );
    }
    console.log(`  TOTAL board sheets: ${est.totalSheets}\n`);
  } catch (err) {
    console.log(`  BLOCKED: ${(err as Error).message}\n`);
  }
}
