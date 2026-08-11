// Only tray (client 8-Jul: "one more option under box type — only tray").
// A single open tray with no lid/case/sleeve — 1 component.
//
// Blank formula (same tray geometry as the telescopic/magnetic tray,
// all dimensions in inches):
//   tray: (H + L + H) x (H + W + H)
//
// No box variables. Tape auto-applies (the engine keys tape off components
// named tray/lid); no magnets, metlock or ribbon tag.

import type { Blank, BoxDimensions, BoxVariables } from "@/types";

export function trayOnlyBlanks(
  dims: BoxDimensions,
  _vars: BoxVariables = {},
): Blank[] {
  const { length_in: L, width_in: W, height_in: H } = dims;

  return [
    {
      component: "tray",
      width_in: H + L + H,
      height_in: H + W + H,
      count_per_box: 1,
    },
  ];
}
