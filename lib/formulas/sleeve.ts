// Sleeve ADD-ON insert (round 5, client 13-Jul): "the Sleeve section functions
// exactly like the 'sleeve' in the rigid box keyline — let the engine
// automatically take the same formula and values as the sleeve would
// otherwise". Not a box type — a standalone insert available on any estimate.
//
// Formula choice (user-agreed 2026-07-19): box types that HAVE a sleeve
// component reuse their own formula (drawer_sliding: (W+H) × (L+H+L+H);
// matchbox_sliding: (W+H+W+H) × L); every other box type defaults to the
// matchbox wrap-around — the classic open-ended sleeve that slides over a box.
// (double_decker's own sleeve needs H1, so it also uses the default — flagged
// to the client.) Dimensions prefill from the box but are editable, so the
// caller passes explicit dims.

import type { Blank, BoxDimensions, BoxType } from "@/types";

/** The sleeve add-on's blank for a box of `dims`, per the box type's formula. */
export function sleeveBlank(boxType: BoxType, dims: BoxDimensions): Blank {
  const { length_in: L, width_in: W, height_in: H } = dims;

  if (boxType === "drawer_sliding") {
    return {
      component: "sleeve_addon",
      width_in: W + H,
      height_in: L + H + L + H,
      count_per_box: 1,
    };
  }

  // matchbox_sliding and the default for every other box type.
  return {
    component: "sleeve_addon",
    width_in: W + H + W + H,
    height_in: L,
    count_per_box: 1,
  };
}
