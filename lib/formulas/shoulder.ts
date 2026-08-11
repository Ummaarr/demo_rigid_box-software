// Shoulder box — 3 components (tray + neck + lid).
//
// Blank formulas (client doc, inches):
//   tray: (BH + L + BH) x (BH + W + BH)
//   neck: (NH + L + NH) x (NH + W + NH)
//   lid:  (Depth + L + Depth) x (Depth + W + Depth)
//
// Variables: bottomHeight_in (BH), neckHeight_in (NH), lidDepth_in (default 1.5).
//
// Round 6 (client 15-Jul, refined round 7 item 4B): "auto-add kappa board
// thickness on each side of L + W for BOTH lid and tray, plus 1mm" — so the
// lid AND the tray each grow by fitAllowance_in (= 2t + 1mm,
// lib/formulas/fit.ts). The NECK is untouched: she named only lid and tray.
// Absent allowance = 0 = the original formula.

import type { Blank, BoxDimensions, BoxVariables } from "@/types";
import { requireVar } from "./util";

const BOX = "shoulder";
const DEFAULT_LID_DEPTH_IN = 1.5;

export function shoulderBlanks(
  dims: BoxDimensions,
  vars: BoxVariables = {},
): Blank[] {
  const { length_in: L, width_in: W, height_in: H } = dims;
  const BH = requireVar(vars.bottomHeight_in, "bottomHeight_in", BOX);
  const NH = requireVar(vars.neckHeight_in, "neckHeight_in", BOX);
  const depth = vars.lidDepth_in ?? DEFAULT_LID_DEPTH_IN;
  const f = vars.fitAllowance_in ?? 0;

  // H is unused in the shoulder formula (bottom uses BH, not H) but is part of
  // the standard L/W/H input; kept in the signature for a uniform call shape.
  void H;

  return [
    {
      component: "tray",
      width_in: BH + (L + f) + BH,
      height_in: BH + (W + f) + BH,
      count_per_box: 1,
    },
    {
      component: "neck",
      width_in: NH + L + NH,
      height_in: NH + W + NH,
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
