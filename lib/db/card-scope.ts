import "server-only";

/**
 * Which rate card a read is against — the one place both halves of that
 * question are answered.
 *
 * A rate row is identified by TWO scoping columns, not one:
 *
 *   owner_id  NULL = the shared master card, a user id = that trial's clone
 *             (supabase/migration-trial-role.sql)
 *   currency  which market's template set the row belongs to
 *             (supabase/migration-multi-currency.sql)
 *
 * Owner alone is enough for a TRIAL: their clone holds one market's rows and
 * nobody else's. It is NOT enough for the shared card. Once
 * seed-currency-templates.sql has been run, the master card holds four
 * template sets — INR, USD, GBP and AED rows all with `owner_id is null` — so
 * an owner-only read of it returns four rows per natural key. That surfaced as
 * a 500 on every admin/staff estimate ("4 rows matched a lookup that must
 * return one" out of lib/db/rates.ts row()), and, worse, silently in
 * auto-printing, which compares candidates by price and would happily pick a
 * GBP plate rate as the cheapest.
 *
 * The narrowing lives here rather than at the ~50 individual lookups because
 * it never varies by call site: it is a property of WHICH CARD is being read,
 * exactly like owner_id.
 */

import { DEPLOYMENT_CURRENCY } from "@/lib/currency-meta";

export { DEPLOYMENT_CURRENCY };

/**
 * Rate tables with no `currency` column, which must NOT be narrowed by one.
 *
 * margin_config holds a PERCENTAGE, not a price — 25% is 25% in every market —
 * so it is deliberately market-independent. Filtering it by currency would
 * error (PostgREST 42703) or, in the in-memory path, match nothing and leave
 * an estimate with no margin at all. app_config is the same kind of thing
 * (global formula constants) and additionally has no owner_id, so it bypasses
 * this scoping entirely.
 */
export const CURRENCY_AGNOSTIC_TABLES: ReadonlySet<string> = new Set([
  "margin_config",
  "app_config",
]);

/**
 * Apply both scoping filters to a PostgREST query — the builder-side twin of
 * the in-memory narrowing matchRows() does (lib/db/rate-cache.ts).
 *
 * Generic in the builder type so each query keeps its own row typing; the
 * internal casts are only needed because .is/.eq aren't expressible on a bare
 * type parameter.
 *
 * `currencyAgnostic` opts a query out of the currency filter, for the tables in
 * CURRENCY_AGNOSTIC_TABLES. Forgetting it is not a pricing bug: the query fails
 * loudly with PostgREST 42703 (no such column) rather than quietly returning
 * the wrong market's rows.
 */
export function scopeToCard<T>(
  q: T,
  ownerId: string | null,
  opts?: { currencyAgnostic?: boolean },
): T {
  const owned =
    ownerId == null
      ? (q as unknown as { is: (c: string, v: null) => T }).is("owner_id", null)
      : (q as unknown as { eq: (c: string, v: string) => T }).eq("owner_id", ownerId);

  // A trial's clone is already one market's rows; only the shared card needs
  // narrowing, and only where the column exists.
  if (ownerId != null || opts?.currencyAgnostic) return owned;
  return (owned as unknown as { eq: (c: string, v: string) => T }).eq(
    "currency",
    DEPLOYMENT_CURRENCY,
  );
}
