// Drawer sliding keyline — tray (H+L+H)×(H+W+H), sleeve (W+H)×(L+H+L+H).
import type { BoxDimensions, BoxVariables } from "@/types";
import { KeylineDiagram, seg, type KeylinePanelData } from "./keyline-base";

export function drawerSlidingPanels(
  dims: BoxDimensions,
  vars: BoxVariables = {},
): KeylinePanelData[] {
  const { length_in: L, width_in: W, height_in: H } = dims;
  // Round-6 fit allowance: the sleeve's L/W grow so the drawn panel matches
  // the engine blank (creasesForBlank pairs them by size).
  const f = vars.fitAllowance_in ?? 0;
  return [
    { component: "Tray", x: [seg("H", H), seg("L", L), seg("H", H)], y: [seg("H", H), seg("W", W), seg("H", H)] },
    { component: "Sleeve", x: [seg("W", W + f), seg("H", H)], y: [seg("L", L + f), seg("H", H), seg("L", L + f), seg("H", H)] },
  ];
}

export function DrawerSlidingKeyline({ dims, vars }: { dims: BoxDimensions; vars?: BoxVariables }) {
  return <KeylineDiagram boxLabel="Drawer sliding box" panels={drawerSlidingPanels(dims, vars)} />;
}
