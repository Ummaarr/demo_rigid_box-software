// Reverse-board insert keyline (client 7-Jul: "an open keyline of the reverse
// board insert"). The insert uses the rigid-box tray formula with the INSERT
// height Hi: (Hi+L+Hi) × (Hi+W+Hi) — mirrors estimateReverseBoard in
// lib/engines/material.ts exactly, so the open blank drawn here matches the cost
// math. It's an insert, not a BoxType, so it isn't in the keylineComponents
// registry — it's rendered directly where the reverse-board UI/result lives.
import type { BoxDimensions } from "@/types";
import { KeylineDiagram, seg, type KeylinePanelData } from "./keyline-base";

export function reverseBoardPanels(
  dims: { length_in: number; width_in: number },
  insertHeight_in: number,
): KeylinePanelData[] {
  const { length_in: L, width_in: W } = dims;
  const Hi = insertHeight_in;
  return [
    {
      component: "Reverse board",
      x: [seg("Hi", Hi), seg("L", L), seg("Hi", Hi)],
      y: [seg("Hi", Hi), seg("W", W), seg("Hi", Hi)],
    },
  ];
}

export function ReverseBoardKeyline({
  dims,
  insertHeight_in,
}: {
  dims: BoxDimensions;
  insertHeight_in: number;
}) {
  return (
    <KeylineDiagram
      boxLabel="Reverse board insert"
      panels={reverseBoardPanels(dims, insertHeight_in)}
    />
  );
}
