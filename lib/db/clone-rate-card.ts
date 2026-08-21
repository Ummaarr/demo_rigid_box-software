import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CURRENCY_AGNOSTIC_TABLES } from "@/lib/db/card-scope";
import type { CurrencyCode } from "@/types";

// Clone the shared master rate card (every row with owner_id null) into a
// private per-user copy for a trial account, so a lead can plug in their own
// real material costs without touching — or seeing — anyone else's numbers.
// See supabase/migration-trial-role.sql for the owner_id column and the
// partial unique indexes that let master + per-owner rows coexist.
//
// The master card is itself split four ways by `currency`
// (supabase/migration-multi-currency.sql): a trial gets the template set for
// the market they picked at first login, so an American lead evaluates against
// real USD material costs rather than rupee figures under a dollar sign.
//
// app_config is deliberately NOT cloned: it's global formula configuration
// (folding allowance, wastage %), not a price, and stays admin-owned.

const CLONED_TABLES = [
  "board_rates",
  "paper_rates",
  "white_paper_rates",
  "art_card_rates",
  "special_paper_rates",
  "offset_printing_rates",
  "digital_printing_rates",
  "lamination_rates",
  "foiling_rates",
  "uv_coating_rates",
  "relief_rates",
  "magnet_rates",
  "washer_rates",
  "foam_rates",
  "reverse_board_rates",
  "consumable_rates",
  "labour_rates",
  "ribbon_tag_rates",
  "handle_rates",
  "lock_rates",
  "window_rates",
  "misc_rates",
  "margin_config",
] as const;

// margin_config holds a PERCENTAGE, not a price — 25% is 25% in every market —
// so it has no `currency` column and its single master row is cloned as-is for
// every trial regardless of the currency they picked. Filtering it by currency
// would match nothing and silently leave a trial with no margin row at all.
// The set is shared with the READ paths (lib/db/card-scope.ts) so the two can
// never disagree about which tables are market-independent.

/**
 * Copy the shared rate rows for `currency` into `ownerId`'s own private set.
 *
 * `id` is stripped so each copy gets a fresh key (bigint identity or uuid
 * default, depending on the table). `image_path` is deliberately KEPT: the
 * storage object is read-only here and both rows can point at the same file,
 * so a trial card shows the same reference photos without duplicating blobs.
 *
 * A missing table (a DB that hasn't run every migration) is skipped rather
 * than fatal — the same tolerance the rest of the rate layer has. Any other
 * failure throws, so the caller can roll the whole account creation back.
 */
export async function cloneRateCardForUser(
  admin: SupabaseClient,
  ownerId: string,
  currency: CurrencyCode,
): Promise<void> {
  // allSettled, NOT all: a rejection from Promise.all would let the caller's
  // rollback delete start while sibling INSERTs are still in flight, and those
  // late writes would land after the cleanup and leave exactly the half-built
  // card the rollback exists to prevent. Waiting for every table to settle
  // costs nothing (they run concurrently anyway) and keeps that guarantee.
  const results = await Promise.allSettled(
    CLONED_TABLES.map((table) => cloneOneTable(admin, ownerId, currency, table)),
  );

  const failures = results.flatMap((r) =>
    r.status === "rejected" ? [r.reason instanceof Error ? r.reason.message : String(r.reason)] : [],
  );
  if (failures.length > 0) throw new Error(failures.join("; "));
}

/**
 * One table's select-then-insert leg of the clone. Extracted so the tables can
 * run concurrently — they are independent of each other, and doing them in
 * sequence meant 46 serial network round trips on the single slowest thing a
 * trial lead ever waits for (their first-login country pick).
 */
async function cloneOneTable(
  admin: SupabaseClient,
  ownerId: string,
  currency: CurrencyCode,
  table: string,
): Promise<void> {
  let query = admin.from(table).select("*").is("owner_id", null);
  if (!CURRENCY_AGNOSTIC_TABLES.has(table)) {
    query = query.eq("currency", currency);
  }
  const { data, error } = await query;
  if (error) {
    // 42P01 = undefined table, 42703 = undefined column: pre-migration DB.
    if (error.code === "42P01" || error.code === "42703") return;
    throw new Error(`clone ${table} (read): ${error.message}`);
  }
  if (!data || data.length === 0) return;

  const copies = (data as Record<string, unknown>[]).map((row) => {
    const { id: _id, ...rest } = row;
    void _id;
    return { ...rest, owner_id: ownerId };
  });

  const { error: insErr } = await admin.from(table).insert(copies);
  if (insErr) throw new Error(`clone ${table} (write): ${insErr.message}`);
}

/**
 * Does this user already have a private rate card? Used to keep cloning
 * idempotent when an existing account is converted to the trial role — a
 * second clone would collide with their own partial unique indexes.
 */
export async function hasRateCardForUser(
  admin: SupabaseClient,
  ownerId: string,
): Promise<boolean> {
  // Concurrent for the same reason as the clone: this runs on the critical
  // path of the country pick, and 23 serial probes are 23 serial round trips
  // to answer a single yes/no.
  const hits = await Promise.all(
    CLONED_TABLES.map(async (table) => {
      const { data, error } = await admin
        .from(table)
        .select("owner_id")
        .eq("owner_id", ownerId)
        .limit(1);
      if (error) return false; // pre-migration table: nothing to find here.
      return Boolean(data && data.length > 0);
    }),
  );
  return hits.some(Boolean);
}

/**
 * Remove a trial user's private rate rows. The owner_id FK is `on delete
 * cascade`, so deleting the auth user already does this — but two paths need
 * it explicitly: account creation failing PART WAY through cloning (that
 * half-built card has no auth user to cascade from yet), and converting a
 * trial account back to staff/admin (the auth user stays, its private card
 * should not).
 */
export async function deleteRateCardForUser(
  admin: SupabaseClient,
  ownerId: string,
): Promise<void> {
  // allSettled so every delete is finished before this resolves — callers
  // treat a returned promise as "the card is gone", and a still-pending delete
  // would break that. Best-effort per table: this runs on an error path
  // already, so a missing table or a second failure must not mask the
  // original problem.
  await Promise.allSettled(
    CLONED_TABLES.map(async (table) => {
      const { error } = await admin.from(table).delete().eq("owner_id", ownerId);
      if (error && error.code !== "42P01" && error.code !== "42703") {
        console.error(`rollback: failed clearing ${table} for ${ownerId}:`, error.message);
      }
    }),
  );
}
