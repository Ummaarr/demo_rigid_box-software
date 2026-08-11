// Round-6 validation (client 15-Jul meeting): per-print-job offset charging +
// printed-layer tie consolidation, lid/sleeve fit allowance, sleeve-as-card-
// stock, itemized finishing, and the raw-materials PDF geometry.
// Run: npx tsx scripts/validate-round6.ts
//
// The invariants are the round's correctness contract:
//   - a sheet TIE on a printed layer consolidates into ONE plate (the client's
//     "doubled printing costs" case), while board and ungated calls stay
//     byte-identical to round 5;
//   - Σ layerPrintJobs === totalSheets, before and after wastage;
//   - the fit allowance grows ONLY the telescopic/shoulder lid + drawer
//     sleeve, keylines match blanks, other box types are immune;
//   - finishingDetail lines sum exactly to the kept finishing totals;
//   - the PDF geometry (rects/groups/purchases) reproduces the engine counts.

import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";

import {
  derivePaperPurchase,
  estimateBoardMaterial,
  estimateCardInsert,
  estimateMaterials,
  estimatePaperMaterial,
  outerPaperBlank,
  type Sheet,
} from "@/lib/engines/material";
import {
  estimateCost,
  layerPrintJobs,
  offsetCost,
  type CostRates,
} from "@/lib/engines/cost";
import {
  chooseBestPrinting,
  type PaperCandidate,
  type PrintCandidate,
} from "@/lib/estimate/auto-printing-core";
import { getBlanks } from "@/lib/formulas";
import { sleeveBlank } from "@/lib/formulas/sleeve";
import { FIT_ALLOWANCE_TYPES, fitAllowanceIn } from "@/lib/formulas/fit";
import {
  componentRects,
  groupRects,
  purchaseRects,
} from "@/lib/nesting/geometry";
import { keylinePanelBuilders } from "@/components/keylines";
import { buildMaterialsData } from "@/lib/pdf/materials-data";
import { MaterialsDocument } from "@/components/pdf/materials-document";
import type { EstimateDetail } from "@/lib/db/estimates";
import type { Blank, BoxType, BoxVariables, EstimateRequest } from "@/types";

let failures = 0;
function assert(label: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}
function check(label: string, got: number, want: number, tol = 1e-9) {
  assert(label, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------
console.log("\n== A: per-job offset charging + tie consolidation ==");

{
  // A1 — the client's case: two 10×30 wraps on a 20×30 sheet, qty 500.
  // Separate: 2/sheet each -> 250 + 250 = 500. Combined: 1+1/sheet -> 500. TIE.
  const blanks: Blank[] = [
    { component: "tray", width_in: 10, height_in: 30, count_per_box: 1 },
    { component: "case", width_in: 10, height_in: 30, count_per_box: 1 },
  ];
  const sheet: Sheet = { width_in: 20, height_in: 30 };
  const strict = estimateBoardMaterial(blanks, 500, sheet, {}, true, false, false);
  const tied = estimateBoardMaterial(blanks, 500, sheet, {}, true, false, true);
  assert("A1: strict-win rejects the tie (legacy)", strict.combination?.applied === false);
  assert("A1: consolidateTies accepts the tie", tied.combination?.applied === true);
  assert(
    "A1: combined == separate == 500 (one group, no singles)",
    tied.combination?.combinedSheets === 500 &&
      tied.combination?.separateSheets === 500 &&
      tied.combination?.groups.length === 1 &&
      tied.combination?.separateComponents.length === 0 &&
      tied.totalSheets === 500,
  );
  const plate = (jobs: number[]) => sum(jobs.map((j) => offsetCost(j, 2500, 800)));
  check("A1: tie -> one plate Rs 2,500", plate(layerPrintJobs(tied)), 2500);
  check("A1: no-tie -> two plates Rs 5,000", plate(layerPrintJobs(strict)), 5000);
  assert(
    "A1: sum(jobs) == totalSheets (both)",
    sum(layerPrintJobs(tied)) === tied.totalSheets &&
      sum(layerPrintJobs(strict)) === strict.totalSheets,
  );

  // A2 — ungated byte-identity (no consolidateTies arg == old behaviour).
  const legacy = estimateBoardMaterial(blanks, 500, sheet, {}, true);
  assert("A2: ungated call byte-identical", JSON.stringify(legacy) === JSON.stringify(strict));

  // A3 — strict wins unaffected by the flag (16×41 + 15×41 on 31×41).
  const b2: Blank[] = [
    { component: "a", width_in: 16, height_in: 41, count_per_box: 1 },
    { component: "b", width_in: 15, height_in: 41, count_per_box: 1 },
  ];
  const s2: Sheet = { width_in: 31, height_in: 41 };
  const off = estimateBoardMaterial(b2, 500, s2, {}, true, false, false);
  const on = estimateBoardMaterial(b2, 500, s2, {}, true, false, true);
  assert("A3: strict winner identical flag on/off", JSON.stringify(off) === JSON.stringify(on));
  assert(
    "A3: strict winner still applied with fewer sheets",
    on.combination?.applied === true && on.combination.combinedSheets < on.combination.separateSheets,
  );

  // A4 — tie + 10% wastage: group inflates once, Σ jobs still == total.
  const wetted = estimatePaperMaterial(blanks, 500, sheet, "inner", 0, {}, 10, true, false, true);
  assert(
    "A4: tie survives wastage (550 sheets, applied)",
    wetted.combination?.applied === true && wetted.totalSheets === 550,
  );
  assert("A4: post-wastage sum(jobs) == totalSheets", sum(layerPrintJobs(wetted)) === wetted.totalSheets);
  check("A4: still one plate <= 1000 sheets", plate(layerPrintJobs(wetted)), 2500);

  // A5 — honest partial combination: {tray+case} tie-group + a card cut alone
  // = 2 plates under per-job; legacy charged ONE tier on the layer total.
  // (Documents the intended price movement for unshared components.)
  const b3: Blank[] = [...blanks, { component: "card", width_in: 6, height_in: 5, count_per_box: 1 }];
  const part = estimateBoardMaterial(b3, 500, sheet, {}, true, false, true);
  assert(
    "A5: tray+case grouped, card alone",
    part.combination?.applied === true &&
      part.combination.groups.length === 1 &&
      part.combination.separateComponents.length === 1,
  );
  const jobs3 = layerPrintJobs(part);
  const perJobCost = sum(jobs3.map((j) => offsetCost(j, 2500, 800)));
  const legacyCost = offsetCost(part.totalSheets, 2500, 800);
  assert("A5: per-job charges 2 plates > legacy 1", jobs3.length === 2 && perJobCost > legacyCost, `${perJobCost} vs ${legacyCost}`);

  // A6/A7 — separate mode == Σ per-component tiers; digital invariant.
  const mkInput = (printingMode?: "combined" | "separate") => ({
    boxType: "telescopic" as BoxType,
    dims: { length_in: 8, width_in: 6, height_in: 3 },
    vars: { lidDepth_in: 1.5 },
    quantity: 500,
    board: { sheet: { width_in: 31, height_in: 41 } },
    outerPaper: { sheet: { width_in: 23, height_in: 36 }, foldingAllowance_mm: 20 },
    printingMode,
  });
  const costRates: CostRates = {
    boardCostPerSheet: 41,
    outerPaperCostPerSheet: 9,
    printing: { mode: "offset", first1000: 5000, additional1000: 1200 },
    accessories: { magnetEach: 0, washerEach: 0, tapePerUnit: 0.75 },
    labour: [],
    overheadPct: 11,
    marginPct: 20,
  };
  const matSep = estimateMaterials(mkInput("separate"));
  const costSep = estimateCost(matSep, { ...costRates, perJobPrinting: true });
  const expectSep = sum(matSep.outerPaper!.components.map((c) => offsetCost(c.sheetsNeeded, 5000, 1200)));
  check("A6: separate == Σ per-component tiers", costSep.printing, expectSep);
  const matComb = estimateMaterials(mkInput("combined"));
  const digRates: CostRates = { ...costRates, printing: { mode: "digital", costPerSheet: 20 } };
  const dOn = estimateCost(matComb, { ...digRates, perJobPrinting: true }).printing;
  const dOff = estimateCost(matComb, digRates).printing;
  assert("A7: digital indifferent to per-job flag", dOn === dOff && dOn === matComb.outerPaper!.totalSheets * 20);

  // A8 — auto evaluator == brute force over layerPrintJobs (per-job + ties on).
  const autoBlanks: Blank[] = [
    { component: "tray", width_in: 12.8, height_in: 4.1, count_per_box: 1 },
    { component: "case", width_in: 3, height_in: 23.2, count_per_box: 1 },
  ];
  const candidates: PrintCandidate[] = [
    { sizeLabel: "18x25", printSheet: { width_in: 18, height_in: 25 }, rate: { mode: "offset", first1000: 2800, additional1000: 800 } },
    { sizeLabel: "20x30", printSheet: { width_in: 20, height_in: 30 }, rate: { mode: "offset", first1000: 3500, additional1000: 1000 } },
    { sizeLabel: "25x36", printSheet: { width_in: 25, height_in: 36 }, rate: { mode: "offset", first1000: 5000, additional1000: 1200 } },
  ];
  const papers: PaperCandidate[] = [
    { sizeLabel: "23x36", sheet: { width_in: 23, height_in: 36 }, costPerSheet: 9 },
    { sizeLabel: "25x36", sheet: { width_in: 25, height_in: 36 }, costPerSheet: 10 },
  ];
  const win = chooseBestPrinting({
    blanks: autoBlanks,
    quantity: 1020,
    layer: "outer",
    allowance_mm: 20,
    wastagePct: 10,
    overrides: {},
    combine: true,
    mixed: true,
    perJobPrinting: true,
    consolidateTies: true,
    candidates,
    papers,
  });
  let bruteBest = Infinity;
  for (const c of candidates) {
    const est = estimatePaperMaterial(autoBlanks, 1020, c.printSheet, "outer", 20, {}, 10, true, true, true);
    if (!Number.isFinite(est.totalSheets)) continue;
    for (const p of papers) {
      const fits =
        (c.printSheet.width_in <= p.sheet.width_in && c.printSheet.height_in <= p.sheet.height_in) ||
        (c.printSheet.height_in <= p.sheet.width_in && c.printSheet.width_in <= p.sheet.height_in);
      if (!fits) continue;
      const rate = c.rate;
      const printCost =
        rate.mode === "offset"
          ? est.components.length <= 1
            ? offsetCost(est.totalSheets, rate.first1000, rate.additional1000)
            : sum(layerPrintJobs(est).map((j) => offsetCost(j, rate.first1000, rate.additional1000)))
          : 0;
      const purchase = derivePaperPurchase(c.printSheet, p.sheet, est.totalSheets);
      const total = printCost + purchase.sheetsToBuy * p.costPerSheet;
      if (total < bruteBest) bruteBest = total;
    }
  }
  check("A8: auto pick == per-job brute force", win.total, bruteBest);
}

// ---------------------------------------------------------------------------
console.log("\n== B: lid/sleeve fit allowance ==");

{
  const dims = { length_in: 10, width_in: 8, height_in: 4 };
  // Round 7 (client final doc item 4): growth per dimension = 2t + 1mm.
  const f = fitAllowanceIn("telescopic", 2)!;
  check("B0: f(2mm) = (2*2+1)/25.4 in", f, 5 / 25.4);
  assert("B0: no allowance for non-fit types", fitAllowanceIn("magnetic", 2) === undefined);
  assert("B0: zero/invalid thickness -> none", fitAllowanceIn("telescopic", 0) === undefined);
  assert(
    "B0: fit types = telescopic, shoulder, drawer, matchbox",
    ["telescopic", "shoulder", "drawer_sliding", "matchbox_sliding"].every((t) =>
      FIT_ALLOWANCE_TYPES.has(t as BoxType),
    ) && FIT_ALLOWANCE_TYPES.size === 4,
  );

  // B1 telescopic: lid exact, tray untouched.
  const tel = getBlanks("telescopic", dims, { lidDepth_in: 1.5, fitAllowance_in: f });
  const telLid = tel.find((b) => b.component === "lid")!;
  const telTray = tel.find((b) => b.component === "tray")!;
  assert(
    "B1: telescopic lid (D+(L+f)+D)×(D+(W+f)+D)",
    near(telLid.width_in, 1.5 + (10 + f) + 1.5) && near(telLid.height_in, 1.5 + (8 + f) + 1.5),
  );
  assert("B1: telescopic tray untouched", near(telTray.width_in, 18) && near(telTray.height_in, 16));

  // B2 shoulder: lid AND tray grow (item 4B); neck untouched.
  const shVars = { bottomHeight_in: 3, neckHeight_in: 1, lidDepth_in: 1.5 };
  const sh0 = getBlanks("shoulder", dims, shVars);
  const sh1 = getBlanks("shoulder", dims, { ...shVars, fitAllowance_in: f });
  const shPart = (bs: Blank[], c: string) => bs.find((b) => b.component === c)!;
  assert(
    "B2: shoulder lid AND tray grow by f",
    near(shPart(sh1, "lid").width_in, shPart(sh0, "lid").width_in + f) &&
      near(shPart(sh1, "lid").height_in, shPart(sh0, "lid").height_in + f) &&
      near(shPart(sh1, "tray").width_in, shPart(sh0, "tray").width_in + f) &&
      near(shPart(sh1, "tray").height_in, shPart(sh0, "tray").height_in + f),
  );
  assert(
    "B2: shoulder neck untouched",
    JSON.stringify(shPart(sh0, "neck")) === JSON.stringify(shPart(sh1, "neck")),
  );

  // B3 drawer: every sleeve L/W term grows (H terms deliberately not), tray untouched.
  const dr = getBlanks("drawer_sliding", dims, { fitAllowance_in: f });
  const drSleeve = dr.find((b) => b.component === "sleeve")!;
  assert(
    "B3: drawer sleeve ((W+f)+H)×((L+f)+H+(L+f)+H)",
    near(drSleeve.width_in, 8 + f + 4) && near(drSleeve.height_in, 2 * (10 + f) + 8),
  );
  assert(
    "B3: drawer tray untouched",
    near(dr.find((b) => b.component === "tray")!.width_in, 18),
  );

  // B3b matchbox (item 4A names it): sleeve grows, tray untouched.
  const mb = getBlanks("matchbox_sliding", dims, { fitAllowance_in: f });
  const mbSleeve = mb.find((b) => b.component === "sleeve")!;
  assert(
    "B3b: matchbox sleeve ((W+f)+H+(W+f)+H)×(L+f)",
    near(mbSleeve.width_in, 2 * (8 + f) + 8) && near(mbSleeve.height_in, 10 + f),
  );
  assert(
    "B3b: matchbox tray untouched",
    near(mb.find((b) => b.component === "tray")!.width_in, 18),
  );

  // B4 — the var is inert for every other box type.
  const all: { bt: BoxType; vars: BoxVariables }[] = [
    { bt: "magnetic", vars: { flapLength_in: 1, panels: 4 } },
    { bt: "hinge_lid", vars: { bottomHeight_in: 3, neckHeight_in: 1, lidDepth_in: 1.5 } },
    { bt: "collapsible_rigid", vars: { flapLength_in: 1 } },
    { bt: "double_decker", vars: { flapLength_in: 1, trayHeight1_in: 2, trayHeight2_in: 2 } },
    { bt: "tray_only", vars: {} },
  ];
  let immune = true;
  for (const { bt, vars } of all) {
    if (FIT_ALLOWANCE_TYPES.has(bt)) continue;
    if (
      JSON.stringify(getBlanks(bt, dims, vars)) !==
      JSON.stringify(getBlanks(bt, dims, { ...vars, fitAllowance_in: f }))
    ) {
      immune = false;
      assert(`B4: ${bt} immune to the var`, false);
    }
  }
  assert("B4: all non-fit box types immune to the var", immune);

  // B5 — crease-match invariant at f > 0: every blank has a keyline panel of
  // equal (or transposed) footprint, so fold lines still draw.
  const segLen = (segs: { length: number }[]) => segs.reduce((t, s) => t + s.length, 0);
  const cases: [BoxType, BoxVariables][] = [
    ["telescopic", { lidDepth_in: 1.5, fitAllowance_in: f }],
    ["shoulder", { ...shVars, fitAllowance_in: f }],
    ["drawer_sliding", { fitAllowance_in: f }],
    ["matchbox_sliding", { fitAllowance_in: f }],
  ];
  let matched = true;
  for (const [bt, vars] of cases) {
    const blanks = getBlanks(bt, dims, vars);
    const panels = keylinePanelBuilders[bt](dims, vars);
    for (const blank of blanks) {
      const hit = panels.some((p) => {
        const px = segLen(p.x);
        const py = segLen(p.y);
        return (
          (near(px, blank.width_in) && near(py, blank.height_in)) ||
          (near(px, blank.height_in) && near(py, blank.width_in))
        );
      });
      if (!hit) {
        matched = false;
        assert(`B5: ${bt} ${blank.component} panel matches blank`, false);
      }
    }
  }
  assert("B5: keyline panels match grown blanks (creases keep drawing)", matched);

  // B6 — absent var == round-5 outputs exactly (snapshot safety at engine level).
  const noVar = estimateMaterials({
    boxType: "telescopic",
    dims,
    vars: { lidDepth_in: 1.5 },
    quantity: 1000,
    board: { sheet: { width_in: 31, height_in: 41 } },
  });
  const trayBlank = noVar.blanks.find((b) => b.component === "lid")!;
  assert("B6: no var -> original lid blank", near(trayBlank.width_in, 13) && near(trayBlank.height_in, 11));

  // B7 — outer wrap derives from the GROWN lid: wrap blank = lid + 2×folding.
  const grow = 2 * (20 / 25.4);
  const wrapLid = outerPaperBlank(telLid, 20);
  assert(
    "B7: outer wrap blank == grown lid + folding each side",
    near(wrapLid.width_in, telLid.width_in + grow) && near(wrapLid.height_in, telLid.height_in + grow),
  );
}

// ---------------------------------------------------------------------------
console.log("\n== C: sleeve as card stock ==");

{
  // Blank still comes from the box type's own sleeve formula…
  const blank = sleeveBlank("matchbox_sliding", { length_in: 10, width_in: 8, height_in: 4 });
  check("C1: matchbox sleeve blank W+H+W+H", blank.width_in, 24);
  // …but is cut straight from card stock: keyline exact, no folding, no board.
  const est = estimateCardInsert([blank], 500, { sheet: { width_in: 25, height_in: 36 }, wastagePct: 10 });
  const per = Math.max(Math.floor(25 / 24) * Math.floor(36 / 10), Math.floor(25 / 10) * Math.floor(36 / 24));
  check("C2: sleeve stock sheets (10% wastage)", est.paper.totalSheets, Math.ceil(Math.ceil(500 / per) * 1.1));

  // Engine 2: one line = purchased sheets × rate (+ printing + finishing).
  const mat = estimateMaterials({
    boxType: "tray_only",
    dims: { length_in: 10, width_in: 8, height_in: 4 },
    quantity: 500,
    board: { sheet: { width_in: 31, height_in: 41 } },
    sleeve: { blank, stock: { sheet: { width_in: 25, height_in: 36 } } },
  });
  const cost = estimateCost(mat, {
    boardCostPerSheet: 41,
    sleeve: { paperCostPerSheet: 9 },
    accessories: { magnetEach: 0, washerEach: 0, tapePerUnit: 0.75 },
    labour: [],
    overheadPct: 11,
    marginPct: 20,
  });
  check("C3: sleeve line = stock sheets × rate", cost.sleeve, mat.sleeve!.paper.totalSheets * 9);
}

// ---------------------------------------------------------------------------
console.log("\n== D: itemized finishing ==");

{
  const mat = estimateMaterials({
    boxType: "tray_only",
    dims: { length_in: 10, width_in: 8, height_in: 4 },
    quantity: 500,
    board: { sheet: { width_in: 31, height_in: 41 } },
    outerPaper: { sheet: { width_in: 23, height_in: 36 }, foldingAllowance_mm: 20 },
  });
  const rates: CostRates = {
    boardCostPerSheet: 41,
    outerPaperCostPerSheet: 9,
    finishing: [
      { kind: "lamination", ratePer100sqin: 0.9, key: "matte" },
      { kind: "foiling", ratePerSqin: 0.05, designAreaSqIn: 12, key: "gold", finish: "matte" },
      { kind: "uv", rate: 0.05, unit: "per_sqin", designAreaSqIn: 6, key: "spot" },
    ],
    accessories: { magnetEach: 0, washerEach: 0, tapePerUnit: 0.75 },
    labour: [],
    overheadPct: 11,
    marginPct: 20,
  };
  const cost = estimateCost(mat, rates);
  assert("D1: three detail lines", cost.finishingDetail?.length === 3);
  check("D2: detail sums to the kept total", sum((cost.finishingDetail ?? []).map((l) => l.amount)), cost.finishing);
  assert(
    "D3: labels carry key + foil finish",
    cost.finishingDetail?.[0].label === "Lamination matte" &&
      cost.finishingDetail?.[1].label === "Foiling gold (matte)" &&
      cost.finishingDetail?.[2].label === "UV spot",
  );
  // Kind-only fallback (old snapshots' rates carry no key).
  const legacy = estimateCost(mat, {
    ...rates,
    finishing: [{ kind: "lamination", ratePer100sqin: 0.9 }],
  });
  assert("D4: keyless rate -> kind-only label", legacy.finishingDetail?.[0].label === "Lamination");
  assert("D5: no finishing -> no detail field", estimateCost(mat, { ...rates, finishing: undefined }).finishingDetail === undefined);
}

// ---------------------------------------------------------------------------
console.log("\n== E: raw-materials PDF geometry + render ==");

async function pdfChecks() {
  const mat = estimateMaterials({
    boxType: "telescopic",
    dims: { length_in: 10, width_in: 8, height_in: 4 },
    vars: { lidDepth_in: 1.5, fitAllowance_in: 2 / 25.4 },
    quantity: 1000,
    board: { sheet: { width_in: 31, height_in: 41 } },
    outerPaper: {
      sheet: { width_in: 25, height_in: 36 },
      printSheet: { width_in: 18, height_in: 25 },
      foldingAllowance_mm: 20,
      wastagePct: 10,
    },
    innerPaper: { sheet: { width_in: 23, height_in: 36 } },
    foams: [
      {
        insert: { length_in: 9, width_in: 7 },
        sheet: { width_in: 39.4, height_in: 78.8 },
        cover: {
          piecesPerBox: 2,
          sheet: { width_in: 23, height_in: 36 },
          printSheet: { width_in: 18, height_in: 25 },
          wastagePct: 10,
        },
        punchingMargin_mm: 10,
      },
    ],
    sleeve: {
      blank: { component: "sleeve", width_in: 24, height_in: 10, count_per_box: 1 },
      stock: { sheet: { width_in: 25, height_in: 36 } },
    },
    cardPartitions: {
      blanks: [
        { component: "partition_l", width_in: 8, height_in: 10, count_per_box: 2 },
        { component: "partition_w", width_in: 8, height_in: 8, count_per_box: 3 },
      ],
      stock: { sheet: { width_in: 25, height_in: 36 } },
    },
    window: {
      footprint: { length_in: 4, width_in: 6 },
      sheet: { width_in: 20, height_in: 30 },
      punchingMargin_mm: 10,
    },
    mixed: true,
    printingMode: "combined",
  });

  // Geometry reproduces the engine's counts, in-sheet, no overlaps.
  let geomOk = true;
  for (const layer of [mat.board, mat.outerPaper!, mat.innerPaper!]) {
    for (const c of layer.components) {
      const rects = componentRects(c);
      if (rects.length !== c.perSheet) geomOk = false;
      for (const r of rects) {
        if (
          r.x_in < -1e-9 ||
          r.y_in < -1e-9 ||
          r.x_in + r.w_in > layer.sheet.width_in + 1e-9 ||
          r.y_in + r.h_in > layer.sheet.height_in + 1e-9
        )
          geomOk = false;
      }
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          if (
            a.x_in < b.x_in + b.w_in - 1e-9 &&
            b.x_in < a.x_in + a.w_in - 1e-9 &&
            a.y_in < b.y_in + b.h_in - 1e-9 &&
            b.y_in < a.y_in + a.h_in - 1e-9
          )
            geomOk = false;
        }
      }
    }
    for (const g of layer.combination?.groups ?? []) {
      const want = g.shelves.reduce((s, sh) => s + sh.rows * sh.perRow, 0);
      if (groupRects(g).length !== want) geomOk = false;
    }
  }
  assert("E1: componentRects/groupRects reproduce engine counts, in-sheet, no overlap", geomOk);
  if (mat.outerPaperPurchase) {
    assert(
      "E2: purchaseRects == printsPerSheet",
      purchaseRects(mat.outerPaperPurchase).length === mat.outerPaperPurchase.printsPerSheet,
    );
  }

  const est = {
    id: "12345678-abcd-efab-cdef-1234567890ab",
    box_type: "telescopic",
    name: "Round-6 validation",
    status: "draft",
    quantity: 1000,
    price_per_box: 91.02,
    total_price: 91020,
    created_at: new Date().toISOString(),
    client_name: "Acme Luxury Packaging",
    created_by_name: "Admin User",
    specs_snapshot: {
      boxType: "telescopic",
      dims: { length_in: 10, width_in: 8, height_in: 4 },
      vars: { lidDepth_in: 1.5, fitAllowance_in: 2 / 25.4 },
      quantity: 1000,
      boardThickness_mm: 2,
    } satisfies EstimateRequest,
    rates_snapshot: {},
    cost_breakdown: null,
  } as unknown as EstimateDetail;

  const data = buildMaterialsData(est, mat);
  // New round-7 shape: header + items[] following the client's output-sheet
  // template. Keylines are an item; material blocks carry the diagrams.
  const kl = data.items.find((i) => i.kind === "keylines");
  assert(
    "E3b: a keyline per component, with fold lines (round-7 item 10)",
    kl?.kind === "keylines" &&
      kl.keylines.length === mat.blanks.length &&
      kl.keylines.some((k) => k.creases.length > 0),
    kl?.kind === "keylines" ? kl.keylines.map((k) => `${k.component} (${k.creases.length} folds)`).join(" | ") : "no keylines item",
  );
  const headings = data.items.filter((i) => i.kind === "heading").map((i) => (i.kind === "heading" ? i.text : ""));
  const blockHeadings = data.items.flatMap((i) =>
    i.kind === "block"
      ? [i.block.heading]
      : i.kind === "componentWrap"
        ? [i.outer?.heading, i.inner?.heading].filter((x): x is string => !!x)
        : [],
  );
  assert(
    "E3: sheet covers board, wrapping and additions with material blocks",
    ["Kappa board", "Wrapping", "Additions"].every((t) => headings.includes(t)) &&
      blockHeadings.some((h) => h === "Board") &&
      blockHeadings.some((h) => /printing|paper/i.test(h)) &&
      data.items.some((i) => i.kind === "componentWrap"),
    `headings: ${headings.join(", ")} | blocks: ${blockHeadings.join(", ")}`,
  );
  // No cost leakage: the word "cost"/"price"/rupee must not appear anywhere.
  assert("E4: no cost-like strings in the data", !/₹|Rs\.|price|cost/i.test(JSON.stringify(data)));

  const pdf = await renderToBuffer(
    createElement(MaterialsDocument, { data }) as unknown as Parameters<typeof renderToBuffer>[0],
  );
  assert("E5: renders a valid, non-trivial PDF", pdf.subarray(0, 5).toString("latin1") === "%PDF-" && pdf.length > 10_000, `${(pdf.length / 1024).toFixed(1)} KB`);
  const latin = pdf.toString("latin1");
  assert("E6: no rupee amounts in PDF bytes", !latin.includes("₹") && !/Rs\.\s*\d/.test(latin));
}

pdfChecks().then(() => {
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
});
