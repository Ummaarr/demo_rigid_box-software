// Additional-charge helpers (round 3). Die/mould/block lines are stored as
// ChargeLine — either a legacy pre-multiplied number or {qty, rate} — and every
// reader (engine input builder, result panel, estimate detail, quote PDF) goes
// through these two functions so both shapes always price identically.

import type { ChargeLine } from "@/types";

/** Rupee total of a charge line (legacy number = already the total). */
export function chargeTotal(line: ChargeLine | undefined): number {
  if (line == null) return 0;
  if (typeof line === "number") return line;
  return line.qty * line.rate;
}

export interface ChargeDetail {
  label: string;
  /** Present only when the snapshot stored qty + rate (new shape). */
  qty?: number;
  rate?: number;
  amount: number;
}

/**
 * Display detail for one charge line, or null when absent/zero. Legacy totals
 * come back without qty/rate (rendered as a bare amount).
 */
export function chargeDetail(
  label: string,
  line: ChargeLine | undefined,
): ChargeDetail | null {
  const amount = chargeTotal(line);
  if (amount <= 0) return null;
  if (typeof line === "number" || line == null) return { label, amount };
  return { label, qty: line.qty, rate: line.rate, amount };
}
