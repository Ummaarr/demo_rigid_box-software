// Double decker keyline — case strip (F+W+[H1+H2]+W)×L, tray 1
// (H1+L+H1)×(H1+W+H1), tray 2 (H2+L+H2)×(H2+W+H2),
// drawer sleeve (W+H1)×(L+H+L+H1).
import type { BoxDimensions, BoxVariables } from "@/types";
import { KeylineDiagram, seg, type KeylinePanelData } from "./keyline-base";

export function doubleDeckerPanels(
  dims: BoxDimensions,
  vars: BoxVariables = {},
): KeylinePanelData[] {
  const { length_in: L, width_in: W, height_in: H } = dims;
  const F = vars.flapLength_in ?? 1.5;
  const H1 = vars.trayHeight1_in ?? 2;
  const H2 = vars.trayHeight2_in ?? 2;
  return [
    { component: "Case", x: [seg("F", F), seg("W", W), seg("H1+H2", H1 + H2), seg("W", W)], y: [seg("L", L)] },
    { component: "Tray 1", x: [seg("H1", H1), seg("L", L), seg("H1", H1)], y: [seg("H1", H1), seg("W", W), seg("H1", H1)] },
    { component: "Tray 2", x: [seg("H2", H2), seg("L", L), seg("H2", H2)], y: [seg("H2", H2), seg("W", W), seg("H2", H2)] },
    { component: "Drawer sleeve", x: [seg("W", W), seg("H1", H1)], y: [seg("L", L), seg("H", H), seg("L", L), seg("H1", H1)] },
  ];
}

export function DoubleDeckerKeyline({ dims, vars }: { dims: BoxDimensions; vars?: BoxVariables }) {
  return <KeylineDiagram boxLabel="Double decker box" panels={doubleDeckerPanels(dims, vars)} />;
}
