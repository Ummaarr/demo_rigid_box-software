// Lid/sleeve fit allowance (round 6, refined round 7 from the client's final
// requirements doc, item 4).
//
// The piece that slides OVER the base must clear the base's OUTER dimensions
// plus a slip clearance. Her rule: "for each open measurement, auto-add
// (kappa board thickness for each side of L and W) + 1mm".
//
//   growth per dimension = 2 x board thickness + 1 mm
//
// (Her worked example writes only a single thickness term, but the prose says
// "for each side" and repeats the +1mm for shoulder boxes too; two thicknesses
// is also the only reading that physically clears the tray, whose outer L is
// L + 2t. Flagged to the client.)
//
// Which component grows, per her items 4A + 4B:
//   telescopic       - lid
//   drawer_sliding   - sleeve
//   matchbox_sliding - sleeve
//   shoulder         - lid AND tray (neck untouched; she named only those two)
//
// The value travels as vars.fitAllowance_in on the estimate request: the
// server injects it before snapshotting (build-estimate) and the form mirrors
// it for previews/keylines. Old snapshots have no var -> 0 -> unchanged blanks.
//
// NOTE the units contract: fitAllowance_in is the TOTAL inches added to each
// of L and W (not per side), so formulas read `L + f`, never `L + 2*f`.

import type { BoxType } from "@/types";

const MM_PER_INCH = 25.4;

/** Slip clearance added on top of the two board thicknesses (client: "+ 1mm"). */
const CLEARANCE_MM = 1;

/** Box types whose over-sliding component clears the base by board thickness. */
export const FIT_ALLOWANCE_TYPES: ReadonlySet<BoxType> = new Set([
  "telescopic",
  "shoulder",
  "drawer_sliding",
  "matchbox_sliding",
]);

/**
 * Total fit allowance (inches) added to EACH of L and W on the over-sliding
 * component, or undefined when the box type has none.
 * = 2 x board thickness + 1 mm.
 */
export function fitAllowanceIn(
  boxType: BoxType,
  boardThickness_mm: number,
): number | undefined {
  if (!FIT_ALLOWANCE_TYPES.has(boxType)) return undefined;
  if (!Number.isFinite(boardThickness_mm) || boardThickness_mm <= 0) {
    return undefined;
  }
  return (2 * boardThickness_mm + CLEARANCE_MM) / MM_PER_INCH;
}
