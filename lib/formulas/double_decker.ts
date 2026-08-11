// Double decker box — 4 components (case + tray 1 + tray 2 + drawer sleeve).
//
// Blank formulas (client doc, inches):
//   case:    (Flap + W + [H1 + H2] + W) x L
//   tray 1:  (H1 + L + H1) x (H1 + W + H1)
//   tray 2:  (H2 + L + H2) x (H2 + W + H2)
//   sleeve:  (W + H1) x (L + H + L + H1)        [doc update 2026-06-19 — NEW]
//
// NOTE: the doc wrote tray 1 as (H1 + L + H1) x (H1 + W + H); the client has
// confirmed the trailing term is H1 (tray 2 is consistently H2). Resolved.
//
// Variables: flapLength_in, trayHeight1_in (H1), trayHeight2_in (H2).
// The drawer sleeve uses overall H (like the drawer-sliding sleeve) plus H1.

import type { Blank, BoxDimensions, BoxVariables } from "@/types";
import { requireVar } from "./util";

const BOX = "double_decker";

export function doubleDeckerBlanks(
  dims: BoxDimensions,
  vars: BoxVariables = {},
): Blank[] {
  const { length_in: L, width_in: W, height_in: H } = dims;
  const flap = requireVar(vars.flapLength_in, "flapLength_in", BOX);
  const H1 = requireVar(vars.trayHeight1_in, "trayHeight1_in", BOX);
  const H2 = requireVar(vars.trayHeight2_in, "trayHeight2_in", BOX);

  return [
    {
      component: "case",
      width_in: flap + W + (H1 + H2) + W,
      height_in: L,
      count_per_box: 1,
    },
    {
      component: "tray_1",
      width_in: H1 + L + H1,
      height_in: H1 + W + H1,
      count_per_box: 1,
    },
    {
      component: "tray_2",
      width_in: H2 + L + H2,
      height_in: H2 + W + H2,
      count_per_box: 1,
    },
    {
      component: "sleeve",
      width_in: W + H1,
      height_in: L + H + L + H1,
      count_per_box: 1,
    },
  ];
}
