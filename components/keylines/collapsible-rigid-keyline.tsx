// Collapsible rigid keyline — case strip (F+W+H+W+H)×L, plus 2 identical tray
// pieces (H+W+H)×(H+H).
import type { BoxDimensions, BoxVariables } from "@/types";
import { KeylineDiagram, seg, type KeylinePanelData } from "./keyline-base";

export function collapsibleRigidPanels(
  dims: BoxDimensions,
  vars: BoxVariables = {},
): KeylinePanelData[] {
  const { length_in: L, width_in: W, height_in: H } = dims;
  const F = vars.flapLength_in ?? 1.5;
  return [
    { component: "Case", x: [seg("F", F), seg("W", W), seg("H", H), seg("W", W), seg("H", H)], y: [seg("L", L)] },
    { component: "Tray piece (×2)", x: [seg("H", H), seg("W", W), seg("H", H)], y: [seg("H", H), seg("H", H)] },
  ];
}

export function CollapsibleRigidKeyline({ dims, vars }: { dims: BoxDimensions; vars?: BoxVariables }) {
  return <KeylineDiagram boxLabel="Collapsible rigid box" panels={collapsibleRigidPanels(dims, vars)} />;
}
