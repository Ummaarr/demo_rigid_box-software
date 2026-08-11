// Only-tray keyline — a single tray (H+L+H)×(H+W+H), no lid.
import type { BoxDimensions, BoxVariables } from "@/types";
import { KeylineDiagram, seg, type KeylinePanelData } from "./keyline-base";

export function trayOnlyPanels(
  dims: BoxDimensions,
  _vars: BoxVariables = {},
): KeylinePanelData[] {
  const { length_in: L, width_in: W, height_in: H } = dims;
  return [
    { component: "Tray", x: [seg("H", H), seg("L", L), seg("H", H)], y: [seg("H", H), seg("W", W), seg("H", H)] },
  ];
}

export function TrayOnlyKeyline({ dims, vars }: { dims: BoxDimensions; vars?: BoxVariables }) {
  return <KeylineDiagram boxLabel="Only tray" panels={trayOnlyPanels(dims, vars)} />;
}
