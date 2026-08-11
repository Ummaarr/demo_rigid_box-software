// Hinge lid keyline — tray (BH+L+BH)×(BH+W+BH), inner box / neck
// (NH+L+NH)×(NH+W+NH), lid (D+L+D)×(D+W+D).
import type { BoxDimensions, BoxVariables } from "@/types";
import { KeylineDiagram, seg, type KeylinePanelData } from "./keyline-base";

export function hingeLidPanels(
  dims: BoxDimensions,
  vars: BoxVariables = {},
): KeylinePanelData[] {
  const { length_in: L, width_in: W } = dims;
  const BH = vars.bottomHeight_in ?? 3;
  const NH = vars.neckHeight_in ?? 1.5;
  const D = vars.lidDepth_in ?? 1.5;
  return [
    { component: "Tray", x: [seg("BH", BH), seg("L", L), seg("BH", BH)], y: [seg("BH", BH), seg("W", W), seg("BH", BH)] },
    { component: "Inner box", x: [seg("NH", NH), seg("L", L), seg("NH", NH)], y: [seg("NH", NH), seg("W", W), seg("NH", NH)] },
    { component: "Lid", x: [seg("D", D), seg("L", L), seg("D", D)], y: [seg("D", D), seg("W", W), seg("D", D)] },
  ];
}

export function HingeLidKeyline({ dims, vars }: { dims: BoxDimensions; vars?: BoxVariables }) {
  return <KeylineDiagram boxLabel="Hinge lid box" panels={hingeLidPanels(dims, vars)} />;
}
