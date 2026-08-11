// Single source of currency display, mirroring lib/brand.ts: every place that
// used to write its own `"₹" + n.toLocaleString("en-IN", ...)` now calls
// formatMoney(). The demo build's BRAND swaps the symbol and locale (dollar
// display, cosmetic only — see lib/brand.ts) so every consumer picks it up
// with no per-file change.
//
// PURE — no server-only, no React. Client components, server PDF builders and
// the estimate/cost-view module all import it.

import { BRAND } from "@/lib/brand";

export function formatMoney(n: number, decimals = 2): string {
  return (
    BRAND.currencySymbol +
    (n / BRAND.currencyDivisor).toLocaleString(BRAND.currencyLocale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}
