// Shoulder keyline — tray (BH+L+BH)×(BH+W+BH), neck (NH+L+NH)×(NH+W+NH),
// lid (D+L+D)×(D+W+D).
import type { BoxDimensions, BoxVariables } from "@/types";
import { KeylineDiagram, seg, type KeylinePanelData } from "./keyline-base";

export function shoulderPanels(
  dims: BoxDimensions,
  vars: BoxVariables = {},
): KeylinePanelData[] {
  const { length_in: L, width_in: W } = dims;
  const BH = vars.bottomHeight_in ?? 3;
  const NH = vars.neckHeight_in ?? 1.5;
  const D = vars.lidDepth_in ?? 1.5;
  // Fit allowance: the lid AND tray L/W grow (client item 4B) so the drawn
  // panels match the engine blanks (creasesForBlank pairs them by size).
  const f = vars.fitAllowance_in ?? 0;
  return [
    { component: "Tray", x: [seg("BH", BH), seg("L", L + f), seg("BH", BH)], y: [seg("BH", BH), seg("W", W + f), seg("BH", BH)] },
    { component: "Neck", x: [seg("NH", NH), seg("L", L), seg("NH", NH)], y: [seg("NH", NH), seg("W", W), seg("NH", NH)] },
    { component: "Lid", x: [seg("D", D), seg("L", L + f), seg("D", D)], y: [seg("D", D), seg("W", W + f), seg("D", D)] },
  ];
}

export function ShoulderKeyline({ dims, vars }: { dims: BoxDimensions; vars?: BoxVariables }) {
  return <KeylineDiagram boxLabel="Shoulder box" panels={shoulderPanels(dims, vars)} />;
}
