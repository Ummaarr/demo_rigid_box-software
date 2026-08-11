// Telescopic box — 2 components (tray + lid).
//
// Blank formulas (confirmed from client doc, all dimensions in inches):
//   tray: (H + L + H) x (H + W + H)
//   lid:  (Depth + L + Depth) x (Depth + W + Depth)
//
// The lid "telescopes" over the base, so the lid uses its own depth (how far
// it slides down) rather than the full box height. Depth defaults to 1.5 in
// when the customer does not specify one.
//
// Round 6 (client 15-Jul, refined round 7): the lid must clear the tray's
// OUTER footprint plus slip clearance, so its L/W each grow by
// fitAllowance_in (= 2 x board thickness + 1 mm, lib/formulas/fit.ts).
// Absent allowance = 0 = the original formula.

import type { Blank, BoxDimensions, BoxVariables } from "@/types";

const DEFAULT_LID_DEPTH_IN = 1.5;

export function telescopicBlanks(
  dims: BoxDimensions,
  vars: BoxVariables = {},
): Blank[] {
  const { length_in: L, width_in: W, height_in: H } = dims;
  const depth = vars.lidDepth_in ?? DEFAULT_LID_DEPTH_IN;
  const f = vars.fitAllowance_in ?? 0;

  return [
    {
      component: "tray",
      width_in: H + L + H,
      height_in: H + W + H,
      count_per_box: 1,
    },
    {
      component: "lid",
      width_in: depth + (L + f) + depth,
      height_in: depth + (W + f) + depth,
      count_per_box: 1,
    },
  ];
}
