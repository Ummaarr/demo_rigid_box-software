// Per-business sheet sizes + metric entry (v9).
//
// Run: npx tsx --conditions=react-server scripts/validate-sheet-sizes.ts
// (react-server because lib/db/rates.ts imports "server-only".)
//
// Three properties, in order of how quietly they would break:
//
//   1. STORAGE IS STILL INCHES. A sheet entered as 70 x 100 cm must nest to the
//      exact same sheet count as the same sheet entered in inches. If this ever
//      fails, the unit stopped being cosmetic and started moving prices.
//   2. THE LABEL GUARD IS UNIT-AWARE. A metric row's label reads "70x100"
//      against 27.559 x 39.370 in. Compared raw that looks like a mismatch, and
//      the old guard would have cried wolf on every correct metric row.
//   3. BOARD STAYS RESOLVABLE. Board is now keyed (size_label, thickness_mm),
//      but every estimate saved before that has no label at all. An absent
//      label must still resolve — deterministically, and without throwing.

import { estimateMaterials } from "@/lib/engines/material";
import { boardStockRow } from "@/lib/db/rates";
import { invalidateRateCache } from "@/lib/db/rate-cache";
import { formatSheet, fromDim, labelAgreesWithSheet, toDim } from "@/lib/units";
import type { SupabaseClient } from "@supabase/supabase-js";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!ok) failures++;
}

// ===========================================================================
console.log("== A: display ==");
check("A1: inches unchanged", formatSheet(23, 36, "in"), "23 × 36 in");
check("A2: a 70x100 cm sheet reads back in cm", formatSheet(fromDim(70, "cm"), fromDim(100, "cm"), "cm"), "70 × 100 cm");
check("A3: mm", formatSheet(fromDim(1000, "mm"), fromDim(700, "mm"), "mm"), "1000 × 700 mm");
check("A4: an inch sheet shown in cm converts", formatSheet(23, 36, "cm"), "58.42 × 91.44 cm");

// ===========================================================================
console.log("\n== B: the label guard is unit-aware ==");
const cmSheet = { width_in: fromDim(70, "cm"), height_in: fromDim(100, "cm") };
check("B1: '70x100' + cm agrees with its own stored inches", labelAgreesWithSheet("70x100", cmSheet, "cm"), true);
check("B2: ...and DISAGREES read as inches (the old behaviour)", labelAgreesWithSheet("70x100", cmSheet, "in"), false);
check("B3: either orientation still agrees", labelAgreesWithSheet("100x70", cmSheet, "cm"), true);
check("B4: a genuinely wrong label still fails", labelAgreesWithSheet("50x70", cmSheet, "cm"), false);
check("B5: inch rows unaffected", labelAgreesWithSheet("23x36", { width_in: 23, height_in: 36 }, "in"), true);
// Fails OPEN, exactly as before — plenty of real names never parse.
check("B6: 'A4' still passes", labelAgreesWithSheet("A4", cmSheet, "cm"), true);
check("B7: 'Custom' still passes", labelAgreesWithSheet("Custom", cmSheet, "in"), true);

// ===========================================================================
console.log("\n== C: storage is still inches (a unit must not move a price) ==");
// 70 x 100 cm == 27.559 x 39.370 in. Nest the same box on both descriptions.
const nest = (sheet: { width_in: number; height_in: number }) =>
  estimateMaterials({
    boxType: "telescopic",
    dims: { length_in: 10, width_in: 8, height_in: 4 },
    vars: { lidDepth_in: 1.5 },
    quantity: 500,
    board: { sheet },
    outerPaper: { sheet: { width_in: 23, height_in: 36 }, foldingAllowance_mm: 20 },
    innerPaper: { sheet: { width_in: 23, height_in: 36 } },
  }).board.totalSheets;

const viaCm = nest({ width_in: fromDim(70, "cm"), height_in: fromDim(100, "cm") });
const viaIn = nest({ width_in: 27.5590551181, height_in: 39.3700787402 });
check("C1: cm-entered sheet nests identically to the same inches", viaCm, viaIn);
console.log(`        (both = ${viaCm} board sheets)`);
check("C2: and it is a real result, not two Infinities", Number.isFinite(viaCm), true);
// C1 must not be able to pass trivially. A MUCH larger sheet has to need
// fewer sheets, which proves nest() actually responds to its input.
// (Deliberately not 31x41 as the control: it fits the same blanks per sheet as
// 70x100 cm, so it would have compared equal for an honest reason.)
const viaBig = nest({ width_in: 50, height_in: 70 });
check("C3: a much larger sheet needs strictly fewer", viaBig < viaCm, true);
console.log(`        (50 × 70 in = ${viaBig} vs ${viaCm})`);

// ===========================================================================
console.log("\n== D: unit round-trip through the input box ==");
for (const unit of ["cm", "mm"] as const) {
  for (const nominal of [70, 100, 72.5]) {
    const stored = fromDim(nominal, unit);
    const back = toDim(stored, unit);
    check(`D: ${nominal}${unit} -> in -> ${unit}`, Math.abs(back - nominal) < 0.005, true);
  }
}

// ===========================================================================
// A stub standing in for PostgREST: rateTable() only ever does
// `.from(t).select("*")`, so this is the whole surface boardStockRow touches.
const fakeDb = (rows: Record<string, unknown>[]) =>
  ({ from: () => ({ select: async () => ({ data: rows, error: null }) }) }) as unknown as SupabaseClient;

const BOARD: Record<string, unknown>[] = [
  { id: 1, size_label: "31x41", thickness_mm: 1.5, sheet_width_in: 31, sheet_height_in: 41, cost_per_sheet: 30, owner_id: null, size_unit: "in" },
  { id: 2, size_label: "70x100", thickness_mm: 1.5, sheet_width_in: 27.5590551181, sheet_height_in: 39.3700787402, cost_per_sheet: 44, owner_id: null, size_unit: "cm" },
  { id: 3, size_label: "50x70", thickness_mm: 1.5, sheet_width_in: 19.685, sheet_height_in: 27.559, cost_per_sheet: 22, owner_id: null, size_unit: "cm" },
];

async function main() {
  console.log("\n== E: board resolution (several sheets at one thickness) ==");
  const resolve = async (label: string | undefined, rows = BOARD) => {
    invalidateRateCache(); // the cache is keyed by table name only
    return boardStockRow(fakeDb(rows), 1.5, label, null);
  };

  check("E1: an explicit label picks that sheet", (await resolve("70x100"))?.id, 2);
  check("E2: a different label picks a different sheet", (await resolve("50x70"))?.id, 3);
  // THE regression this guards: before board had a label, `row()` threw
  // "2 rows matched a lookup that must return one" on any multi-size card.
  check("E3: NO label resolves rather than throwing", (await resolve(undefined))?.id, 1);
  check("E4: ...and picks 31x41, what legacy estimates were costed on", (await resolve(undefined))?.size_label, "31x41");
  // Without a 31x41 row it must still be deterministic, not arbitrary.
  const noLegacy = BOARD.filter((r) => r.size_label !== "31x41");
  check("E5: no 31x41 row -> lowest id, deterministically", (await resolve(undefined, noLegacy))?.id, 2);
  check("E6: an unknown label finds nothing (not a silent fallback)", (await resolve("99x99")), null);
  // Owner scoping still applies on top — a trial must not see the master card.
  const owned = BOARD.map((r) => ({ ...r, owner_id: "trial-a" }));
  check("E7: master read ignores another owner's rows", (await resolve(undefined, owned)), null);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
