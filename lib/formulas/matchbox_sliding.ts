// Match-box sliding box — 2 components (tray + sleeve).
//
// Blank formulas (client doc, inches):
//   tray:   (H + L + H) x (H + W + H)
//   sleeve: (W + H + W + H) x L
//
// Variable: sleeve material (kappa / duplex / CyberXL / custom) — cost-only.
//
// Round 7 (client final doc item 4A names matchbox alongside telescopic and
// drawer): the sleeve wraps the tray's OUTER footprint, so every L and W term
// grows by fitAllowance_in (= 2 x board thickness + 1 mm, lib/formulas/fit.ts)
// — both girth W panels must span the tray's outer width, and the sleeve's
// length must clear the tray's outer length. The girth H terms stay as stated:
// her rule names only L and W. Absent allowance = 0 = the original formula.

import type { Blank, BoxDimensions, BoxVariables } from "@/types";

export function matchboxSlidingBlanks(
  dims: BoxDimensions,
  vars: BoxVariables = {},
): Blank[] {
  const { length_in: L, width_in: W, height_in: H } = dims;
  const f = vars.fitAllowance_in ?? 0;

  return [
    {
      component: "tray",
      width_in: H + L + H,
      height_in: H + W + H,
      count_per_box: 1,
    },
    {
      component: "sleeve",
      width_in: W + f + H + (W + f) + H,
      height_in: L + f,
      count_per_box: 1,
    },
  ];
}
