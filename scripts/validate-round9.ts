// Round 9 (client 28-Jul): one-time charges — included in the box price, or
// quoted as their own line.
//   "the engine accounts for one-time charges in the total price of each box.
//    I need the one-time charges to be separate, and not be divided into each
//    box cost — let's make this a toggle."
//
// Asserts: the per-box divide follows the toggle while `total` never moves;
// the quote layer follows the same choice (unit price + the 5%/18% GST split);
// and an estimate saved before the toggle existed is byte-identical.
//
// Run:  NODE_OPTIONS="--conditions=react-server" npx tsx scripts/validate-round9.ts
// (react-server condition: quotation-data imports `server-only`.)

import { estimateMaterials } from "@/lib/engines/material";
import { estimateCost, type CostBreakdown, type CostRates } from "@/lib/engines/cost";
import { buildCostView } from "@/lib/estimate/cost-view";
import { buildGstLines, splitEstimateTotals } from "@/lib/pdf/quotation-data";
import type { EstimateRequest } from "@/types";
// See validate-round7: assert the shape, not the currency glyph.
import { BRAND } from "@/lib/brand";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok =
    typeof got === "number" && typeof want === "number"
      ? Math.abs(got - want) <= 1e-6
      : JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`,
  );
}
function assert(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : ` — ${extra}`}`);
}
const r2 = (n: number) => Math.round(n * 100) / 100;

const QTY = 500;
const mat = estimateMaterials({
  boxType: "tray_only",
  dims: { length_in: 10, width_in: 8, height_in: 4 },
  quantity: QTY,
  board: { sheet: { width_in: 31, height_in: 41 } },
});

// Die 2 x 1500 + Designer 500 = 3500 of one-time charges on a 500-box order,
// i.e. exactly 7.00 per box if amortised.
const CHARGES = { die: 3000, mould: 0, block: 0, designer: 500 };
const CHARGE_TOTAL = 3500;

const base: CostRates = {
  boardCostPerSheet: 41,
  accessories: { magnetEach: 0, washerEach: 0, tapePerUnit: 0.75 },
  labour: [{ role: "Cutting", unit: "day", rate: 1560, quantity: 2 }],
  overheadPct: 11,
  marginPct: 20,
  orderedQuantity: QTY,
  additional: CHARGES,
};

const legacy = estimateCost(mat, base); // no mode — pre-28-Jul
const included = estimateCost(mat, { ...base, additionalMode: "included" });
const separate = estimateCost(mat, { ...base, additionalMode: "separate" });

console.log("\n== included == the pre-28-Jul behaviour ==");
{
  check("total unchanged", included.total, legacy.total);
  check("price per box unchanged", included.pricePerBox, legacy.pricePerBox);
  check("price per box = total / ordered", included.pricePerBox, legacy.total / QTY);
  check("mode echoed onto the breakdown", included.additionalMode, "included");
}

console.log("\n== separate: charges leave the per-box price, total holds ==");
{
  check("total identical to included", separate.total, included.total);
  check(
    "total is still boxes + charges",
    r2(separate.total),
    r2(separate.subtotalAfterMargin + CHARGE_TOTAL),
  );
  check(
    "price per box = box subtotal / ordered",
    separate.pricePerBox,
    separate.subtotalAfterMargin / QTY,
  );
  check(
    "per-box delta is exactly the amortised charge",
    r2(included.pricePerBox - separate.pricePerBox),
    r2(CHARGE_TOTAL / QTY), // 7.00
  );
  check("charges still reported in full", separate.additional.total, CHARGE_TOTAL);
  check("mode echoed onto the breakdown", separate.additionalMode, "separate");

  // Everything upstream of the divide must be untouched — this is a pricing
  // presentation change, not a costing change.
  const strip = (c: CostBreakdown) => {
    const { pricePerBox: _p, additionalMode: _m, ...rest } = c;
    return rest;
  };
  assert(
    "only pricePerBox differs between the two modes",
    JSON.stringify(strip(included)) === JSON.stringify(strip(separate)),
  );
}

console.log("\n== immunity: no mode = byte-identical to before ==");
{
  assert(
    "absent mode identical to explicit undefined",
    JSON.stringify(legacy) === JSON.stringify(estimateCost(mat, { ...base, additionalMode: undefined })),
  );
  assert("additionalMode key omitted when unset", !("additionalMode" in legacy));
  // With nothing to separate, the toggle must be a no-op on every number.
  const noCharges = estimateCost(mat, { ...base, additional: undefined });
  const noChargesSep = estimateCost(mat, {
    ...base,
    additional: undefined,
    additionalMode: "separate",
  });
  check(
    "no charges: same price per box under either mode",
    noChargesSep.pricePerBox,
    noCharges.pricePerBox,
  );
  check("no charges: same total", noChargesSep.total, noCharges.total);
}

console.log("\n== quote: splitEstimateTotals follows the mode ==");
{
  // The round-3 fixture (45510 boxes + 3500 charges = 49010), replayed under
  // each mode. Its numbers must not move for absent/separate.
  const fixture = (mode?: "included" | "separate") =>
    ({
      cost_breakdown: {
        subtotalAfterMargin: 45510,
        additional: { die: 3000, mould: 0, block: 0, designer: 500, total: 3500 },
        ...(mode ? { additionalMode: mode } : {}),
        total: 49010,
      } as unknown as CostBreakdown,
      total_price: 49010,
    });

  check("legacy split unchanged", splitEstimateTotals(fixture()), {
    boxSubtotal: 45510,
    additionalTotal: 3500,
  });
  check("separate splits them out", splitEstimateTotals(fixture("separate")), {
    boxSubtotal: 45510,
    additionalTotal: 3500,
  });
  check("included folds them into the box subtotal", splitEstimateTotals(fixture("included")), {
    boxSubtotal: 49010,
    additionalTotal: 0,
  });
  const inc = splitEstimateTotals(fixture("included"));
  check("no money lost either way", inc.boxSubtotal + inc.additionalTotal, 49010);

  // Staff-stripped / very old rows have no subtotalAfterMargin: the fallback
  // (total_price − charges) must respect the mode too.
  const stripped = {
    cost_breakdown: {
      additional: { die: 3000, mould: 0, block: 0, designer: 500, total: 3500 },
      additionalMode: "included",
      total: 49010,
    } as unknown as CostBreakdown,
    total_price: 49010,
  };
  check("included fallback (no subtotalAfterMargin)", splitEstimateTotals(stripped), {
    boxSubtotal: 49010,
    additionalTotal: 0,
  });
}

console.log("\n== quote and estimate agree on the unit price ==");
{
  // What toQuoteItem does: unitPrice = boxSubtotal / quantity. Under both
  // explicit modes that must equal the engine's own pricePerBox — the
  // pre-round-9 mismatch (estimate amortised, quote did not) is what this fixes.
  for (const [mode, cost] of [
    ["included", included],
    ["separate", separate],
  ] as const) {
    const { boxSubtotal } = splitEstimateTotals({
      cost_breakdown: cost,
      total_price: cost.total,
    });
    check(`${mode}: quote unit price == cost.pricePerBox`, boxSubtotal / QTY, cost.pricePerBox);
  }
}

console.log("\n== GST: 5% boxes / 18% one-time ==");
{
  const sep = buildGstLines(45510, 3500);
  check("separate emits both lines", sep.length, 2);
  check("5% on the boxes", sep[0], {
    label: "GST @ 5% (boxes)",
    pct: 5,
    base: 45510,
    amount: 2275.5,
  });
  check("18% on the charges", sep[1], {
    label: "GST @ 18% (additional charges)",
    pct: 18,
    base: 3500,
    amount: 630,
  });

  const inc = buildGstLines(49010, 0);
  check("included emits one line", inc.length, 1);
  check("whole amount taxed as a box supply", inc[0].base, 49010);
  check("at 5%", inc[0].amount, 2450.5);

  // The two modes bill different tax — that is the deliberate consequence of
  // the toggle, not a rounding artefact.
  const sepGrand = 45510 + 3500 + sep.reduce((s, l) => s + l.amount, 0);
  const incGrand = 49010 + 0 + inc.reduce((s, l) => s + l.amount, 0);
  check("separate grand total", r2(sepGrand), 51915.5);
  check("included grand total", r2(incGrand), 51460.5);
  assert("included is the cheaper GST treatment here", incGrand < sepGrand);
}

console.log("\n== cost view: no per-box share on a separately-billed charge ==");
{
  const specs = {
    boxType: "tray_only",
    dims: { length_in: 10, width_in: 8, height_in: 4 },
    quantity: QTY,
    board: { thickness_mm: 1.5, sheetSizeLabel: "31x41" },
    additional: { die: { qty: 2, rate: 1500 }, designer: 500 },
  } as unknown as EstimateRequest;

  const sepView = buildCostView({ ...specs, additionalMode: "separate" }, separate, mat);
  const sepSection = sepView.find((s) => s.title.startsWith("One-time charges"))!;
  assert("separate section titled as billed separately", sepSection != null);
  assert(
    "no per-box figure on any charge row",
    sepSection.rows.every((r) => r.perBox === undefined),
    JSON.stringify(sepSection.rows),
  );
  check("charge rows still itemized", sepSection.rows.map((r) => r.label), ["Die", "Designer"]);
  check("die row keeps qty x rate detail", sepSection.rows[0].detail, `2 × ${BRAND.currencySymbol}1500`);

  const incView = buildCostView({ ...specs, additionalMode: "included" }, included, mat);
  const incSection = incView.find((s) => s.title.startsWith("Additional charges"))!;
  assert("included section present", incSection != null);
  check("die amortised per box", incSection.rows[0].perBox, 3000 / QTY);
  check("designer amortised per box", incSection.rows[1].perBox, 500 / QTY);

  // Legacy snapshots (no mode) keep the amortised figure they were quoted with.
  const legacyView = buildCostView(specs, legacy, mat);
  const legacySection = legacyView.find((s) => s.title.startsWith("Additional charges"))!;
  check("legacy rows keep their per-box share", legacySection.rows[0].perBox, 3000 / QTY);

  // Every other row is unaffected by the mode.
  const otherRows = sepView.filter((s) => s !== sepSection).flatMap((s) => s.rows);
  assert(
    "all non-charge rows still carry a per-box figure",
    otherRows.every((r) => r.perBox != null),
  );
}

console.log("\n== round-8 interaction: manual edits still recalculate ==");
{
  const bump = 1000;
  const edited = (mode: "included" | "separate") =>
    estimateCost(mat, {
      ...base,
      additionalMode: mode,
      adjustments: [{ line: "board", to: mat.board.totalSheets * 41 + bump }],
    });
  const ei = edited("included");
  const es = edited("separate");

  // Overhead (11%) then margin (20%) compound on the edit in both modes.
  check("included: total moves by edit x 1.332", r2(ei.total - included.total), r2(bump * 1.11 * 1.2));
  check("separate: total moves by edit x 1.332", r2(es.total - separate.total), r2(bump * 1.11 * 1.2));
  check("separate per box excludes the charges after an edit", es.pricePerBox, es.subtotalAfterMargin / QTY);
  check(
    "the mode never changes the edited cost, only the divide",
    r2(ei.total),
    r2(es.total),
  );
}

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
