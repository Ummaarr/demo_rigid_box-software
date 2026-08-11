// Match-box sliding keyline — tray (H+L+H)×(H+W+H), sleeve (W+H+W+H)×L.
import type { BoxDimensions, BoxVariables } from "@/types";
import { KeylineDiagram, seg, type KeylinePanelData } from "./keyline-base";

export function matchboxSlidingPanels(
  dims: BoxDimensions,
  vars: BoxVariables = {},
): KeylinePanelData[] {
  const { length_in: L, width_in: W, height_in: H } = dims;
  // Fit allowance (client item 4A): the sleeve's L/W grow so the drawn panel
  // matches the engine blank (creasesForBlank pairs them by size).
  const f = vars.fitAllowance_in ?? 0;
  return [
    { component: "Tray", x: [seg("H", H), seg("L", L), seg("H", H)], y: [seg("H", H), seg("W", W), seg("H", H)] },
    { component: "Sleeve", x: [seg("W", W + f), seg("H", H), seg("W", W + f), seg("H", H)], y: [seg("L", L + f)] },
  ];
}

export function MatchboxSlidingKeyline({ dims, vars }: { dims: BoxDimensions; vars?: BoxVariables }) {
  return <KeylineDiagram boxLabel="Match-box sliding box" panels={matchboxSlidingPanels(dims, vars)} />;
}
