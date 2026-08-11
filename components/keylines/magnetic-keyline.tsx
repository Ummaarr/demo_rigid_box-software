// Magnetic keyline — tray (H+L+H)×(H+W+H); case strip (height L) with 3/4/5
// panel variants. Regular = 4-panel (F+W+H+W); 3-panel (F+W+H); 5-panel adds
// the flap height (F+W+H+W+FH).
import type { BoxDimensions, BoxVariables } from "@/types";
import { KeylineDiagram, seg, type KeylinePanelData } from "./keyline-base";

export function magneticPanels(
  dims: BoxDimensions,
  vars: BoxVariables = {},
): KeylinePanelData[] {
  const { length_in: L, width_in: W, height_in: H } = dims;
  const F = vars.flapLength_in ?? 1.5;
  const panels = vars.panels ?? 4;
  const FH = vars.flapHeight_in ?? 1;

  const caseX =
    panels === 3
      ? [seg("F", F), seg("W", W), seg("H", H)]
      : panels === 5
        ? [seg("F", F), seg("W", W), seg("H", H), seg("W", W), seg("FH", FH)]
        : [seg("F", F), seg("W", W), seg("H", H), seg("W", W)];

  return [
    { component: "Tray", x: [seg("H", H), seg("L", L), seg("H", H)], y: [seg("H", H), seg("W", W), seg("H", H)] },
    { component: `Case (${panels}-panel)`, x: caseX, y: [seg("L", L)] },
  ];
}

export function MagneticKeyline({ dims, vars }: { dims: BoxDimensions; vars?: BoxVariables }) {
  return <KeylineDiagram boxLabel="Magnetic box" panels={magneticPanels(dims, vars)} />;
}
