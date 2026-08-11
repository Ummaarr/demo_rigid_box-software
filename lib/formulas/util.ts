// Shared guards for box-type formulas. Not formula logic — just input
// validation so a missing/invalid variable fails loudly with a clear message
// instead of silently producing a wrong blank (e.g. NaN or a negative size).

/**
 * Assert a required formula variable is present and positive. Returns the value
 * so it can be used inline: `const bh = requireVar(vars.bottomHeight_in, ...)`.
 */
export function requireVar(
  value: number | undefined,
  name: string,
  boxType: string,
): number {
  if (value === undefined || value === null) {
    throw new Error(`${boxType}: missing required variable "${name}".`);
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `${boxType}: variable "${name}" must be a positive number (got ${value}).`,
    );
  }
  return value;
}
