// Read rate rows STRAIGHT from the Supabase DB (service role) — no app, no React
// state, no cache. Whatever this prints is the actual persisted value in Postgres.
//
// Use it to prove the rate-management UI writes to the backend:
//   1. Run it, note a value          (e.g. board 1.5mm = 30, Dummy)
//   2. Edit that value in /rates in the browser
//   3. Run it again — the new value + "Real" status here = persisted to DB.
//
// Run:
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/show-rates.ts
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/show-rates.ts board_rates

import { readFileSync } from "node:fs";

import { createAdminClient } from "@/lib/db/admin";

function loadEnv() {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

// Tables to dump by default. Pass a table name as an arg to show just one.
const TABLES = [
  "board_rates",
  "paper_rates",
  "magnet_rates",
  "washer_rates",
  "foam_rates",
  "consumable_rates",
  "labour_rates",
  "app_config",
  "margin_config",
];

async function main() {
  loadEnv();
  const admin = createAdminClient();
  const only = process.argv[2];
  const tables = only ? [only] : TABLES;

  for (const table of tables) {
    const { data, error } = await admin
      .from(table)
      .select("*")
      .order(table === "app_config" || table === "margin_config" ? "key" : "id")
      .limit(50);

    console.log(`\n=== ${table} ===`);
    if (error) {
      console.log(`  ERROR: ${error.message}`);
      continue;
    }
    for (const row of data ?? []) {
      const r = row as Record<string, unknown>;
      const updated =
        typeof r.updated_at === "string"
          ? new Date(r.updated_at).toLocaleString("en-IN")
          : "";
      // Drop noisy/constant fields for a compact line.
      const { id: _id, updated_at: _u, ...rest } = r;
      void _id;
      void _u;
      console.log(`  ${JSON.stringify(rest)}   (updated ${updated})`);
    }
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
