// Round-3 validation (2026-07-11): FY quote numbering, the quote-totals
// double-count fix, itemized ChargeLine helpers, the tray_only box type,
// foam punching margin, and the misc add-on cost line.
//
// Run:  NODE_OPTIONS="--conditions=react-server" npx tsx scripts/validate-round3.ts
// (react-server condition: quotation-data imports `server-only`.)

import { estimateMaterials, estimateFoam } from "@/lib/engines/material";
import { estimateCost, type CostRates } from "@/lib/engines/cost";
import { getBlanks } from "@/lib/formulas";
import { chargeDetail, chargeTotal } from "@/lib/estimate/charges";
import {
  fallbackQuoteNo,
  formatQuoteNo,
  QUOTE_PREFIX,
  fyLabel,
  specsLines,
  splitEstimateTotals,
} from "@/lib/pdf/quotation-data";
import type { EstimateRequest } from "@/types";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok =
    typeof got === "number" && typeof want === "number"
      ? Math.abs(got - want) <= 1e-6
      : got === want;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}${ok ? "" : `, want ${JSON.stringify(want)}`}`);
  if (!ok) failures++;
}

// --- 1. FY label + quote number ---------------------------------------------
console.log("\n1. FY quote numbering (Indian FY Apr–Mar)");
check("Jul 2026 -> 26-27", fyLabel(new Date(2026, 6, 10)), "26-27");
check("Mar 2027 -> 26-27 (before Apr)", fyLabel(new Date(2027, 2, 31)), "26-27");
check("Apr 2027 -> 27-28 (FY rollover)", fyLabel(new Date(2027, 3, 1)), "27-28");
check("Jan 2030 -> 29-30", fyLabel(new Date(2030, 0, 15)), "29-30");
// Asserted against QUOTE_PREFIX rather than a literal: the prefix comes from
// lib/brand.ts, so a rebrand (or a demo checkout) changes it and these would
// otherwise fail for the wrong reason. The SHAPE is what's under test.
const P = QUOTE_PREFIX;
check(`format 1 -> ${P}/26-27/001`, formatQuoteNo("26-27", 1), `${P}/26-27/001`);
check(`format 42 -> ${P}/26-27/042`, formatQuoteNo("26-27", 42), `${P}/26-27/042`);
check(`format 1234 -> ${P}/26-27/1234`, formatQuoteNo("26-27", 1234), `${P}/26-27/1234`);
check("fallback keeps old shape", fallbackQuoteNo("abcde123-4567", 2026), `${P}/2026/ABCDE`);

// --- 2. ChargeLine helpers (legacy number vs qty×rate) -----------------------
console.log("\n2. ChargeLine helpers");
check("legacy flat total", chargeTotal(3000), 3000);
check("qty × rate", chargeTotal({ qty: 2, rate: 1500 }), 3000);
check("absent -> 0", chargeTotal(undefined), 0);
const detNew = chargeDetail("Die", { qty: 2, rate: 1500 });
check("detail qty", detNew?.qty, 2);
check("detail amount", detNew?.amount, 3000);
const detLegacy = chargeDetail("Die", 3000);
check("legacy detail has no qty", detLegacy?.qty, undefined);
check("legacy detail amount", detLegacy?.amount, 3000);
check("zero line -> null", chargeDetail("Die", 0), null);

// --- 3. Quote totals split (the double-count fix) ----------------------------
console.log("\n3. Quote totals split (double-count fix)");
// A cost breakdown where subtotalAfterMargin=45510 and additional=3500 ->
// total_price 49010. The OLD code produced boxSubtotal 49010 + additional 3500
// = 52510 (double count). The fix must return 45510 / 3500.
const fakeCost = {
  subtotalAfterMargin: 45510,
  additional: { die: 3000, mould: 0, block: 0, designer: 500, total: 3500 },
  total: 49010,
} as unknown as Parameters<typeof splitEstimateTotals>[0]["cost_breakdown"];
const split = splitEstimateTotals({ cost_breakdown: fakeCost, total_price: 49010 });
check("box subtotal excludes additional", split.boxSubtotal, 45510);
check("additional total", split.additionalTotal, 3500);
check("no double count", split.boxSubtotal + split.additionalTotal, 49010);
// Legacy row without subtotalAfterMargin (staff-stripped or very old): derive
// from total_price − additional.
const legacyCost = {
  additional: { die: 3000, mould: 0, block: 0, designer: 500, total: 3500 },
  total: 49010,
} as unknown as Parameters<typeof splitEstimateTotals>[0]["cost_breakdown"];
const legacySplit = splitEstimateTotals({ cost_breakdown: legacyCost, total_price: 49010 });
check("legacy fallback box subtotal", legacySplit.boxSubtotal, 45510);

// --- 4. tray_only box type ----------------------------------------------------
console.log("\n4. tray_only box type");
const trayBlanks = getBlanks("tray_only", { length_in: 10, width_in: 8, height_in: 4 });
check("one component", trayBlanks.length, 1);
check("tray width  (H+L+H)", trayBlanks[0].width_in, 18);
check("tray height (H+W+H)", trayBlanks[0].height_in, 16);
const trayMat = estimateMaterials({
  boxType: "tray_only",
  dims: { length_in: 10, width_in: 8, height_in: 4 },
  quantity: 500,
  board: { sheet: { width_in: 31, height_in: 41 } },
});
// 31x41 sheet, blank 18x16: A: floor(31/18)*floor(41/16)=1*2=2; B: floor(31/16)*floor(41/18)=1*2=2 -> 2/sheet, 250 sheets.
check("boxes per sheet", trayMat.board.components[0].perSheet, 2);
check("sheets needed", trayMat.board.totalSheets, 250);
check("tape auto-applies to the tray", trayMat.accessories.tape, 500);
check("no magnets", trayMat.accessories.magnets, 0);
check("no ribbon tag", trayMat.accessories.ribbonTag, 0);

// --- 5. Foam punching margin ---------------------------------------------------
console.log("\n5. Foam punching margin");
// 40x60 sheet, 10x8 piece: floor(40/10)*floor(60/8)=4*7=28 vs floor(40/8)*floor(60/10)=5*6=30 -> 30/sheet.
const foamNoMargin = estimateFoam({ length_in: 10, width_in: 8 }, { width_in: 40, height_in: 60 }, 500);
check("no margin: pieces/sheet", foamNoMargin.piecesPerSheet, 30);
check("no margin: nestedBlank = footprint", foamNoMargin.nestedBlank.length_in, 10);
// 12.7mm margin = 0.5in per side -> piece 11x9: floor(40/11)*floor(60/9)=3*6=18 vs floor(40/9)*floor(60/11)=4*5=20 -> 20/sheet.
const foamMargin = estimateFoam({ length_in: 10, width_in: 8 }, { width_in: 40, height_in: 60 }, 500, undefined, undefined, 12.7);
check("12.7mm margin: nested piece L", foamMargin.nestedBlank.length_in, 11);
check("12.7mm margin: pieces/sheet", foamMargin.piecesPerSheet, 20);
check("12.7mm margin: sheets", foamMargin.sheetsNeeded, 25);
check("margin never shrinks output", foamMargin.sheetsNeeded >= foamNoMargin.sheetsNeeded, true);

// --- 6. Misc add-on cost line ---------------------------------------------------
console.log("\n6. Misc add-on cost line");
const mat = estimateMaterials({
  boxType: "tray_only",
  dims: { length_in: 10, width_in: 8, height_in: 4 },
  quantity: 500,
  board: { sheet: { width_in: 31, height_in: 41 } },
});
const baseRates: CostRates = {
  boardCostPerSheet: 33.75,
  accessories: { magnetEach: 0, washerEach: 0, tapePerUnit: 0.75 },
  labour: [],
  overheadPct: 11,
  marginPct: 20,
};
const noMisc = estimateCost(mat, baseRates);
const withMisc = estimateCost(mat, {
  ...baseRates,
  addonsMisc: [
    { label: "Sleeve", amount: 500 * 6 },   // 500 units × ₹6
    { label: "Satin cloth", amount: 2 * 40 }, // 2 m × ₹40
  ],
});
check("misc line total", withMisc.addonsMisc, 3080);
check("misc flows into materials subtotal", withMisc.materialSubtotal - noMisc.materialSubtotal, 3080);
// Level-1 RM line: overhead + margin apply on top of it.
const expectedDelta = 3080 * 1.11 * 1.2;
check("misc carries overhead+margin", withMisc.subtotalAfterMargin - noMisc.subtotalAfterMargin, expectedDelta);
check("absent misc = zero line", noMisc.addonsMisc, 0);

// --- 7. Structured PDF spec lines ---------------------------------------------
console.log("\n7. specsLines structure");
const specs: EstimateRequest = {
  boxType: "magnetic",
  dims: { length_in: 12, width_in: 8.125, height_in: 3 },
  quantity: 500,
  boardThickness_mm: 2.5,
  wrapping: {
    outer: {
      mode: "printed",
      paperSizeLabel: "25x36",
      gsm: 157,
      printing: { type: "offset", sizeLabel: "18x25", colour: "single" },
    },
    inner: { mode: "white", paperSizeLabel: "23x36", gsm: 120 },
  },
  finishing: [
    { kind: "lamination", key: "matte" },
    { kind: "foiling", key: "gold", finish: "matte" },
  ],
  inserts: {
    foams: [{ type: "XLPE", thickness_mm: 20, insert: { length_in: 10, width_in: 7 }, punchingMargin_mm: 5 }],
  },
  addons: { misc: [{ label: "Sleeve", units: 500, pricePerUnit: 6 }] },
  additional: { die: { qty: 2, rate: 1500 }, designer: 500 },
};
const lines = specsLines(specs);
console.log("    " + lines.join("\n    "));
check("line 1 has 2dp dims", lines[0].includes("12 × 8.13 × 3 in"), true);
check("line 1 has board", lines[0].includes("2.5 mm kappa board"), true);
check("outer has single-colour", lines[1].includes("single-colour offset print (18x25)"), true);
check("outer has foil finish", lines[1].includes("foiling gold (matte)"), true);
check("inner white line", lines[2], "Inner: white paper 120 GSM");
check("inserts include foam", lines[3].includes("XLPE foam 20 mm"), true);
check("inserts include sleeve", lines[3].includes("Sleeve"), true);

// --- Result -------------------------------------------------------------------
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
