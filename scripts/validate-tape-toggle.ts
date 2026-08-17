// Tape toggle (manual.tapeUsed) — asserts the three states the form offers and
// the backward-compatibility guarantee that makes the flag safe to add.
//
// Run: npx tsx --conditions=react-server scripts/validate-tape-toggle.ts
// (react-server because build-estimate.ts imports "server-only".)
//
// Two layers are checked:
//   1. resolveTapeOverride() — the request -> override mapping
//   2. estimateCost()        — what Engine 2 actually charges for each override
//
// The property that matters most is the LAST one: a snapshot saved before the
// toggle existed has no `tapeUsed` key, and must still price exactly as it did.

import { estimateMaterials } from "@/lib/engines/material";
import { estimateCost, type CostRates } from "@/lib/engines/cost";
import { resolveTapeOverride } from "@/lib/estimate/build-estimate";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = Object.is(got, want);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: got ${String(got)}${ok ? "" : `, want ${String(want)}`}`);
  if (!ok) failures++;
}

// Telescopic 10x8x4 x500 -> tray + lid = 2 tape units per box = 1000 total.
const mat = estimateMaterials({
  boxType: "telescopic",
  dims: { length_in: 10, width_in: 8, height_in: 4 },
  vars: { lidDepth_in: 1.5 },
  quantity: 500,
  board: { sheet: { width_in: 31, height_in: 41 } },
  outerPaper: { sheet: { width_in: 23, height_in: 36 }, foldingAllowance_mm: 20 },
  innerPaper: { sheet: { width_in: 23, height_in: 36 } },
});

const baseRates: CostRates = {
  boardCostPerSheet: 41,
  outerPaperCostPerSheet: 9,
  innerPaperCostPerSheet: 9,
  printing: { mode: "offset", first1000: 5000, additional1000: 1200 },
  finishing: [{ kind: "lamination", ratePer100sqin: 0.9 }],
  accessories: { magnetEach: 0, washerEach: 0, tapePerUnit: 0.75 },
  labour: [{ role: "cutting", unit: "day", rate: 1560, quantity: 2 }],
  overheadPct: 11,
  marginPct: 20,
};

const AUTO_TAPE = 1000 * 0.75; // 750

console.log("Fixture: telescopic 10x8x4 x500 -> 1000 tape units @ 0.75");
check("auto tape units (tray+lid x 500)", mat.accessories.tape, 1000);

// --- 1. request -> override mapping ---------------------------------------
console.log("\n== resolveTapeOverride (request -> override) ==");
check("toggle ON, blank        -> undefined (auto)", resolveTapeOverride({}, true), undefined);
check("toggle ON, amount 500   -> 500", resolveTapeOverride({ tapeTotal: 500 }, true), 500);
check("toggle OFF              -> 0", resolveTapeOverride({ tapeUsed: false }, true), 0);
check(
  "toggle OFF + amount 500 -> 0 (amount ignored)",
  resolveTapeOverride({ tapeUsed: false, tapeTotal: 500 }, true),
  0,
);
check("tapeUsed absent         -> undefined (auto)", resolveTapeOverride({ tapeTotal: undefined }, true), undefined);
check("tapeUsed: true, blank   -> undefined (auto)", resolveTapeOverride({ tapeUsed: true }, true), undefined);
check("manual absent entirely  -> undefined (auto)", resolveTapeOverride(undefined, true), undefined);
check("board section OFF       -> 0", resolveTapeOverride({ tapeTotal: 500 }, false), 0);
check("board OFF beats toggle ON", resolveTapeOverride({ tapeUsed: true, tapeTotal: 500 }, false), 0);

// --- 2. override -> charged cost ------------------------------------------
console.log("\n== estimateCost (override -> charged tape) ==");
const tapeFor = (override: number | undefined) =>
  estimateCost(mat, { ...baseRates, tapeCostOverride: override }).accessories.tape;

check("undefined -> auto 750", tapeFor(undefined), AUTO_TAPE);
check("500       -> 500", tapeFor(500), 500);
check("0         -> 0 (no tape charged)", tapeFor(0), 0);

// --- 3. end-to-end, the three states the user sees -------------------------
console.log("\n== end to end ==");
const endToEnd = (manual: Parameters<typeof resolveTapeOverride>[0]) =>
  tapeFor(resolveTapeOverride(manual, true));

check("ON  + blank  -> 750 (rate card)", endToEnd({}), AUTO_TAPE);
check("ON  + 500    -> 500 (override)", endToEnd({ tapeTotal: 500 }), 500);
check("OFF          -> 0   (no tape)", endToEnd({ tapeUsed: false }), 0);

// --- 4. backward compatibility --------------------------------------------
// The whole point of defaulting an ABSENT tapeUsed to "used": a specs_snapshot
// written before the toggle shipped has no such key, and must reprice
// identically. Rebuilt here as a literal old-shaped snapshot, no tapeUsed key.
console.log("\n== backward compatibility (pre-toggle snapshots) ==");
const legacyBlank = { glueTotal: 120 } as const;
const legacyWithTape = { glueTotal: 120, tapeTotal: 500 } as const;
check("legacy, no tape key -> auto 750", endToEnd(legacyBlank), AUTO_TAPE);
check("legacy, tapeTotal 500 -> 500", endToEnd(legacyWithTape), 500);
check(
  "legacy total is unchanged by the new field",
  estimateCost(mat, { ...baseRates, tapeCostOverride: resolveTapeOverride(legacyBlank, true) }).total,
  estimateCost(mat, { ...baseRates, tapeCostOverride: undefined }).total,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
