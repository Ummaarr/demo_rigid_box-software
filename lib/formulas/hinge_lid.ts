// Hinge lid box — 3 components (tray + inner box + lid).
// The client doc names them base / inner box / lid; "base" and "tray" are used
// interchangeably (client confirmed), so we name it "tray" for consistency with
// the other box types and so it auto-includes tape. The "inner box" uses the
// neck formula, so geometrically this matches the shoulder box.
//
// Blank formulas (client doc, inches):
//   tray (base): (BH + L + BH) x (BH + W + BH)
//   inner box (neck): (NH + L + NH) x (NH + W + NH)
//   lid: (Depth + L + Depth) x (Depth + W + Depth)
//
// Variables: bottomHeight_in (BH), neckHeight_in (NH), lidDepth_in (default 1.5),
//            ribbon support (with/without) — cost-only.

import type { Blank, BoxDimensions, BoxVariables } from "@/types";
import { requireVar } from "./util";

const BOX = "hinge_lid";
const DEFAULT_LID_DEPTH_IN = 1.5;

export function hingeLidBlanks(
  dims: BoxDimensions,
  vars: BoxVariables = {},
): Blank[] {
  const { length_in: L, width_in: W, height_in: H } = dims;
  const BH = requireVar(vars.bottomHeight_in, "bottomHeight_in", BOX);
  const NH = requireVar(vars.neckHeight_in, "neckHeight_in", BOX);
  const depth = vars.lidDepth_in ?? DEFAULT_LID_DEPTH_IN;

  void H; // tray uses BH, not H; H kept for a uniform call shape.

  return [
    {
      component: "tray",
      width_in: BH + L + BH,
      height_in: BH + W + BH,
      count_per_box: 1,
    },
    {
      component: "inner_box",
      width_in: NH + L + NH,
      height_in: NH + W + NH,
      count_per_box: 1,
    },
    {
      component: "lid",
      width_in: depth + L + depth,
      height_in: depth + W + depth,
      count_per_box: 1,
    },
  ];
}
