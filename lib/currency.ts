// Single source of currency display, mirroring lib/brand.ts: every place that
// used to write its own `"₹" + n.toLocaleString("en-IN", ...)` now calls
// formatMoney(). The demo build's BRAND swaps the symbol and locale (dollar
// display, cosmetic only — see lib/brand.ts) so every consumer picks it up
// with no per-file change.
//
// PURE — no server-only, no React. Client components, server PDF builders and
// the estimate/cost-view module all import it.

import { BRAND } from "@/lib/brand";

/**
 * Per-market override for a TRIAL account (lib/currency-meta.ts). Omitted for
 * admin/staff, who keep the deployment-wide BRAND dressing — so every existing
 * call site that passes nothing behaves exactly as it did before
 * multi-currency existed.
 *
 * There is deliberately no divisor: BRAND's exists to re-skin one set of rupee
 * figures, whereas a trial's card is separately priced in its own currency and
 * must never be scaled.
 */
export interface MoneyFormat {
  symbol: string;
  locale: string;
}

export function formatMoney(n: number, decimals = 2, fmt?: MoneyFormat): string {
  if (fmt) {
    return (
      fmt.symbol +
      n.toLocaleString(fmt.locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    );
  }
  return (
    BRAND.currencySymbol +
    (n / BRAND.currencyDivisor).toLocaleString(BRAND.currencyLocale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}
