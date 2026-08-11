// Display-unit conversion for dimension inputs (client 2026-07: the mm/cm/in
// selector must apply EVERYWHERE a dimension is entered, not only the main
// L×W×H). Internal state and every API payload stay in INCHES — these helpers
// convert at the input boundary only.

export type Unit = "in" | "cm" | "mm";

export const UNIT_LABELS: Record<Unit, string> = { in: "in", cm: "cm", mm: "mm" };

/** Inches (internal) -> display value in the chosen unit, rounded for the input. */
export function toDim(val_in: number, unit: Unit): number {
  if (unit === "cm") return Math.round(val_in * 2.54 * 100) / 100;
  if (unit === "mm") return Math.round(val_in * 25.4 * 10) / 10;
  return val_in;
}

/** Display value in the chosen unit -> inches (internal). */
export function fromDim(val: number, unit: Unit): number {
  if (unit === "cm") return val / 2.54;
  if (unit === "mm") return val / 25.4;
  return val;
}

/** Sensible input step per unit. */
export function dimStep(unit: Unit): string {
  return unit === "mm" ? "1" : "0.1";
}
