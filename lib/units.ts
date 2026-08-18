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

/** A unit string from the DB, defaulted. Anything unrecognised reads as inches. */
export function asUnit(v: unknown): Unit {
  return v === "cm" || v === "mm" ? v : "in";
}

/**
 * One dimension, converted for DISPLAY and trimmed of trailing zeros.
 *
 * Distinct from toDim(), which rounds for a number INPUT and whose result is
 * meant to be edited and converted straight back. This one is terminal — never
 * feed its output to fromDim(), or the display rounding becomes a stored value.
 */
export function formatDim(val_in: number, unit: Unit): string {
  const v = toDim(val_in, unit);
  return String(Math.round(v * 100) / 100);
}

/**
 * A stock sheet in the unit it was entered in: "70 × 100 cm", "23 × 36 in".
 *
 * Storage stays inches everywhere (see the note at the top of this file); the
 * unit is remembered per rate row purely so a metric buyer reads back the
 * numbers they actually typed instead of 27.56 × 39.37.
 */
export function formatSheet(width_in: number, height_in: number, unit: Unit): string {
  return `${formatDim(width_in, unit)} × ${formatDim(height_in, unit)} ${UNIT_LABELS[unit]}`;
}

/** A bare "WxH" / "W×H" size label -> its two numbers, in the row's own unit. */
export function parseSizeLabel(label: string): { a: number; b: number } | null {
  const m = label.match(/^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*$/i);
  return m ? { a: Number(m[1]), b: Number(m[2]) } : null;
}

/**
 * Does a "WxH" label agree with the sheet dimensions stored on its rate row?
 *
 * The label is written in the row's OWN unit, while the sheet is always stored
 * in inches — so a 70×100 cm row reads "70x100" against 27.559×39.370 in. Both
 * sides are therefore compared in the row's unit, not raw.
 *
 * Labels that are not a plain WxH pair ("A4", "Custom") are treated as
 * agreeing: plenty of legitimate names never parse. Note this fails OPEN, so a
 * caller must not rely on it to prove a row is well-formed.
 *
 * The tolerance exists because the conversion is lossy in both directions —
 * 70 cm stores as 27.5590551... in and comes back as 69.99999... cm.
 */
export function labelAgreesWithSheet(
  label: string,
  sheet: { width_in: number; height_in: number },
  unit: Unit = "in",
  tol = 0.05,
): boolean {
  const parsed = parseSizeLabel(label);
  if (!parsed) return true;
  const w = toDim(sheet.width_in, unit);
  const h = toDim(sheet.height_in, unit);
  const near = (x: number, y: number) => Math.abs(x - y) <= tol;
  return (
    (near(parsed.a, w) && near(parsed.b, h)) || (near(parsed.a, h) && near(parsed.b, w))
  );
}
