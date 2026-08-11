// End-to-end DB wiring check: buildEstimate() with rates loaded from a real
// Supabase DB, for the same telescopic 10x8x4 x500 case as validate-engines.ts.
// Proves the app's DB path resolves every rate and that the cost ladder holds
// together, against whatever rate card the target database happens to have.
//
// Reads .env.local, so it runs against whichever project that points at.
//
// Run (server-only must resolve to a no-op outside Next):
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/estimate-from-db.ts

import { readFileSync } from "node:fs";

import { createAdminClient } from "@/lib/db/admin";
import { buildEstimate, costForRole } from "@/lib/estimate/build-estimate";

// Load .env.local so the admin client can read the Supabase URL + service key.
function loadEnv() {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

let failures = 0;
function check(label: string, got: number, want: number, tol = 1e-6) {
  const ok = Math.abs(got - want) <= tol;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: got ${got}${ok ? "" : `, want ${want}`}`);
  if (!ok) failures++;
}

async function main() {
  loadEnv();
  const admin = createAdminClient();

  // Live-DB drift guard (2026-07-05): the admin renamed rate rows to Title
  // Case ('Matte'), so resolve the matte-lamination KEY from the DB instead of
  // hardcoding lowercase — the form does the same (options come from the DB).
  const { data: lamRows } = await admin.from("lamination_rates").select("type");
  const matteKey =
    (lamRows ?? []).map((r) => r.type as string).find((t) => t.toLowerCase() === "matte") ??
    "matte";

  const built = await buildEstimate(
    {
      boxType: "telescopic",
      dims: { length_in: 10, width_in: 8, height_in: 4 },
      vars: { lidDepth_in: 1.5 },
      quantity: 500,
      boardThickness_mm: 1.5,
      wrapping: {
        outer: {
          mode: "printed",
          paperSizeLabel: "23x36",
          gsm: 130,
          foldingAllowance_mm: 20,
          printing: { type: "offset", sizeLabel: "23x36" },
        },
        inner: { paperSizeLabel: "23x36", gsm: 130 },
      },
      finishing: [{ kind: "lamination", key: matteKey }],
      labour: [{ role: "Cutting", unit: "day", quantity: 2 }],
    },
    admin,
  );

  const { materials: mat, cost, ratesSnapshot } = built;

  console.log("Rates resolved from DB:");
  console.log(
    `  board/sheet ${ratesSnapshot.board.costPerSheet}, paper ${ratesSnapshot.outer?.costPerSheet}, tape ${ratesSnapshot.tapePerUnit}, overhead ${ratesSnapshot.overheadPct}%, margin ${ratesSnapshot.marginPct}%`,
  );

  // GEOMETRY goldens: these depend on sheet SIZES and blank dimensions, never on
  // prices, so they hold against any rate card. Combination nesting shares board
  // sheets across components — 2 trays + 2 lids per 31x41 sheet -> 250 combined
  // vs 334 if each component were cut on its own sheets.
  console.log("\nMaterial quantities (geometry — independent of rates):");
  check("board sheets (combined)", mat.board.totalSheets, 250);
  check("board sheets (separate baseline)", mat.board.combination!.separateSheets, 334);
  // Outer runs +10% printed-sheet wastage (500 -> 550) from print_wastage_pct.
  check("outer paper sheets", mat.outerPaper!.totalSheets, 550);
  check("inner paper sheets", mat.innerPaper!.totalSheets, 375);
  check("tape units", mat.accessories.tape, 1000);

  // COST assertions are RELATIONS, not amounts. Every rate is admin-editable, so
  // a hardcoded rupee golden fails the moment someone edits the rate card even
  // though the engine is correct. What must hold is the shape of the ladder.
  console.log("\nCost (DB-driven) reconciliation — relations, not amounts:");
  check("level1 = materials + labour", cost.level1, cost.materialSubtotal + cost.labour);
  check(
    `overhead = ${ratesSnapshot.overheadPct}% of level 1`,
    cost.overhead,
    (cost.level1 * ratesSnapshot.overheadPct) / 100,
  );
  check(
    "level 2 = level1 + overhead",
    cost.costBeforeMargin,
    cost.level1 + cost.overhead,
  );
  check(
    `margin = ${ratesSnapshot.marginPct}% of level 2`,
    cost.margin,
    (cost.costBeforeMargin * ratesSnapshot.marginPct) / 100,
  );
  check(
    "after-margin = level 2 + margin",
    cost.subtotalAfterMargin,
    cost.costBeforeMargin + cost.margin,
  );
  check("total", cost.total, cost.subtotalAfterMargin + cost.additional.total);
  check("price per box", cost.pricePerBox, cost.total / 500);
  check("every cost line is finite", Number.isFinite(cost.total) ? 1 : 0, 1);
  check("total is positive", cost.total > 0 ? 1 : 0, 1);

  console.log(`\nTOTAL ₹${cost.total.toFixed(2)}  |  PRICE/BOX ₹${cost.pricePerBox.toFixed(2)}`);

  // Role-based stripping (what the API returns per role).
  console.log("\nRole stripping (costForRole):");
  const adminView = costForRole(cost, "admin");
  const staffView = costForRole(cost, "staff");
  check("admin sees margin", "margin" in adminView ? 1 : 0, 1);
  check("staff margin hidden", "margin" in staffView ? 1 : 0, 0);
  check("staff after-margin subtotal hidden", "subtotalAfterMargin" in staffView ? 1 : 0, 0);
  check("staff still sees pricePerBox", "pricePerBox" in staffView ? 1 : 0, 1);
  check("staff still sees costs (board)", "board" in staffView ? 1 : 0, 1);

  // Persistence round-trip (same payload the save route writes), then clean up.
  console.log("\nPersistence round-trip (estimates insert/read/delete):");
  const { data: ins, error: insErr } = await admin
    .from("estimates")
    .insert({
      box_type: built.specsSnapshot.boxType,
      quantity: built.specsSnapshot.quantity,
      specs_snapshot: built.specsSnapshot,
      rates_snapshot: built.ratesSnapshot,
      cost_breakdown: cost,
      price_per_box: cost.pricePerBox,
      total_price: cost.total,
    })
    .select("id, specs_snapshot, rates_snapshot, cost_breakdown, price_per_box, total_price")
    .single();
  if (insErr || !ins) {
    console.log(`  FAIL  insert: ${insErr?.message ?? "no row"}`);
    failures++;
  } else {
    check("saved price_per_box", Number(ins.price_per_box), cost.pricePerBox, 0.01);
    check("saved total_price", Number(ins.total_price), cost.total, 0.01);
    check("snapshots + breakdown stored", ins.specs_snapshot && ins.rates_snapshot && ins.cost_breakdown ? 1 : 0, 1);
    await admin.from("estimates").delete().eq("id", ins.id);
    console.log(`  (cleaned up test estimate ${ins.id})`);
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
