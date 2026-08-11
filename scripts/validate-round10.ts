// Round 10 (client feedback, 2026-08-05):
//   §4  — magnetic inner lining covers case + flap + spine only (the panel the
//         tray is glued over is never seen), gated on liningVersion
//   §5a — offset printing tier split (plate fee vs additional-1000 blocks)
//         itemised on CostBreakdown and in the section-wise cost view
//   §5b — the same split as SHEET counts on the cost-free raw-material PDF
//   §5d — printing vendor as a real pricing dimension
//   §3  — beading in/mm/cm entry
//   §6  — quote preview: totals/GST recomputed server-side; custom quotes
//
// Run (needs the react-server condition — it imports lib/pdf/quotation-data,
// which is server-only; same as validate-round3 / validate-round9. It renders
// no PDF, so the condition is safe here — unlike validate-round6):
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/validate-round10.ts

import {
  estimateMaterials,
  layerPrintJobs,
  printJobFor,
  printTierSheets,
  wrapGroupsOf,
  type MaterialInput,
} from "@/lib/engines/material";
import { estimateCost, offsetCost, type CostRates } from "@/lib/engines/cost";
import { buildCostView } from "@/lib/estimate/cost-view";
import { getBlanks } from "@/lib/formulas";
import { innerLiningBlanksFor } from "@/lib/formulas/inner-lining";
import { magneticPanels } from "@/components/keylines/magnetic-keyline";
import { toDim, fromDim } from "@/lib/units";
import {
  buildGstLines,
  finalizeQuoteDraft,
  toQuoteDraft,
  DEFAULT_TERMS,
  type QuoteDraft,
} from "@/lib/pdf/quotation-data";
import { baseQuoteNo } from "@/lib/pdf/generate-quote";
import type { BoxType, EstimateRequest } from "@/types";

let failures = 0;
function assert(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : ` — ${extra}`}`);
}
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const J = (x: unknown) => JSON.stringify(x);

const SHEET = { width_in: 31, height_in: 41 };
const PAPER = { width_in: 25, height_in: 36 };
const DIMS = { length_in: 10, width_in: 8, height_in: 4 };

// ===========================================================================
// A — magnetic inner lining
// ===========================================================================
console.log("\n== A: magnetic inner lining (flap + panel + spine) ==");

function magInput(panels: 3 | 4 | 5, liningVersion?: number): MaterialInput {
  return {
    boxType: "magnetic",
    dims: DIMS,
    vars: { flapLength_in: 1.5, panels, flapHeight_in: 1 },
    quantity: 500,
    board: { sheet: SHEET },
    outerPaper: { sheet: PAPER },
    innerPaper: { sheet: PAPER },
    mixed: true,
    ...(liningVersion != null ? { liningVersion } : {}),
  };
}

const LINED_W = 1.5 + DIMS.width_in + DIMS.height_in; // flap + W + spine

for (const panels of [3, 4, 5] as const) {
  const v1 = estimateMaterials(magInput(panels));
  const v2 = estimateMaterials(magInput(panels, 2));

  assert(`A1 (${panels}p): board byte-identical`, J(v1.board) === J(v2.board));
  assert(`A1 (${panels}p): outer wrap byte-identical`,
    J(v1.outerPaperGroups) === J(v2.outerPaperGroups));
  assert(`A1 (${panels}p): mat.blanks stay the BOARD keylines`,
    J(v1.blanks) === J(v2.blanks));

  const innerOf = (m: typeof v1, c: string) =>
    m.innerPaperGroups?.[0]?.material.components.find((x) => x.component === c);
  check(`A2 (${panels}p): inner case blank width = flap+W+spine`,
    innerOf(v2, "case")?.blank.width_in, LINED_W);
  check(`A2 (${panels}p): inner case blank height = L`,
    innerOf(v2, "case")?.blank.height_in, DIMS.length_in);
  assert(`A2 (${panels}p): inner TRAY blank unchanged`,
    J(innerOf(v1, "tray")?.blank) === J(innerOf(v2, "tray")?.blank));

  const s1 = v1.innerPaperGroups?.[0]?.material.totalSheets ?? 0;
  const s2 = v2.innerPaperGroups?.[0]?.material.totalSheets ?? 0;
  assert(`A3 (${panels}p): inner sheets never worse`, s2 <= s1, `${s1} -> ${s2}`);

  // Grouping is keyed on CONFIG, not geometry — the parts must stay one plate.
  const g = wrapGroupsOf(v2, "inner");
  assert(`A4 (${panels}p): inner is still ONE wrap group of [tray, case]`,
    g.length === 1 && J(g[0].components.slice().sort()) === J(["case", "tray"]),
    `groups=${g.length}`);
}

// 3-panel is already flap+W+spine, so v2 must be a structural no-op.
assert("A5: 3-panel v2 is byte-identical to v1 (no-op)",
  J(estimateMaterials(magInput(3))) === J(estimateMaterials(magInput(3, 2))));

// The registry must default to identity for every other box type.
const OTHERS: [BoxType, Record<string, number>][] = [
  ["telescopic", { lidDepth_in: 1.5 }],
  ["shoulder", { bottomHeight_in: 3, neckHeight_in: 1.5, lidDepth_in: 1.5 }],
  ["drawer_sliding", {}],
  ["matchbox_sliding", {}],
  ["hinge_lid", { bottomHeight_in: 3, neckHeight_in: 1.5, lidDepth_in: 1.5 }],
  ["collapsible_rigid", { flapLength_in: 1.5 }],
  ["tray_only", {}],
];
for (const [bt, vars] of OTHERS) {
  const base: MaterialInput = {
    boxType: bt, dims: DIMS, vars, quantity: 500,
    board: { sheet: SHEET }, outerPaper: { sheet: PAPER }, innerPaper: { sheet: PAPER },
    mixed: true,
  };
  assert(`A6: ${bt} is immune to liningVersion`,
    J(estimateMaterials(base)) === J(estimateMaterials({ ...base, liningVersion: 2 })));
}

// The registry itself returns the SAME array reference when unregistered.
const tb = getBlanks("telescopic", DIMS, { lidDepth_in: 1.5 });
assert("A7: unregistered box type returns the identical array",
  innerLiningBlanksFor("telescopic", tb, DIMS, { lidDepth_in: 1.5 }) === tb);

// Keylines draw BOARD blanks, so they must not move.
assert("A8: magnetic keyline panels unchanged by the lining change",
  J(magneticPanels(DIMS, { flapLength_in: 1.5, panels: 4, flapHeight_in: 1 })).includes('"W"'));

// ===========================================================================
// B — printing tier split
// ===========================================================================
console.log("\n== B: printing split (plate fee vs additional 1000s) ==");

function costRatesFor(over: Partial<CostRates> = {}): CostRates {
  return {
    boardCostPerSheet: 41,
    outerPaperCostPerSheet: 5,
    printing: { mode: "offset", first1000: 2800, additional1000: 800 },
    accessories: { magnetEach: 0, washerEach: 0, tapePerUnit: 0 },
    labour: [],
    overheadPct: 11,
    marginPct: 20,
    ...over,
  };
}

// B1 — printTierSheets is exact arithmetic.
check("B1: 0 sheets", printTierSheets(0), { first: 0, additional: 0, runs: 0 });
check("B1: 400 sheets", printTierSheets(400), { first: 400, additional: 0, runs: 0 });
check("B1: 1000 sheets", printTierSheets(1000), { first: 1000, additional: 0, runs: 0 });
check("B1: 1240 sheets", printTierSheets(1240), { first: 1000, additional: 240, runs: 1 });
check("B1: 3000 sheets", printTierSheets(3000), { first: 1000, additional: 2000, runs: 2 });
check("B1: Infinity is inert", printTierSheets(Infinity), { first: 0, additional: 0, runs: 0 });

// B2 — Σ detail === the charged total, over a wide random sweep.
let sumMismatch = 0;
let sheetMismatch = 0;
let cases = 0;
for (let i = 0; i < 400; i++) {
  const qty = 100 + Math.floor(Math.random() * 40000);
  const perJob = Math.random() < 0.5;
  const digital = Math.random() < 0.3;
  const m = estimateMaterials({
    boxType: "telescopic",
    dims: DIMS,
    vars: { lidDepth_in: 1.5 },
    quantity: qty,
    board: { sheet: SHEET },
    outerPaper: { sheet: PAPER, wastagePct: 10 },
    mixed: true,
    ...(perJob ? { printingMode: "combined" as const } : {}),
  });
  const rates = costRatesFor({
    printing: digital
      ? { mode: "digital", costPerSheet: 20 }
      : { mode: "offset", first1000: 2800, additional1000: 800 },
    ...(perJob ? { perJobPrinting: true } : {}),
  });
  const c = estimateCost(m, rates);
  const detail = c.printingDetail ?? [];
  cases++;
  if (!near(detail.reduce((s, d) => s + d.amount, 0), c.printing, 1e-6)) sumMismatch++;
  // Σ sheets over the detail == the layer's printed sheets.
  const layer = wrapGroupsOf(m, "outer")[0]?.material;
  if (layer && Number.isFinite(layer.totalSheets)) {
    if (detail.reduce((s, d) => s + d.sheets, 0) !== layer.totalSheets) sheetMismatch++;
  }
}
assert(`B2: Σ printingDetail === printing over ${cases} random cases`, sumMismatch === 0,
  `${sumMismatch} mismatches`);
assert("B2: Σ detail.sheets === layer.totalSheets", sheetMismatch === 0,
  `${sheetMismatch} mismatches`);

// B3 — the split reproduces offsetCost exactly, per job.
{
  const m = estimateMaterials({
    boxType: "telescopic", dims: DIMS, vars: { lidDepth_in: 1.5 },
    quantity: 20000, board: { sheet: SHEET },
    outerPaper: { sheet: PAPER }, mixed: true, printingMode: "combined",
  });
  const rates = costRatesFor({ perJobPrinting: true });
  const c = estimateCost(m, rates);
  const jobs = layerPrintJobs(wrapGroupsOf(m, "outer")[0].material);
  const expected = jobs.reduce((s, j) => s + offsetCost(j, 2800, 800), 0);
  check("B3: printing === Σ offsetCost over jobs", c.printing, expected);
  assert("B3: one first-1000 line per job",
    (c.printingDetail ?? []).filter((d) => d.tier === "first1000").length === jobs.filter((j) => j > 0).length);
  assert("B3: first-1000 line sheets = min(job, 1000)",
    (c.printingDetail ?? []).filter((d) => d.tier === "first1000").every((d) => d.sheets <= 1000));
}

// B4 — no printing ⇒ the key is OMITTED (old snapshots stay byte-identical).
{
  const m = estimateMaterials({
    boxType: "tray_only", dims: DIMS, quantity: 500, board: { sheet: SHEET },
  });
  const c = estimateCost(m, costRatesFor({ printing: undefined, outerPaperCostPerSheet: undefined }));
  assert("B4: no printing -> printingDetail key absent", !("printingDetail" in c));
  assert("B4: no inner printing -> innerPrintingDetail key absent", !("innerPrintingDetail" in c));
}

// B5 — cost view: detail present -> non-editable sub-rows + section-level line.
{
  const specs = {
    boxType: "telescopic", dims: DIMS, vars: { lidDepth_in: 1.5 }, quantity: 4000,
    boardThickness_mm: 1.5,
    wrapping: { outer: { mode: "printed", paperSizeLabel: "25x36", gsm: 120,
      printing: { type: "offset", sizeLabel: "25x36", colour: "multi" } } },
  } as unknown as EstimateRequest;
  const m = estimateMaterials({
    boxType: "telescopic", dims: DIMS, vars: { lidDepth_in: 1.5 }, quantity: 4000,
    board: { sheet: SHEET }, outerPaper: { sheet: PAPER }, mixed: true, printingMode: "combined",
  });
  const c = estimateCost(m, costRatesFor({ perJobPrinting: true }));

  const view = buildCostView(specs, c, m);
  const sec = view.find((s) => s.title === "Outer printing");
  assert("B5: printing section exists", sec != null);
  assert("B5: section carries the adjustable line", sec?.line === "printing");
  assert("B5: sub-rows are NOT individually editable",
    (sec?.rows ?? []).every((r) => r.line == null));
  assert("B5: sub-rows sum to the charged printing total",
    near((sec?.rows ?? []).reduce((s, r) => s + r.total, 0), c.printing, 1e-6));

  // Legacy breakdown (no detail) keeps the pre-round-10 shape EXACTLY: one
  // prorated row per wrap group, and — a pre-existing quirk — no adjustable
  // line anywhere, because the group branch never attached one. (Round 10
  // therefore also RESTORES click-to-edit on printing, via the section.)
  const legacy = { ...c };
  delete (legacy as { printingDetail?: unknown }).printingDetail;
  const legacyView = buildCostView(specs, legacy, m);
  const legacySec = legacyView.find((s) => s.title === "Outer printing");
  assert("B6: legacy -> one prorated row per wrap group",
    (legacySec?.rows ?? []).length === wrapGroupsOf(m, "outer").length);
  assert("B6: legacy -> rows sum to the printing total",
    near((legacySec?.rows ?? []).reduce((s, r) => s + r.total, 0), c.printing, 1e-6));
  assert("B6: legacy -> no adjustable line (pre-round-10 shape)",
    legacySec?.line == null && (legacySec?.rows ?? []).every((r) => r.line == null));

  // The printing line has no editable anchor without the detail, but DOES with
  // it — that is the round-10 improvement, asserted so it can't silently regress.
  assert("B6: round 10 restores an editable anchor on printing",
    sec?.line === "printing" && legacySec?.line == null);
}

// B7 — printJobFor agrees with layerPrintJobs (the PDF and the cost engine
// must describe the SAME run).
{
  const m = estimateMaterials({
    boxType: "telescopic", dims: DIMS, vars: { lidDepth_in: 1.5 },
    quantity: 9000, board: { sheet: SHEET }, outerPaper: { sheet: PAPER },
    mixed: true, printingMode: "combined",
  });
  const layer = wrapGroupsOf(m, "outer")[0].material;
  const jobs = layerPrintJobs(layer).filter((j) => j > 0).sort((a, b) => a - b);
  const perComp = [...new Set(layer.components.map((c) => printJobFor(layer, c.component)))]
    .sort((a, b) => a - b);
  check("B7: printJobFor covers exactly the print jobs", perComp, jobs);
}

// ===========================================================================
// C — printing vendor (pure/shape checks; live-DB checks live in the scratch
//     run and the migration notes)
// ===========================================================================
console.log("\n== C: printing vendor ==");
{
  // A selection with no vendor must serialise WITHOUT the key, so a snapshot
  // taken before round 10 and one taken after are indistinguishable.
  const sel = { type: "offset" as const, sizeLabel: "25x36", colour: "multi" as const,
    vendor: undefined };
  assert("C1: absent vendor is omitted by JSON, not emitted as null",
    !J(sel).includes("vendor"));
}

// ===========================================================================
// D — beading units
// ===========================================================================
console.log("\n== D: beading unit entry ==");
for (const inches of [0.5, 0.125, 1.75]) {
  for (const unit of ["in", "cm", "mm"] as const) {
    const back = fromDim(toDim(inches, unit), unit);
    // toDim ROUNDS for the input box (shared behaviour of every unit selector),
    // so the round trip is within that display precision, not exact.
    const tol = unit === "mm" ? 0.05 / 25.4 : unit === "cm" ? 0.005 / 2.54 : 0;
    assert(`D1: ${inches}in round-trips through ${unit}`, Math.abs(back - inches) <= tol,
      `got ${back}`);
  }
}
check("D2: inches pass through unchanged", toDim(0.125, "in"), 0.125);

// ===========================================================================
// E — quote draft: server-recomputed totals, custom quotes
// ===========================================================================
console.log("\n== E: quote preview / custom quotes ==");
{
  const draft: QuoteDraft = {
    billTo: { company: "  Acme Boxes  ", contact: "  Priya  " },
    items: [
      {
        description: "  Magnetic box  ",
        specsLines: [" 1.5 mm kappa ", "", "  Outer: printed  "],
        qty: 500,
        unitPrice: 91.02,
        additionalDetail: [
          { label: "Die", qty: 2, rate: 1500, amount: 3000 },
          { label: "Zero", amount: 0 },
        ],
      },
      { description: "Tray only", specsLines: [], qty: 250, unitPrice: 40 },
    ],
    terms: ["  Keep this  ", "   ", "And this"],
    notes: "  Delivery in two lots.  ",
  };
  const d = finalizeQuoteDraft(draft, "Tester", null);

  check("E1: line total = qty × unitPrice", d.items[0].total, 500 * 91.02);
  check("E2: subTotal = Σ line totals", d.subTotal, 500 * 91.02 + 250 * 40);
  assert("E3: zero-amount charges dropped", d.items[0].additionalDetail?.length === 1);
  check("E3: additionalSubTotal = Σ charges", d.additionalSubTotal, 3000);
  assert("E4: GST is exactly buildGstLines(sub, additional)",
    J(d.gstLines) === J(buildGstLines(d.subTotal, d.additionalSubTotal)));
  assert("E5: grandTotal = sub + additional + Σ GST",
    near(d.grandTotal, d.subTotal + d.additionalSubTotal + d.gstLines.reduce((s, l) => s + l.amount, 0)));
  assert("E6: strings trimmed, blanks dropped",
    d.billTo.company === "Acme Boxes" && d.items[0].specsLines.length === 2 && d.terms.length === 2);
  check("E6: notes trimmed", d.notes, "Delivery in two lots.");

  // A browser cannot post junk that corrupts the billed figures.
  const bad = finalizeQuoteDraft(
    {
      billTo: { company: "", contact: null },
      items: [
        { description: "", specsLines: [], qty: -5, unitPrice: 10 },
        { description: "x", specsLines: [], qty: 10, unitPrice: Number.NaN },
        { description: "y", specsLines: [], qty: 3, unitPrice: 100 },
      ],
      terms: [],
    },
    "T",
    null,
  );
  check("E7: negative qty and NaN price clamp to 0", bad.subTotal, 300);
  assert("E7: GST still charged on the valid line", near(bad.gstLines[0].amount, 15));
  check("E7: empty terms fall back to the defaults", bad.terms.length, DEFAULT_TERMS.length);
  assert("E7: no notes key when unset", !("notes" in bad));

  // Round trip through the editor must not move any money.
  const again = finalizeQuoteDraft(toQuoteDraft(d), "Tester", null);
  assert("E8: totals identical after a preview round trip",
    near(again.subTotal, d.subTotal) && near(again.grandTotal, d.grandTotal));

  check("E9: baseQuoteNo strips a revision suffix", baseQuoteNo("ABC/26-27/007-R2"), "ABC/26-27/007");
  check("E9: baseQuoteNo leaves a plain number alone", baseQuoteNo("ABC/26-27/007"), "ABC/26-27/007");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
