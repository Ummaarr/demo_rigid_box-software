// Telescopic keyline — tray (H+L+H)×(H+W+H), lid (D+L+D)×(D+W+D).
// The lid's L/W carry the round-6 fit allowance (2 × board thickness) so the
// drawn panel matches the engine blank — creasesForBlank pairs them by size.
import type { BoxDimensions, BoxVariables } from "@/types";
import { KeylineDiagram, seg, type KeylinePanelData } from "./keyline-base";

export function telescopicPanels(
  dims: BoxDimensions,
  vars: BoxVariables = {},
): KeylinePanelData[] {
  const { length_in: L, width_in: W, height_in: H } = dims;
  const D = vars.lidDepth_in ?? 1.5;
  const f = vars.fitAllowance_in ?? 0;
  return [
    { component: "Tray", x: [seg("H", H), seg("L", L), seg("H", H)], y: [seg("H", H), seg("W", W), seg("H", H)] },
    { component: "Lid", x: [seg("D", D), seg("L", L + f), seg("D", D)], y: [seg("D", D), seg("W", W + f), seg("D", D)] },
  ];
}

export function TelescopicKeyline({ dims, vars }: { dims: BoxDimensions; vars?: BoxVariables }) {
  return <KeylineDiagram boxLabel="Telescopic box" panels={telescopicPanels(dims, vars)} />;
}
