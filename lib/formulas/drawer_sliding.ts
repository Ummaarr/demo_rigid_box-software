// Drawer sliding box — 2 components (tray + sleeve).
//
// Blank formulas (client doc, inches):
//   tray:   (H + L + H) x (H + W + H)
//   sleeve: (W + H) x (L + H + L + H)
//
// Variable: sleeve material (kappa / duplex / CyberXL / custom) — a material
// choice handled by the cost engine, not a dimension, so the geometry is fixed.
//
// Round 6 (client 15-Jul, refined round 7 item 4A): the sleeve wraps the
// tray's OUTER footprint, so EVERY L and W term grows by fitAllowance_in
// (= 2 x board thickness + 1 mm, lib/formulas/fit.ts) — both girth L panels
// must span the tray's outer length. The girth H terms stay as stated: her
// rule names only L and W. Absent allowance = 0.

import type { Blank, BoxDimensions, BoxVariables } from "@/types";

export function drawerSlidingBlanks(
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
      width_in: W + f + H,
      height_in: L + f + H + (L + f) + H,
      count_per_box: 1,
    },
  ];
}
