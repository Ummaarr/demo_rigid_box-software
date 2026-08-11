// Raw-materials output sheet data builder (round 6, restructured round 7 to
// the client's own template — "Raw material output sheet", shared 21-Jul).
//
// PURE data shaping: it reads ONLY the estimate row's meta + specs_snapshot +
// the recomputed MaterialQuantities, so it is structurally incapable of leaking
// a cost — no CostBreakdown, no rates, no price fields ever enter this module.
// (One-time investments show a QUANTITY of dies/moulds/blocks, never a rupee.)
//
// Layout follows her template: a header (JO/SS/dims), the Kappa board block,
// Wrapping organised BY COMPONENT (each with Outer + Inner + Finishing), then
// Additions (foam / reverse board / accessory counts / consumables / one-time).
// Every material block is two-column: details on the left, the nesting diagram
// on the right. Geometry comes from lib/nesting/geometry.ts — the same module
// the browser diagrams draw from — so the sheet matches the app exactly.

import { printJobFor, printTierSheets, wrapGroupsOf } from "@/lib/engines/material";
import { productionQuantity } from "@/lib/estimate/auto-printing-core";
import type {
  BlankMaterialResult,
  CardInsertEstimate,
  FoamEstimate,
  MaterialEstimate,
  MaterialQuantities,
  MixedLayout,
  PaperPurchase,
  Sheet,
  WrapGroupEstimate,
} from "@/lib/engines/material";
import type { EstimateDetail } from "@/lib/db/estimates";
import type {
  ChargeLine,
  EstimateRequest,
  FinishingSelection,
  InnerWrap,
  OuterWrap,
} from "@/types";
import {
  componentRects,
  creasesForBlank,
  diagramScale,
  fmtIn,
  groupRects,
  orientedBlank,
  pieceGrid,
  pieceRects,
  type Creases,
  type DiagramRect,
} from "@/lib/nesting/geometry";
import {
  keylinePanelBuilders,
  reverseBoardPanels,
  type KeylinePanelData,
} from "@/components/keylines";
import { specsLines, COMPANY } from "@/lib/pdf/quote-shared";
import { boxLabel } from "@/lib/box-types";

const NAVY = "#1F2A5C";
const GOLD = "#C6A24C";
const COMBO_PALETTE = [NAVY, GOLD, "#4F7942", "#A0522D"];

// --- primitive shapes the document renders ---------------------------------

export interface PdfRect {
  x_in: number;
  y_in: number;
  w_in: number;
  h_in: number;
  colour: string;
  fillOpacity: number;
}
export interface PdfCrease {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  colour: string;
}
export interface PdfDiagram {
  caption: string;
  sheetW_in: number;
  sheetH_in: number;
  rects: PdfRect[];
  creases: PdfCrease[];
  legend?: { label: string; colour: string }[];
}

/** A flat keyline (blank + fold lines) for one component. */
export interface PdfKeyline {
  component: string;
  size: string;
  blankW_in: number;
  blankH_in: number;
  creases: PdfCrease[];
}

/** One finishing pass in the finishing table. */
export interface FinishingLine {
  label: string; // "Lamination" / "Foiling" / "UV" / "Relief (emboss/deboss)"
  type: string; // the chosen type/colour
  area?: string; // "L × W in" for per-area finishes
}

/** A two-column material block: labelled detail lines + a nesting diagram. */
export interface MaterialBlock {
  heading: string; // "Special paper" / "Printed paper" / "Foam" / …
  lines: { label?: string; value: string }[];
  total?: string; // "210 + 22 wastage = 232 sheets (buy 232)"
  diagrams: PdfDiagram[];
  finishing?: FinishingLine[];
  note?: string;
}

/** One list row (add-ons / consumables). `imageRef` names a rate-card photo
 *  the API route resolves into `image` (a data URI) before rendering — the pure
 *  builder never touches storage. */
export interface ListRow {
  label: string;
  value: string;
  imageRef?: { table: string; column: string; value: string };
  image?: string;
}

/** One document item — headings, material blocks, keylines or a counts list. */
export type OutputItem =
  | { kind: "heading"; text: string }
  | { kind: "block"; block: MaterialBlock }
  | { kind: "componentWrap"; component: string; outer?: MaterialBlock; inner?: MaterialBlock }
  | { kind: "keylines"; keylines: PdfKeyline[] }
  | { kind: "list"; heading: string; rows: ListRow[] };

export interface MaterialsData {
  company: typeof COMPANY;
  title: string;
  header: { label: string; value: string }[];
  /** Structured board + dims spec lines (kept from specsLines). */
  specLines: string[];
  items: OutputItem[];
}

// --- helpers ---------------------------------------------------------------

const pretty = (s: string) => s.replace(/_/g, " ");
const sheetDims = (s: Sheet) => `${fmtIn(s.width_in)} × ${fmtIn(s.height_in)} in`;

/** "210 + 22 wastage = 232 sheets" (client: "actual number + wastage allowance"). */
function sheetsTotal(est: MaterialEstimate, purchase?: PaperPurchase): string {
  const total = est.totalSheets;
  if (!Number.isFinite(total)) return "—";
  const base = est.preWastageSheets;
  const waste = base != null && base < total ? total - base : 0;
  let s =
    waste > 0
      ? `${base} + ${waste} wastage = ${total} sheets`
      : `${total} sheet${total === 1 ? "" : "s"}`;
  if (purchase) s += ` (buy ${purchase.sheetsToBuy})`;
  return s;
}

/** Crease segments over a rect list (same skip rule as the browser). */
function creaseSegs(
  rects: DiagramRect[],
  panels: KeylinePanelData[] | undefined,
  sheet: Sheet,
  colourOf: (r: DiagramRect) => string,
): PdfCrease[] {
  if (!panels?.length) return [];
  const scale = diagramScale(sheet.width_in, sheet.height_in);
  const segs: PdfCrease[] = [];
  const cache = new Map<string, Creases | null>();
  for (const r of rects) {
    if (r.w_in * scale < 12 || r.h_in * scale < 12) continue;
    const key = `${r.w_in}x${r.h_in}`;
    if (!cache.has(key)) cache.set(key, creasesForBlank(panels, r.w_in, r.h_in));
    const c = cache.get(key);
    if (!c) continue;
    const colour = colourOf(r);
    for (const f of c.xFolds) segs.push({ x1: r.x_in + f, y1: r.y_in, x2: r.x_in + f, y2: r.y_in + r.h_in, colour });
    for (const f of c.yFolds) segs.push({ x1: r.x_in, y1: r.y_in + f, x2: r.x_in + r.w_in, y2: r.y_in + f, colour });
  }
  return segs;
}

function componentDiagram(
  est: MaterialEstimate,
  c: BlankMaterialResult,
  panels: KeylinePanelData[] | undefined,
  omitTotal = false,
): PdfDiagram {
  const rects = componentRects(c);
  const g = orientedBlank(c);
  const rotated = rects.filter((r) => r.rotated).length;
  const layout = c.mixed
    ? `${c.perSheet}/sheet${rotated > 0 ? ` (${rotated} rotated)` : ""}`
    : `${g.across}×${g.down} = ${c.perSheet}/sheet`;
  // In a shared group the authoritative sheet count is the group total (shown
  // in the block), so the per-component diagram drops its cut-alone count.
  const tail = omitTotal ? "" : ` · ${c.sheetsNeeded} sheets`;
  return {
    caption: `${pretty(c.component)}: sheet ${sheetDims(est.sheet)} · cut ${fmtIn(g.w_in)} × ${fmtIn(g.h_in)} in · ${layout}${tail}`,
    sheetW_in: est.sheet.width_in,
    sheetH_in: est.sheet.height_in,
    rects: rects.map((r) => ({ x_in: r.x_in, y_in: r.y_in, w_in: r.w_in, h_in: r.h_in, colour: GOLD, fillOpacity: r.rotated ? 0.5 : 0.22 })),
    creases: c.mixed ? [] : creaseSegs(rects, panels, est.sheet, () => NAVY),
  };
}

/** Nesting diagrams for a board/paper estimate: combined-sheet layout when it
 *  applied, else one grid per component. */
function estimateDiagrams(
  est: MaterialEstimate,
  panels: KeylinePanelData[] | undefined,
  purchase?: PaperPurchase,
): PdfDiagram[] {
  const diagrams: PdfDiagram[] = [];
  const combo = est.combination;
  if (combo?.applied) {
    combo.groups.forEach((gr) => {
      const rects = groupRects(gr);
      const colourFor = (comp: string | undefined) =>
        COMBO_PALETTE[Math.max(0, gr.components.indexOf(comp ?? "")) % COMBO_PALETTE.length];
      diagrams.push({
        caption: `Combined sheet ${sheetDims(est.sheet)} · ${gr.boxesPerSheet} box${gr.boxesPerSheet === 1 ? "" : "es"}/sheet · ${gr.sheetsNeeded} sheets`,
        sheetW_in: est.sheet.width_in,
        sheetH_in: est.sheet.height_in,
        rects: rects.map((r) => ({ x_in: r.x_in, y_in: r.y_in, w_in: r.w_in, h_in: r.h_in, colour: colourFor(r.component), fillOpacity: 0.28 })),
        creases: creaseSegs(rects, panels, est.sheet, (r) => colourFor(r.component)),
        legend: gr.shelves.map((s) => ({ label: `${pretty(s.component)} ${fmtIn(s.blankW_in)}×${fmtIn(s.blankH_in)} in ×${s.rows * s.perRow}`, colour: colourFor(s.component) })),
      });
    });
    for (const name of combo.separateComponents) {
      const c = est.components.find((x) => x.component === name);
      if (c) diagrams.push(componentDiagram(est, c, panels));
    }
  } else {
    for (const c of est.components) diagrams.push(componentDiagram(est, c, panels));
  }
  if (purchase) {
    const rotated = purchase.layout.filter((r) => r.orientation !== purchase.chosen).length;
    diagrams.push({
      caption: `Buy on ${sheetDims(purchase.paperSheet)} · ${purchase.printsPerSheet} print${purchase.printsPerSheet === 1 ? "" : "s"}/sheet${rotated > 0 ? ` (${rotated} rotated)` : ""} · ${purchase.sheetsToBuy} sheets`,
      sheetW_in: purchase.paperSheet.width_in,
      sheetH_in: purchase.paperSheet.height_in,
      rects: purchase.layout.map((r) => {
        const rot = r.orientation !== purchase.chosen;
        return { x_in: r.x_in, y_in: r.y_in, w_in: r.w_in, h_in: r.h_in, colour: rot ? GOLD : NAVY, fillOpacity: rot ? 0.3 : 0.22 };
      }),
      creases: [],
    });
  }
  return diagrams;
}

function pieceDiagram(
  piece: { length_in: number; width_in: number },
  sheet: Sheet,
  chosen: "A" | "B",
  perSheet: number,
  sheetsNeeded: number,
  mixed?: MixedLayout,
): PdfDiagram {
  // Mixed layout when the engine packed one (rotated pieces drawn solid, as on
  // the board/wrap diagrams), else the plain grid.
  const rects = pieceRects(piece, sheet, chosen, mixed);
  const g = pieceGrid(piece, sheet, chosen);
  const rotated = rects.filter((r) => r.rotated).length;
  const layout = mixed
    ? `${perSheet}/sheet${rotated > 0 ? ` (${rotated} rotated)` : ""}`
    : `${g.across}×${g.down} = ${perSheet}/sheet`;
  return {
    caption: `Sheet ${sheetDims(sheet)} · piece ${fmtIn(g.w_in)} × ${fmtIn(g.h_in)} in · ${layout} · ${sheetsNeeded} sheets`,
    sheetW_in: sheet.width_in,
    sheetH_in: sheet.height_in,
    rects: rects.map((r) => ({
      x_in: r.x_in, y_in: r.y_in, w_in: r.w_in, h_in: r.h_in,
      colour: GOLD, fillOpacity: r.rotated ? 0.5 : 0.22,
    })),
    creases: [],
  };
}

/** Finishing table rows from a component's finishing selections. */
function finishingLines(sels?: FinishingSelection[]): FinishingLine[] {
  return (sels ?? []).map((f) => {
    const area = f.designArea
      ? `${fmtIn(f.designArea.length_in)} × ${fmtIn(f.designArea.width_in)} in`
      : undefined;
    if (f.kind === "lamination") return { label: "Lamination", type: f.key };
    if (f.kind === "foiling") return { label: "Foiling", type: `${f.key}${f.finish ? ` (${f.finish})` : ""}`, area };
    if (f.kind === "uv") return { label: "UV", type: f.key, area };
    return { label: "Relief (emboss/deboss)", type: f.key, area };
  });
}

/** The wrap selection that applies to a component (per-component override, else
 *  the shared wrap). All components in a group resolve identically, so the
 *  first component's selection speaks for the whole group. */
function outerSelFor(specs: EstimateRequest, component: string): OuterWrap | undefined {
  return specs.wrapping?.perComponent?.[component]?.outer ?? specs.wrapping?.outer;
}
function innerSelFor(specs: EstimateRequest, component: string): InnerWrap | undefined {
  return specs.wrapping?.perComponent?.[component]?.inner ?? specs.wrapping?.inner;
}
function outerFinishingFor(specs: EstimateRequest, component: string): FinishingSelection[] | undefined {
  return specs.wrapping?.perComponent?.[component]?.finishing ?? specs.finishing;
}

/**
 * A wrap block for ONE component within its group (client 21-Jul: list each
 * component separately). Shows that component's own cut pattern; when the
 * component shares its group with others (identically-wrapped parts nest
 * together), the sheet total is the group's shared total with a note, so the
 * per-component blocks never double-count.
 */
function componentWrapBlock(
  group: WrapGroupEstimate,
  component: string,
  sel: OuterWrap | InnerWrap | undefined,
  finishing: FinishingSelection[] | undefined,
  panels: KeylinePanelData[] | undefined,
): MaterialBlock {
  const lines: MaterialBlock["lines"] = [];
  let heading = "Paper";
  if (sel?.mode === "special") {
    heading = "Special paper";
    lines.push({ label: "Paper type", value: sel.specialPaperName ?? "—" });
    lines.push({ label: "Size", value: sel.specialSizeLabel ?? "—" });
  } else if (sel?.mode === "white") {
    heading = "White lining paper";
    lines.push({ label: "Size", value: sel.paperSizeLabel ?? "—" });
    lines.push({ label: "GSM", value: String(sel.gsm) });
  } else if (sel) {
    const p = "printing" in sel ? sel.printing : undefined;
    heading = p ? `${p.colour === "single" ? "Single-colour" : "Multicolour"} ${p.type} printing` : "Printed paper";
    if (p?.sizeLabel) lines.push({ label: "Printing size", value: p.sizeLabel });
    lines.push({ label: "Paper size", value: sel.paperSizeLabel ?? "—" });
    lines.push({ label: "GSM", value: String(sel.gsm) });
    // Offset is billed in runs of 1000, so the floor sheet states how this
    // component's print job divides (client 5-Aug asked for the split). SHEETS
    // ONLY — this document is cost-free by construction and validated as such.
    // Digital has no run structure, so it gets nothing.
    if (p?.type === "offset") {
      const tier = printTierSheets(printJobFor(group.material, component));
      if (tier.first > 0) {
        lines.push({
          label: "Standard print run",
          value: `first 1,000 sheets (${tier.first.toLocaleString("en-IN")} used)`,
        });
        if (tier.additional > 0) {
          lines.push({
            label: "Additional print runs",
            value: `${tier.runs} × 1,000 (${tier.additional.toLocaleString("en-IN")} sheets over)`,
          });
        }
      }
    }
  }

  const others = group.components.filter((c) => c !== component);
  const shared = others.length > 0;
  const compResult = group.material.components.find((c) => c.component === component);
  const diagrams = compResult ? [componentDiagram(group.material, compResult, panels, shared)] : [];
  return {
    heading,
    lines,
    total: shared
      ? `${sheetsTotal(group.material, group.purchase)} (shared with ${others.map(pretty).join(", ")})`
      : sheetsTotal(group.material, group.purchase),
    diagrams,
    finishing: finishingLines(finishing),
    note: shared
      ? `Cut together with ${others.map(pretty).join(", ")} on shared sheets — one print plate.`
      : undefined,
  };
}

// --- assembly --------------------------------------------------------------

export function buildMaterialsData(
  est: EstimateDetail,
  materials: MaterialQuantities,
): MaterialsData {
  const specs = est.specs_snapshot as EstimateRequest;

  let panels: KeylinePanelData[] | undefined;
  try {
    panels = keylinePanelBuilders[specs.boxType](specs.dims, specs.vars ?? {});
  } catch {
    panels = undefined;
  }

  const items: OutputItem[] = [];

  // --- Kappa board -------------------------------------------------------
  items.push({ kind: "heading", text: "Kappa board" });
  items.push({
    kind: "block",
    block: {
      heading: "Board",
      lines: [{ label: "Thickness", value: `${specs.boardThickness_mm} mm` }],
      total: sheetsTotal(materials.board),
      diagrams: estimateDiagrams(materials.board, panels),
    },
  });

  // --- Keylines (client item 10: "all keylines") -------------------------
  items.push({
    kind: "keylines",
    keylines: materials.blanks.map((b) => {
      const c = creasesForBlank(panels, b.width_in, b.height_in);
      return {
        component: pretty(b.component),
        size: `${fmtIn(b.width_in)} × ${fmtIn(b.height_in)} in`,
        blankW_in: b.width_in,
        blankH_in: b.height_in,
        creases: [
          ...(c?.xFolds ?? []).map((f) => ({ x1: f, y1: 0, x2: f, y2: b.height_in, colour: NAVY })),
          ...(c?.yFolds ?? []).map((f) => ({ x1: 0, y1: f, x2: b.width_in, y2: f, colour: NAVY })),
        ],
      };
    }),
  });

  // --- Wrapping, listed per component (client 21-Jul) --------------------
  const outerGroups = materials.outerPaper || materials.outerPaperGroups ? wrapGroupsOf(materials, "outer") : [];
  const innerGroups = materials.innerPaper || materials.innerPaperGroups ? wrapGroupsOf(materials, "inner") : [];
  if (outerGroups.length || innerGroups.length) {
    items.push({ kind: "heading", text: "Wrapping" });
    // One block per BOX component (in blank order), each showing its own wrap
    // spec + cut pattern. Identically-wrapped parts still nest together — that
    // shared total is noted so the per-component blocks don't double-count.
    const seen = new Set<string>();
    for (const b of materials.blanks) {
      if (seen.has(b.component)) continue;
      seen.add(b.component);
      const comp = b.component;
      const outerG = outerGroups.find((g) => g.components.includes(comp));
      const innerG = innerGroups.find((g) => g.components.includes(comp));
      if (!outerG && !innerG) continue;
      items.push({
        kind: "componentWrap",
        component: pretty(comp),
        outer: outerG
          ? componentWrapBlock(outerG, comp, outerSelFor(specs, comp), outerFinishingFor(specs, comp), panels)
          : undefined,
        inner: innerG
          ? componentWrapBlock(innerG, comp, innerSelFor(specs, comp), innerSelFor(specs, comp)?.finishing, panels)
          : undefined,
      });
    }
  }

  // --- Additions ---------------------------------------------------------
  const additions: OutputItem[] = [];
  (materials.foams ?? []).forEach((f, i) => {
    additions.push({ kind: "block", block: foamBlock(materials.foams!.length > 1 ? `Foam ${i + 1}` : "Foam", f, specs.inserts?.foams?.[i] ?? specs.inserts?.foam) });
  });
  if (materials.reverseBoard) {
    const rb = materials.reverseBoard;
    const rbPanels = (() => {
      try {
        return reverseBoardPanels(specs.dims, specs.inserts?.reverseBoard?.insertHeight_in ?? 0);
      } catch {
        return undefined;
      }
    })();
    additions.push({
      kind: "block",
      block: {
        heading: "Reverse board",
        lines: [{ label: "Thickness", value: `${specs.inserts?.reverseBoard?.thickness_mm ?? "—"} mm` }],
        total: sheetsTotal(rb.board),
        diagrams: estimateDiagrams(rb.board, rbPanels),
      },
    });
    if (rb.topPaper) {
      additions.push({
        kind: "block",
        block: {
          heading: "Reverse board — top paper (card)",
          lines: [{ label: "Paper", value: specs.inserts?.reverseBoard?.topPaper ? `${specs.inserts.reverseBoard.topPaper.paperSizeLabel} · ${specs.inserts.reverseBoard.topPaper.gsm} GSM` : "—" }],
          total: sheetsTotal(rb.topPaper),
          diagrams: estimateDiagrams(rb.topPaper, rbPanels),
        },
      });
    }
  }
  if (materials.sleeve) additions.push({ kind: "block", block: cardBlock("Sleeve insert", materials.sleeve) });
  if (materials.beading) additions.push({ kind: "block", block: cardBlock("Beading", materials.beading) });
  if (materials.cardPartitions) additions.push({ kind: "block", block: cardBlock("Card partitions", materials.cardPartitions) });
  if (materials.customPartition) additions.push({ kind: "block", block: cardBlock("Custom card partition", materials.customPartition) });
  if (materials.addons.window) {
    const w = materials.addons.window;
    const piece = w.nestedBlank ?? w.windowFootprint;
    additions.push({
      kind: "block",
      block: {
        heading: "Window film",
        lines: [{ label: "Window size", value: `${fmtIn(w.windowFootprint.length_in)} × ${fmtIn(w.windowFootprint.width_in)} in` }],
        total: `${w.sheetsNeeded} sheet${w.sheetsNeeded === 1 ? "" : "s"} of ${sheetDims(w.filmSheet)}`,
        diagrams: [pieceDiagram(piece, w.filmSheet, w.chosen, w.piecesPerSheet, w.sheetsNeeded, w.mixed)],
      },
    });
  }

  // Any other add-ons — counts, with type + per box (client's "add ons" list).
  const acc = materials.accessories;
  const a = specs.accessories;
  const perBox = (total: number, per: number | undefined) =>
    per && per > 0 ? `${total} total (${per}/box)` : `${total} total`;
  const addonRows: ListRow[] = [];
  if (acc.magnets > 0)
    addonRows.push({ label: "Magnets", value: `${a?.magnetDiameter_mm ? `${a.magnetDiameter_mm}×${a.magnetThickness_mm} mm · ` : ""}${perBox(acc.magnets, a?.magnetsPerBox)}` });
  if (acc.washers > 0) addonRows.push({ label: "Washers", value: `${a?.washerName ? `${a.washerName} · ` : ""}${perBox(acc.washers, a?.magnetsPerBox)}` });
  if (acc.ribbonTag > 0) addonRows.push({ label: "Ribbon tags", value: perBox(acc.ribbonTag, 1) });
  // Handles / locks / misc carry a rate-card photo (client template: "with
  // image"). The imageRef is resolved to a data URI by the API route.
  if (materials.addons.handles > 0 && specs.addons?.handles?.type)
    addonRows.push({
      label: "Handles",
      value: `${specs.addons.handles.type} · ${perBox(materials.addons.handles, specs.addons.handles.count)}`,
      imageRef: { table: "handle_rates", column: "type", value: specs.addons.handles.type },
    });
  if (materials.addons.locks > 0 && specs.addons?.locks?.type)
    addonRows.push({
      label: "Locks",
      value: `${specs.addons.locks.type} · ${perBox(materials.addons.locks, specs.addons.locks.count)}`,
      imageRef: { table: "lock_rates", column: "type", value: specs.addons.locks.type },
    });
  for (const m of specs.addons?.misc ?? [])
    if (m.units > 0)
      addonRows.push({
        label: m.label,
        // perBox (round 10): the physical total the floor needs to buy/cut is
        // units × the production run, not the raw units entered per line.
        value: m.perBox ? perBox(m.units * productionQuantity(specs), m.units) : `${m.units} unit${m.units === 1 ? "" : "s"}`,
        imageRef: { table: "misc_rates", column: "name", value: m.label },
      });
  if (addonRows.length) additions.push({ kind: "list", heading: "Any other add-ons", rows: addonRows });

  // Standard costs — tape count (metlock/gum are manual cost inputs, no
  // bottle/volume quantity is tracked, so they list as "specified" only).
  const stdRows: { label: string; value: string }[] = [];
  if (acc.tape > 0) stdRows.push({ label: "Tape", value: `${acc.tape} application${acc.tape === 1 ? "" : "s"} (per tray/lid)` });
  // Glue/metlock (client 21-Jul): report the real count when the estimate was
  // entered by quantity; otherwise say it's required without inventing one.
  // Never the rate — this sheet stays free of money.
  const mq = specs.manual?.metlockQty;
  const gq = specs.manual?.glueQty;
  if (mq && mq.qty > 0) stdRows.push({ label: "Metlock", value: `${mq.qty} ${mq.unit}` });
  else if ((specs.manual?.metlockTotal ?? 0) > 0) stdRows.push({ label: "Metlock", value: "required (quantity not specified)" });
  if (gq && gq.qty > 0) stdRows.push({ label: "Gum / glue", value: `${gq.qty} ${gq.unit}` });
  else if ((specs.manual?.glueTotal ?? 0) > 0) stdRows.push({ label: "Gum / glue", value: "required (quantity not specified)" });
  if (stdRows.length) additions.push({ kind: "list", heading: "Standard consumables", rows: stdRows });

  // One-time investments — QUANTITY of die/mould/block only, never a cost.
  const qtyOf = (line: ChargeLine | undefined): number | null => {
    if (line == null) return null;
    if (typeof line === "number") return line > 0 ? 1 : 0; // legacy pre-multiplied total
    return line.qty > 0 ? line.qty : 0;
  };
  const oneTimeRows: { label: string; value: string }[] = [];
  for (const [label, line] of [
    ["Die", specs.additional?.die],
    ["Mould", specs.additional?.mould],
    ["Block", specs.additional?.block],
  ] as const) {
    const q = qtyOf(line);
    if (q && q > 0) oneTimeRows.push({ label, value: `${q} required` });
  }
  if (oneTimeRows.length) additions.push({ kind: "list", heading: "One-time investments", rows: oneTimeRows });

  if (additions.length) {
    items.push({ kind: "heading", text: "Additions" });
    items.push(...additions);
  }

  // --- Header fields (client 21-Jul: SS number only) ---------------------
  const header: MaterialsData["header"] = [
    { label: "SS number", value: est.id.slice(0, 8).toUpperCase() },
    { label: "Dimensions (L × W × H)", value: `${fmtIn(specs.dims.length_in)} × ${fmtIn(specs.dims.width_in)} × ${fmtIn(specs.dims.height_in)} in` },
    { label: "Box type", value: boxLabel(est.box_type) },
    { label: "Quantity", value: est.quantity.toLocaleString("en-IN") },
  ];
  if (est.client_name) header.push({ label: "Client", value: est.client_name });
  header.push({
    label: "Date",
    value: new Date(est.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
  });
  if (est.created_by_name) header.push({ label: "Prepared by", value: est.created_by_name });

  return {
    company: COMPANY,
    title: est.name || boxLabel(est.box_type),
    header,
    specLines: specsLines(specs),
    items,
  };
}

/** Foam block: punching-size nesting + optional cover. */
function foamBlock(
  heading: string,
  f: FoamEstimate,
  sel: { type?: string; thickness_mm?: number } | undefined,
): MaterialBlock {
  const nested = f.nestedBlank ?? f.insertFootprint;
  const lines: MaterialBlock["lines"] = [
    { label: "Type", value: sel?.type ?? "—" },
    { label: "Thickness", value: sel?.thickness_mm != null ? `${sel.thickness_mm} mm` : "—" },
    { label: "Punched piece", value: `${fmtIn(nested.length_in)} × ${fmtIn(nested.width_in)} in` },
  ];
  const diagrams = [pieceDiagram(nested, f.foamSheet, f.chosen, f.piecesPerSheet, f.sheetsNeeded, f.mixed)];
  let total = `${f.sheetsNeeded} sheet${f.sheetsNeeded === 1 ? "" : "s"} of ${sheetDims(f.foamSheet)}`;
  if (f.cover) {
    diagrams.push(pieceDiagram(f.insertFootprint, f.cover.sheet, f.cover.chosen, f.cover.piecesPerSheet, f.cover.sheetsNeeded, f.cover.mixed));
    lines.push({ label: "Cover", value: `×${f.cover.piecesPerBox}/box · ${f.cover.sheetsNeeded} sheets` });
    total += ` + ${f.cover.sheetsNeeded} cover`;
  }
  return { heading, lines, total, diagrams };
}

/** Card-stock insert block (sleeve / beading / partitions). */
function cardBlock(heading: string, est: CardInsertEstimate): MaterialBlock {
  return {
    heading,
    lines: [{ label: "Stock sheet", value: sheetDims(est.paper.sheet) }],
    total: sheetsTotal(est.paper, est.purchase),
    diagrams: estimateDiagrams(est.paper, undefined, est.purchase),
  };
}
