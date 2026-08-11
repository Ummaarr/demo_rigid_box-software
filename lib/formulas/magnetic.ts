// Magnetic box — 2 components (case + tray). Case has 3 / 4 / 5 panel variants.
//
// Blank formulas (client doc, inches):
//   tray:               (H + L + H) x (H + W + H)
//   3-panel case:       (Flap + W + H) x L
//   Regular 4-panel:    (Flap + W + H + W) x L
//   5-panel case:       (Flap + W + H + W + FlapHeight) x L
//
// Variables: flapLength_in (required), panels (3/4/5, default 4 = Regular),
//            flapHeight_in (required only for 5-panel), closure (cost-only).

import type { Blank, BoxDimensions, BoxVariables } from "@/types";
import { requireVar } from "./util";

const BOX = "magnetic";

export function magneticBlanks(
  dims: BoxDimensions,
  vars: BoxVariables = {},
): Blank[] {
  const { length_in: L, width_in: W, height_in: H } = dims;
  const flap = requireVar(vars.flapLength_in, "flapLength_in", BOX);
  const panels = vars.panels ?? 4;

  let caseWidth: number;
  switch (panels) {
    case 3:
      caseWidth = flap + W + H;
      break;
    case 4:
      caseWidth = flap + W + H + W;
      break;
    case 5: {
      const flapHeight = requireVar(vars.flapHeight_in, "flapHeight_in", BOX);
      caseWidth = flap + W + H + W + flapHeight;
      break;
    }
    default:
      throw new Error(`${BOX}: panels must be 3, 4, or 5 (got ${panels}).`);
  }

  return [
    {
      component: "tray",
      width_in: H + L + H,
      height_in: H + W + H,
      count_per_box: 1,
    },
    {
      component: "case",
      width_in: caseWidth,
      height_in: L,
      count_per_box: 1,
    },
  ];
}

/**
 * INNER LINING blanks (client 5-Aug: "inner printing for magnetic case should
 * only take into account inner case, flap and spine").
 *
 * The tray is glued over one of the case's W panels, so that panel's inner face
 * is never seen and needs no lining. The lined area is therefore flap + one
 * case panel + spine = (Flap + W + H) x L, for EVERY panel variant
 * (client-confirmed): 3-panel already is that, 4-panel drops its second W, and
 * 5-panel drops its second W and its flap-height panel.
 *
 * The TRAY's lining is unchanged (full tray keyline), and board + outer wrap
 * are untouched — this only shrinks what the inner layer nests.
 *
 * Applied via lib/formulas/inner-lining.ts and gated on
 * EstimateRequest.liningVersion >= 2, so pre-round-10 snapshots recompute
 * byte-identically.
 */
export function magneticLiningBlanks(
  blanks: Blank[],
  dims: BoxDimensions,
  vars: BoxVariables = {},
): Blank[] {
  const { width_in: W, height_in: H } = dims;
  const flap = requireVar(vars.flapLength_in, "flapLength_in", BOX);
  const linedWidth = flap + W + H;
  return blanks.map((b) =>
    b.component === "case" ? { ...b, width_in: linedWidth } : b,
  );
}
