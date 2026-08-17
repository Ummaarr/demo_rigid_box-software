# Blank dimension formulas

Moved out of the repo-root `CLAUDE.md` so it loads only when working under `lib/formulas/`.
The cross-cutting "Registering a NEW box type" checklist stays in the root file.

## Blank Dimension Formulas
All dimensions in inches. L = length, W = width, H = height (internal dims).
Each box type lists its own variables (the inputs its formula needs).

- **Telescopic**: tray (H+L+H) x (H+W+H); lid (Depth+L+Depth) x (Depth+W+Depth)
    Variables: Lid depth (default 1.5 in)
- **Magnetic**: tray (H+L+H) x (H+W+H);
    Regular (4-panel) case (Flap+W+H+W) x L; 3-panel case (Flap+W+H) x L;
    5-panel case (Flap+W+H+W+FlapHeight) x L
    Variables: Flap length, number of panels (3/4/5), Flap height (5-panel only),
    closure (magnet/ribbon)
- **Shoulder**: tray (BH+L+BH) x (BH+W+BH); neck (NH+L+NH) x (NH+W+NH);
    lid (Depth+L+Depth) x (Depth+W+Depth)
    Variables: Lid depth, Neck height (NH), Bottom height (BH)
- **Drawer sliding**: tray (H+L+H) x (H+W+H); sleeve (W+H) x (L+H+L+H)
    Variables: Sleeve material (kappa board / duplex board / CyberXL / custom)
- **Match-box sliding**: tray (H+L+H) x (H+W+H); sleeve (W+H+W+H) x L
    Variables: Sleeve material
- **Hinge lid**: tray (BH+L+BH) x (BH+W+BH); neck (NH+L+NH) x (NH+W+NH);
    lid (Depth+L+Depth) x (Depth+W+Depth)
    ("base" = "tray", used interchangeably, so the tray component auto-includes
    tape. "inner box" = the neck formula.)
    Variables: Bottom height, Neck height, Lid depth, ribbon support
- **Collapsible rigid**: case (Flap+W+H+W+H) x L;
    2 tray pieces, each (H+W+H) x (H+H)
    Variables: adhesive tape (with/without), closure (magnet/ribbon)
- **Double decker**: case (Flap+W+[H1+H2]+W) x L;
    tray 1 (H1+L+H1) x (H1+W+H1); tray 2 (H2+L+H2) x (H2+W+H2);
    drawer sleeve (W+H1) x (L+H+L+H1)
    Variables: Flap length, number of panels, H1 (tray 1 height), H2 (tray 2)

### Lid / sleeve fit allowance
A lid's inner dimension must clear the base's outer dimension. `vars.fitAllowance_in`
is derived by `lib/formulas/fit.ts`: **2t + 1mm as the TOTAL added to EACH of L
and W** (note the units contract — formulas read `L + f`, never `L + 2*f`).

`FIT_ALLOWANCE_TYPES` covers telescopic, shoulder, drawer_sliding and
matchbox_sliding. Substitutions: telescopic + shoulder lid `(D+(L+f)+D) x
(D+(W+f)+D)`; shoulder tray likewise; drawer sleeve `((W+f)+H) x ((L+f)+H+(L+f)+H)`.
The neck is untouched.

INJECTION: `buildEstimate` rebuilds the request (validate → inject → applySections
→ snapshot) so `specs_snapshot` CARRIES the var. `recomputeMaterials` /
`buildMaterialInput` NEVER derive it, so old snapshots without the var compute
byte-identically. The four keyline components apply the same substitutions —
`creasesForBlank` matches panels to blanks by dimension, so skipping one silently
drops its fold lines. Wrap paper grows automatically since it derives from board
blanks. The sleeve INSERT gets no allowance (free dims).
