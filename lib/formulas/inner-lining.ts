// Inner-lining blank registry (round 10).
//
// By default a component's inner lining is its board keyline EXACTLY — that is
// the client's own rule and what every box type does. A few box types have
// panels that end up hidden by another component and so are never lined; those
// register a mapper here.
//
// WHY A SEPARATE REGISTRY rather than the box-type formula emitting a smaller
// blank: formulas re-run at recompute time from a saved specs_snapshot, so a
// formula that unconditionally emitted a shrunken lining would retroactively
// re-price every estimate ever saved. Mapping at the inner-layer boundary
// instead keeps `MaterialQuantities.blanks` as the board keylines (which the
// keylines, the materials PDF and the result panel all read) and leaves the
// board and outer-wrap paths structurally untouched.
//
// The mapping is gated on EstimateRequest.liningVersion >= 2 in
// estimateMaterials — see MaterialInput.liningVersion.

import type { Blank, BoxDimensions, BoxType, BoxVariables } from "@/types";

import { magneticLiningBlanks } from "./magnetic";

/** Board blanks -> the blanks the INNER lining layer should nest. */
export type LiningFormula = (
  blanks: Blank[],
  dims: BoxDimensions,
  vars: BoxVariables,
) => Blank[];

/** Only box types whose lining differs from their keyline appear here. */
const liningFormulas: Partial<Record<BoxType, LiningFormula>> = {
  magnetic: magneticLiningBlanks,
};

/**
 * Inner-lining blanks for a box type. Unregistered box types return the board
 * blanks UNCHANGED (same array reference), so the default path is provably
 * identical to not calling this at all.
 */
export function innerLiningBlanksFor(
  boxType: BoxType,
  blanks: Blank[],
  dims: BoxDimensions,
  vars: BoxVariables = {},
): Blank[] {
  const fn = liningFormulas[boxType];
  return fn ? fn(blanks, dims, vars) : blanks;
}
