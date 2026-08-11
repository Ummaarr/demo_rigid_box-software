// Formula registry — maps each BoxType to its blank-dimension function.
// Engine 1 calls getBlanks(boxType, dims, vars); it never imports a specific
// box-type file directly, so adding/altering a box type touches only this map.

import type { BlankFormula, Blank, BoxType, BoxDimensions, BoxVariables } from "@/types";

import { telescopicBlanks } from "./telescopic";
import { magneticBlanks } from "./magnetic";
import { shoulderBlanks } from "./shoulder";
import { drawerSlidingBlanks } from "./drawer_sliding";
import { matchboxSlidingBlanks } from "./matchbox_sliding";
import { hingeLidBlanks } from "./hinge_lid";
import { collapsibleRigidBlanks } from "./collapsible_rigid";
import { doubleDeckerBlanks } from "./double_decker";
import { trayOnlyBlanks } from "./tray_only";

export const blankFormulas: Record<BoxType, BlankFormula> = {
  telescopic: telescopicBlanks,
  magnetic: magneticBlanks,
  shoulder: shoulderBlanks,
  drawer_sliding: drawerSlidingBlanks,
  matchbox_sliding: matchboxSlidingBlanks,
  hinge_lid: hingeLidBlanks,
  collapsible_rigid: collapsibleRigidBlanks,
  double_decker: doubleDeckerBlanks,
  tray_only: trayOnlyBlanks,
};

/** Compute the board blanks for a box type. Throws for collapsible_rigid until
 *  the client provides its tray-piece formula, or for missing/invalid vars. */
export function getBlanks(
  boxType: BoxType,
  dims: BoxDimensions,
  vars: BoxVariables = {},
): Blank[] {
  return blankFormulas[boxType](dims, vars);
}
