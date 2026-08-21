// Per-market currency dressing for trial accounts, sitting alongside the
// global BRAND dressing in lib/brand.ts rather than replacing it.
//
// BRAND describes the DEPLOYMENT's own currency display (today: the cosmetic
// dollar skin over rupee figures — see the comment in lib/brand.ts). That is
// what admin and staff keep seeing, unchanged. This module describes the four
// markets a TRIAL lead can pick from, whose rate cards hold genuinely
// different numbers (see supabase/migration-multi-currency.sql), not the same
// numbers relabelled.
//
// No divisor here on purpose: BRAND.currencyDivisor exists to scale one set of
// rupee figures into another glyph. These four cards are separately priced, so
// there is nothing to scale — the numbers are already in their own currency.
//
// PURE — no server-only, no React, mirroring lib/brand.ts and lib/currency.ts
// so client components, server PDF builders and offline scripts can all import it.

import type { CurrencyCode } from "@/types";

export interface CurrencyMeta {
  code: CurrencyCode;
  /** Prefix for on-screen amounts (formatMoney). */
  symbol: string;
  /** Digit grouping / decimal convention. */
  locale: string;
  /**
   * Prefix for PDF amounts. Kept separate from `symbol` for the same reason
   * BRAND has both: the built-in Helvetica the PDF renderer uses has no rupee
   * glyph, so INR prints as "Rs." there while the browser shows "₹".
   */
  pdfPrefix: string;
  /** Country shown on the picker. */
  country: string;
  flag: string;
}

export const CURRENCY_META: Record<CurrencyCode, CurrencyMeta> = {
  INR: { code: "INR", symbol: "₹", locale: "en-IN", pdfPrefix: "Rs. ", country: "India", flag: "🇮🇳" },
  USD: { code: "USD", symbol: "$", locale: "en-US", pdfPrefix: "$", country: "United States", flag: "🇺🇸" },
  GBP: { code: "GBP", symbol: "£", locale: "en-GB", pdfPrefix: "£", country: "United Kingdom", flag: "🇬🇧" },
  AED: { code: "AED", symbol: "AED ", locale: "en-AE", pdfPrefix: "AED ", country: "United Arab Emirates", flag: "🇦🇪" },
};

/** Picker order — India first, then the three export markets. */
export const CURRENCY_CODES: CurrencyCode[] = ["INR", "USD", "GBP", "AED"];

/**
 * The market the DEPLOYMENT itself trades in.
 *
 * The shared master card is four template sets, one per currency, so that a
 * trial can be cloned into any market (see supabase/seed-currency-templates.sql).
 * Only ONE of them is the deployment's own card — the rows admin and staff
 * price against, and the rows BRAND re-skins as dollars. Every read of the
 * shared card must therefore be narrowed to this currency; without it a lookup
 * that "must return one" matches four (see lib/db/card-scope.ts).
 */
export const DEPLOYMENT_CURRENCY: CurrencyCode = "INR";

export function isCurrencyCode(v: unknown): v is CurrencyCode {
  return typeof v === "string" && v in CURRENCY_META;
}

/**
 * The money dressing to render a given session's amounts in.
 *
 * Returns undefined for admin/staff (and for a trial who somehow has no
 * currency yet), which every consumer treats as "use the global BRAND
 * dressing" — so their display path stays byte-identical to before
 * multi-currency existed.
 */
export function currencyMetaFor(
  session: { role: string | null; trialCurrency: CurrencyCode | null },
): CurrencyMeta | undefined {
  if (session.role !== "trial" || !session.trialCurrency) return undefined;
  return CURRENCY_META[session.trialCurrency];
}

/**
 * Which market a session prices in, as a plain code.
 *
 * Admin/staff resolve to "INR" — the deployment's own card really is the INR
 * master (BRAND merely re-skins it), so tax and formatting rules can branch on
 * this without special-casing role.
 */
export function currencyCodeFor(
  session: { role: string | null; trialCurrency: CurrencyCode | null },
): CurrencyCode {
  return currencyMetaFor(session)?.code ?? DEPLOYMENT_CURRENCY;
}
