// Round 8 (client answers, 2026-07-22):
//   item 9  — manual edits to computed raw-material lines, with the engine
//             recalculating overhead / margin / price-per-box from the edit
//             ("I would want to mend, say, the total foam price to account for
//              their transport costs")
//   naming  — Custom card insert gains size / material type / GSM detail fields
//
// Run: npx tsx scripts/validate-round8.ts

import { estimateMaterials } from "@/lib/engines/material";
import { ADJUSTABLE_LINES, estimateCost, type CostRates } from "@/lib/engines/cost";
import { buildCostView } from "@/lib/estimate/cost-view";
import type { EstimateRequest } from "@/types";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}
function assert(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : ` — ${extra}`}`);
}
const r2 = (n: number) => Math.round(n * 100) / 100;

const DIMS = { length_in: 10, width_in: 8, height_in: 4 };
const mat = estimateMaterials({
  boxType: "tray_only",
  dims: DIMS,
  quantity: 500,
  board: { sheet: { width_in: 31, height_in: 41 } },
  foams: [{ insert: { length_in: 9, width_in: 7 }, sheet: { width_in: 39, height_in: 27 } }],
});

const base: CostRates = {
  boardCostPerSheet: 41,
  accessories: { magnetEach: 0, washerEach: 0, tapePerUnit: 0.75 },
  labour: [],
  overheadPct: 11,
  marginPct: 20,
  foams: [{ costPerSheet: 120 }],
  orderedQuantity: 500,
};

console.log("\n== item 9: manual line edits recalculate downstream ==");
{
  const before = estimateCost(mat, base);
  const bump = 1000;
  const after = estimateCost(mat, {
    ...base,
    adjustments: [{ line: "foam", to: before.foam + bump, note: "incl. transport" }],
  });

  check("edited line reports the edited figure", after.foam, before.foam + bump);
  check("material subtotal moves by the edit", r2(after.materialSubtotal - before.materialSubtotal), bump);

  // The whole point of the ask: overhead (11%) then margin (20%) compound, so
  // the quote moves by 1.11 x 1.20 = 1.332x the edit, not by the edit.
  check("overhead recalculated", r2(after.overhead - before.overhead), r2(bump * 0.11));
  check("margin recalculated", r2(after.margin - before.margin), r2(bump * 1.11 * 0.2));
  check("total moves by edit x 1.332", r2(after.total - before.total), r2(bump * 1.11 * 1.2));
  check("price per box recalculated", r2(after.pricePerBox), r2(after.total / 500));

  // Audit trail — the original engine figure must survive the edit.
  const a = after.adjustments?.[0];
  assert("original computed figure recorded", a?.computed === before.foam, JSON.stringify(a));
  check("delta recorded", a?.delta, bump);
  check("note recorded", a?.note, "incl. transport");
}

console.log("\n== immunity: no adjustments = byte-identical ==");
{
  const a = estimateCost(mat, base);
  const b = estimateCost(mat, { ...base, adjustments: [] });
  const c = estimateCost(mat, { ...base, adjustments: undefined });
  assert("empty list identical to absent", JSON.stringify(a) === JSON.stringify(b));
  assert("undefined identical to absent", JSON.stringify(a) === JSON.stringify(c));
  assert("adjustments key omitted when unused", a.adjustments === undefined);
}

console.log("\n== edit semantics ==");
{
  const before = estimateCost(mat, base);
  // An edit to 0 is a real instruction, not "no edit".
  const zero = estimateCost(mat, { ...base, adjustments: [{ line: "foam", to: 0 }] });
  check("edit to zero honoured", zero.foam, 0);
  check("subtotal drops by the whole line", r2(zero.materialSubtotal), r2(before.materialSubtotal - before.foam));

  // Editing DOWN is as valid as editing up.
  const down = estimateCost(mat, { ...base, adjustments: [{ line: "board", to: 100 }] });
  check("board edited down", down.board, 100);
  assert("total fell", down.total < before.total);

  // Garbage never reaches the total (build-estimate rejects it first, but the
  // engine must not poison the maths if it somehow does).
  const bad = estimateCost(mat, {
    ...base,
    adjustments: [{ line: "foam", to: Number.NaN }, { line: "board", to: -5 }],
  });
  check("NaN edit ignored", bad.foam, before.foam);
  check("negative edit ignored", bad.board, before.board);
  assert("no bogus adjustments recorded", (bad.adjustments ?? []).length === 0);

  // Several lines at once, each independent.
  const multi = estimateCost(mat, {
    ...base,
    adjustments: [{ line: "foam", to: 5000 }, { line: "board", to: 2000 }],
  });
  check("both lines applied", [multi.foam, multi.board], [5000, 2000]);
  check("two adjustments recorded", multi.adjustments?.length, 2);
}

console.log("\n== every advertised line is actually adjustable ==");
{
  // ADJUSTABLE_LINES is the server-side whitelist; each key must name a real
  // number on the breakdown, or the UI would offer an edit that does nothing.
  const cost = estimateCost(mat, base) as unknown as Record<string, unknown>;
  for (const line of ADJUSTABLE_LINES) {
    const present = line === "accessories"
      ? typeof (cost.accessories as { total?: number })?.total === "number"
      : typeof cost[line] === "number";
    assert(`"${line}" exists on the breakdown`, present);
  }
}

console.log("\n== cost view surfaces the edit ==");
{
  const before = estimateCost(mat, base);
  const after = estimateCost(mat, {
    ...base,
    adjustments: [{ line: "foam", to: before.foam + 500, note: "incl. transport" }],
  });
  const specs: EstimateRequest = {
    boxType: "tray_only",
    dims: DIMS,
    quantity: 500,
    boardThickness_mm: 1.5,
    inserts: { foams: [{ type: "XLPE", thickness_mm: 20, insert: { length_in: 9, width_in: 7 } }] },
    adjustments: [{ line: "foam", to: before.foam + 500, note: "incl. transport" }],
  };
  const view = buildCostView(specs, after, mat);
  const foamSection = view.find((s) => s.line === "foam");
  const foamRow = view.flatMap((s) => s.rows).find((r) => r.line === "foam");
  // Foam is editable either as a 1:1 row or, once itemised, at the section.
  const target = foamRow ?? foamSection;
  assert("foam is editable somewhere", target != null);
  check("edited original figure recorded", target?.edited?.computed, before.foam);
  check("note recorded", target?.edited?.note, "incl. transport");
  // The section total is what is charged, so it reports the EDITED figure even
  // though the sub-rows still show the computed split they were derived from.
  const shown = foamRow ? foamRow.total : foamSection?.total;
  check("shows the edited total", shown, before.foam + 500);
  assert("sub-rows keep the computed split",
    (foamSection?.rows.reduce((t, r) => t + r.total, 0) ?? 0) === before.foam);

  // Board is editable and untouched here, so it must be tagged but unedited.
  const boardRow = view.flatMap((s) => s.rows).find((r) => r.line === "board");
  assert("untouched line tagged but not marked edited", boardRow != null && boardRow.edited === undefined);
}

console.log("\n== stale edits (specs changed after the edit) ==");
{
  const mk = (qty: number) => estimateMaterials({
    boxType: "tray_only", dims: DIMS, quantity: qty,
    board: { sheet: { width_in: 31, height_in: 41 } },
  });
  const rates = (qty: number): CostRates => ({
    boardCostPerSheet: 41,
    accessories: { magnetEach: 0, washerEach: 0, tapePerUnit: 0.75 },
    labour: [], overheadPct: 11, marginPct: 20, orderedQuantity: qty,
  });

  const at500 = estimateCost(mk(500), rates(500));
  const pinned = at500.board + 500;

  // Same specs as when the edit was made -> NOT stale.
  const same = estimateCost(mk(500), {
    ...rates(500),
    adjustments: [{ line: "board", to: pinned, basis: at500.board }],
  });
  assert("edit against unchanged specs is not stale", same.adjustments?.[0]?.stale !== true);

  // Quantity doubled after the edit -> the pinned amount no longer matches.
  const moved = estimateCost(mk(1000), {
    ...rates(1000),
    adjustments: [{ line: "board", to: pinned, basis: at500.board }],
  });
  check("edit is flagged stale once specs move", moved.adjustments?.[0]?.stale, true);
  assert("the edit still applies (it was deliberate)", moved.board === pinned);

  // No basis recorded (older edit) -> staleness simply not asserted.
  const noBasis = estimateCost(mk(1000), {
    ...rates(1000),
    adjustments: [{ line: "board", to: pinned }],
  });
  assert("absent basis never claims staleness", noBasis.adjustments?.[0]?.stale === undefined);

  // Sub-cent float noise must not trip the flag.
  const noise = estimateCost(mk(500), {
    ...rates(500),
    adjustments: [{ line: "board", to: pinned, basis: at500.board + 0.001 }],
  });
  assert("float noise is not treated as a change", noise.adjustments?.[0]?.stale !== true);

  // The cost view surfaces it so the UI can warn.
  const staleSpecs: EstimateRequest = {
    boxType: "tray_only", dims: DIMS, quantity: 1000, boardThickness_mm: 1.5,
    adjustments: [{ line: "board", to: pinned, basis: at500.board }],
  };
  const boardRow2 = buildCostView(staleSpecs, moved, mk(1000))
    .flatMap((sec) => sec.rows).find((r) => r.line === "board");
  check("cost view exposes stale", boardRow2?.edited?.stale, true);
}

console.log("\n== custom card insert detail fields ==");
{
  const cost = estimateCost(mat, { ...base, cardCost: 2500 } as CostRates & { cardCost?: number });
  void cost;
  const withDetail: EstimateRequest = {
    boxType: "tray_only",
    dims: DIMS,
    quantity: 500,
    boardThickness_mm: 1.5,
    inserts: {
      card: {
        total: 2500,
        size: { length_in: 9.5, width_in: 6.25 },
        materialType: "Grey board",
        gsm: 300,
      },
    },
  };
  const costWithCard = { ...estimateCost(mat, base), card: 2500 };
  const rows = buildCostView(withDetail, costWithCard, mat).flatMap((s) => s.rows);
  const cardRow = rows.find((r) => r.label === "Custom card insert");
  assert("custom card row present", cardRow != null);
  check("detail lists size, material and GSM",
    cardRow?.detail, "9.50 × 6.25 in · Grey board · 300 GSM · manual cost");

  // Snapshots saved before the detail fields existed must still read cleanly.
  const legacy: EstimateRequest = { ...withDetail, inserts: { card: { total: 2500 } } };
  const legacyRow = buildCostView(legacy, costWithCard, mat)
    .flatMap((s) => s.rows).find((r) => r.label === "Custom card insert");
  check("legacy card row unchanged", legacyRow?.detail, "manual cost");
}

console.log(
  failures === 0
    ? "\nALL PASS\n"
    : `\n${failures} FAILURE(S)\n`,
);
process.exit(failures === 0 ? 0 : 1);
