// Collapsible rigid box — 3 components (case + 2 tray pieces).
//
// Blank formulas (client doc v2, inches):
//   case:        (Flap + W + H + W + H) x L
//   tray pieces: 2 x  (H + W + H) x (H + H)   -> two identical pieces
//
// The client supplied the tray-piece formula in the v2 doc ("2 x (H+W+H) x
// (H+H)"), so this box type is no longer blocked. L is not used by the tray
// pieces — only by the case.
//
// Variables: flapLength_in (required), adhesive tape + closure (cost-only).

import type { Blank, BoxDimensions, BoxVariables } from "@/types";
import { requireVar } from "./util";

const BOX = "collapsible_rigid";

export function collapsibleRigidBlanks(
  dims: BoxDimensions,
  vars: BoxVariables = {},
): Blank[] {
  const { length_in: L, width_in: W, height_in: H } = dims;
  const flap = requireVar(vars.flapLength_in, "flapLength_in", BOX);

  return [
    {
      component: "case",
      width_in: flap + W + H + W + H,
      height_in: L,
      count_per_box: 1,
    },
    {
      component: "tray_piece",
      width_in: H + W + H,
      height_in: H + H,
      count_per_box: 2, // two identical tray pieces
    },
  ];
}
