import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

/**
 * In-process cache for the rate card.
 *
 * WHY: resolving one estimate (lib/db/rates.ts loadEstimateRates) issues 15-40
 * SEQUENTIAL single-row lookups — board, then folding allowance, then the outer
 * paper, then its printing row, then one query per finishing item, per foam
 * insert, per labour line... Each is its own HTTPS round trip. Measured against
 * the live project that is ~70 ms each, so a normal estimate spent 1.5-3 s doing
 * nothing but waiting, and "Calculate"/"Save estimate" took 4-5 s.
 *
 * The whole rate card is 118 rows across 24 tables — a few KB. So instead of
 * asking the database for one row at a time we pull each table ONCE, keep it in
 * memory, and do the filtering here. A warm estimate now makes zero rate round
 * trips.
 *
 * CORRECTNESS: this must never change a single price. The filtering below
 * emulates the PostgREST calls it replaces exactly — including the errors:
 * a filter on a column the table does not have still throws, because callers
 * (boardRow, the foiling resolver) catch that to detect a DB that has not run a
 * migration yet. See lib/db/rates.ts `row` / `printRow`.
 *
 * FRESHNESS: any rate mutation calls invalidateRateCache() (all three writers
 * live in app/api/rates/route.ts and lib/db/rate-whitelist.ts), so an edit is
 * visible to the next estimate immediately. The TTL is the backstop for the
 * case the invalidation cannot reach: on a multi-instance deploy each server
 * process has its own memory, so an edit made on instance A is invisible to
 * instance B until B's copy expires. Saved estimates are unaffected either way
 * — they carry their own rates_snapshot and are never recomputed from live
 * rates.
 */

const TTL_MS = 60_000;

export type RateRow = Record<string, unknown>;

export interface TableSnapshot {
  rows: RateRow[];
  /** The table/view does not exist (pre-migration DB). Callers still throw. */
  error: PostgrestError | null;
}

/**
 * Tables pulled together on the first miss. Purely a performance hint: a table
 * missing from this list still resolves, it just costs its own round trip. The
 * list is kept here rather than derived from rate-whitelist's ALLOWED to avoid
 * an import cycle (that module calls invalidateRateCache).
 */
const PREFETCH_TABLES = [
  "board_rates", "paper_rates", "white_paper_rates", "art_card_rates",
  "special_paper_rates", "offset_printing_rates", "digital_printing_rates",
  "lamination_rates", "foiling_rates", "uv_coating_rates", "relief_rates",
  "foam_rates", "reverse_board_rates", "magnet_rates", "washer_rates",
  "ribbon_tag_rates", "handle_rates", "lock_rates", "window_rates",
  "labour_rates", "misc_rates", "consumable_rates", "app_config",
  "margin_config",
];

/** Bumped on every mutation; entries written by an older generation are dropped. */
let generation = 0;

const tables = new Map<string, { at: number; value: TableSnapshot }>();
const derived = new Map<string, { at: number; value: unknown }>();
/** De-dupes concurrent misses so N parallel callers share one fetch. */
const inFlight = new Map<string, Promise<unknown>>();
/** When the last whole-card prefetch started; re-arms on TTL and on invalidate. */
let lastPrefetch = 0;

/** Drop everything. Called after any rate insert / update / delete. */
export function invalidateRateCache(): void {
  generation++;
  tables.clear();
  derived.clear();
  inFlight.clear();
  lastPrefetch = 0;
}

const fresh = (at: number) => Date.now() - at < TTL_MS;

/** One `select *`, stored under the generation that requested it. */
async function fetchTable(
  supabase: SupabaseClient,
  table: string,
): Promise<TableSnapshot> {
  const gen = generation;
  const { data, error } = await supabase.from(table).select("*");
  const snapshot: TableSnapshot = { rows: (data ?? []) as RateRow[], error };
  // A mutation landed while we were fetching -> this data may already be stale,
  // so serve it to the current caller but do not cache it.
  if (gen === generation) tables.set(table, { at: Date.now(), value: snapshot });
  return snapshot;
}

/** Start (but do not await) a fetch, sharing it with any concurrent caller. */
function begin(supabase: SupabaseClient, table: string): Promise<TableSnapshot> {
  const key = `table:${table}`;
  const running = inFlight.get(key) as Promise<TableSnapshot> | undefined;
  if (running) return running;
  const task = fetchTable(supabase, table).finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  // A prefetch nobody awaits must not surface as an unhandled rejection.
  task.catch(() => {});
  return task;
}

/**
 * All rows of a rate table, cached. Errors are returned rather than thrown so
 * each caller can reproduce the exact message its own lookup used to produce.
 */
export async function rateTable(
  supabase: SupabaseClient,
  table: string,
): Promise<TableSnapshot> {
  const hit = tables.get(table);
  if (hit && fresh(hit.at)) return hit.value;

  // Cold (server start, or just after a rate edit): pull the WHOLE rate card in
  // one parallel batch. Otherwise the resolver discovers tables one at a time as
  // its control flow reaches them, serialising ~10 round trips — measured at
  // 715 ms versus ~120 ms for all 24 tables at once.
  if (!fresh(lastPrefetch)) {
    lastPrefetch = Date.now();
    for (const t of PREFETCH_TABLES) {
      if (t !== table && !tables.has(t)) begin(supabase, t);
    }
  }

  return begin(supabase, table);
}

/** Memoise a computed value (loadRateOptions) on the same generation + TTL. */
export async function cachedDerived<T>(
  key: string,
  compute: () => Promise<T>,
): Promise<T> {
  const hit = derived.get(key);
  if (hit && fresh(hit.at)) return hit.value as T;

  const flightKey = `derived:${key}`;
  const running = inFlight.get(flightKey) as Promise<T> | undefined;
  if (running) return running;

  const gen = generation;
  const task = (async (): Promise<T> => {
    const value = await compute();
    if (gen === generation) derived.set(key, { at: Date.now(), value });
    return value;
  })();

  inFlight.set(flightKey, task);
  try {
    return await task;
  } finally {
    inFlight.delete(flightKey);
  }
}

/**
 * Does the table carry this column? An EMPTY table cannot tell us, and answering
 * "yes" is the safe choice: the filter then simply matches nothing, which is
 * what the real query would have returned anyway.
 */
export function hasColumn(rows: RateRow[], col: string): boolean {
  return rows.length === 0 || col in rows[0];
}

/**
 * SQL `=` semantics, not JavaScript's. PostgREST compares in the database, where
 * a numeric column matches the number regardless of whether the driver handed
 * it back as 1.5 or "1.5"; text stays case-sensitive and exact.
 */
function valueEquals(rowValue: unknown, filterValue: string | number): boolean {
  if (rowValue === filterValue) return true;
  if (rowValue == null) return false;
  if (typeof filterValue === "number") {
    const n = typeof rowValue === "number" ? rowValue : Number(rowValue);
    return Number.isFinite(n) && n === filterValue;
  }
  return String(rowValue) === filterValue;
}

/**
 * The in-memory equivalent of `.select(...).match(filters)`.
 *
 * Throws on a filter naming a column the table does not have, because that is
 * what PostgREST does (42703) and two callers depend on it: boardRow retries
 * without `type` on a DB predating migration-board-type.sql, and the foiling
 * resolver falls back to the pre-round-3 shape when there is no `finish`.
 */
export function matchRows(
  rows: RateRow[],
  table: string,
  filters: Record<string, string | number>,
): RateRow[] {
  for (const col of Object.keys(filters)) {
    if (!hasColumn(rows, col)) {
      throw new Error(
        `rate lookup failed for ${table}: column ${table}.${col} does not exist`,
      );
    }
  }
  return rows.filter((r) =>
    Object.entries(filters).every(([col, want]) => valueEquals(r[col], want)),
  );
}

/** `.order("vendor", { ascending: true, nullsFirst: true })`. */
export function byVendorNullsFirst(a: RateRow, b: RateRow): number {
  const av = a.vendor == null ? null : String(a.vendor);
  const bv = b.vendor == null ? null : String(b.vendor);
  if (av === bv) return 0;
  if (av === null) return -1;
  if (bv === null) return 1;
  return av < bv ? -1 : 1;
}
