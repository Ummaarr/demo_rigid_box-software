// Rate-card isolation across the in-process cache (lib/db/rate-cache.ts).
//
// Run: npx tsx --conditions=react-server scripts/validate-rate-isolation.ts
//
// WHY THIS EXISTS. The cache holds EVERY owner's rows in one process-wide table
// and filters in memory, so the owner_id filter is the only thing separating one
// trial account's rates from another's. Nothing visibly breaks if that filter is
// dropped: an estimate still resolves, still prices, still saves — just off
// somebody else's numbers. Trial accounts are competing manufacturers evaluating
// on one deployment, so that is the failure this file exists to catch.
//
// These are pure in-memory checks against matchRows/cachedDerived — no database.

import { cachedDerived, matchRows, type RateRow } from "@/lib/db/rate-cache";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!ok) failures++;
}
function throws(label: string, fn: () => unknown) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  console.log(`  ${threw ? "PASS" : "FAIL"}  ${label}`);
  if (!threw) failures++;
}

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

// One cached table holding the master card plus two trials' clones — exactly
// what rateTable() returns once two trial accounts exist.
const rows: RateRow[] = [
  { id: 1, color: "gold", rate_per_sqin: 1.0, owner_id: null, note: "master" },
  { id: 2, color: "gold", rate_per_sqin: 9.9, owner_id: A, note: "trial A" },
  { id: 3, color: "gold", rate_per_sqin: 5.5, owner_id: B, note: "trial B" },
  { id: 4, color: "silver", rate_per_sqin: 2.0, owner_id: null, note: "master" },
];

const notes = (r: RateRow[]) => r.map((x) => x.note);

console.log("== owner scoping ==");
check(
  "master read (owner_id null) sees only master rows",
  notes(matchRows(rows, "foiling_rates", { color: "gold", owner_id: null })),
  ["master"],
);
check(
  "trial A sees only its own row",
  notes(matchRows(rows, "foiling_rates", { color: "gold", owner_id: A })),
  ["trial A"],
);
check(
  "trial B sees only its own row",
  notes(matchRows(rows, "foiling_rates", { color: "gold", owner_id: B })),
  ["trial B"],
);
check(
  "an owner with no clone falls through to nothing, NOT to master",
  notes(matchRows(rows, "foiling_rates", { color: "gold", owner_id: "unknown-id" })),
  [],
);

console.log("\n== the regression this file guards ==");
// Dropping owner_id is what a careless merge does. Assert it really would be
// wrong, so the checks above are meaningful rather than trivially true.
const unscoped = matchRows(rows, "foiling_rates", { color: "gold" });
check("unscoped lookup returns ALL owners' rows (3)", unscoped.length, 3);
check(
  "...so an unscoped read could price trial A off master or trial B",
  unscoped.some((r) => r.owner_id !== A),
  true,
);

console.log("\n== null semantics are IS NULL, not a value comparison ==");
check(
  "owner_id null does not match a row whose owner_id is the string 'null'",
  matchRows([{ owner_id: "null", x: 1 }], "t", { owner_id: null }).length,
  0,
);
check(
  "owner_id null matches an explicitly undefined column value",
  matchRows([{ owner_id: undefined, x: 1 }], "t", { owner_id: null }).length,
  1,
);

console.log("\n== pre-migration parity ==");
throws(
  "a table without owner_id throws like PostgREST 42703",
  () => matchRows([{ color: "gold" }], "foiling_rates", { color: "gold", owner_id: null }),
);
check(
  "an EMPTY table answers 'column present' and matches nothing",
  matchRows([], "foiling_rates", { color: "gold", owner_id: A }).length,
  0,
);

async function main() {
  console.log("\n== derived cache is keyed per owner ==");
  const seen = await Promise.all([
    cachedDerived("rate-options:master", async () => "master-options"),
    cachedDerived(`rate-options:${A}`, async () => "A-options"),
    cachedDerived(`rate-options:${B}`, async () => "B-options"),
  ]);
  check("three owners get three distinct memo entries", seen, [
    "master-options",
    "A-options",
    "B-options",
  ]);
  // Re-reading must return each owner's OWN memo, not whichever landed last.
  check(
    "re-reads stay per-owner",
    await Promise.all([
      cachedDerived("rate-options:master", async () => "RECOMPUTED"),
      cachedDerived(`rate-options:${A}`, async () => "RECOMPUTED"),
    ]),
    ["master-options", "A-options"],
  );
}

void main().then(() => {
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
});
