"use client";

// Visual nesting layout: shows how blanks are cut from a stock sheet as an SVG grid.
// Pure presentational — types only from the engine, no runtime lib imports.

import type {
  CombinedGroup,
  FoamEstimate,
  MaterialEstimate,
  Orientation,
  PaperPurchase,
  PrintLayoutRect,
  WindowEstimate,
} from "@/lib/engines/material";
import type { KeylinePanelData } from "@/components/keylines";
// Shared geometry (round 6): the pure math lives in lib/nesting/geometry.ts so
// the raw-materials PDF draws the exact same layouts. Type-only engine imports
// there keep material.ts out of the client bundle, as before.
import {
  VB,
  creasesForBlank,
  fmtIn as fmt,
  groupRects,
  nestOrient,
  type Creases,
} from "@/lib/nesting/geometry";

/**
 * Dashed fold lines drawn inside every blank cell of a grid. `x0,y0` = grid
 * origin (px), `bW,bH` = cell size (px), `across,down` = grid counts. Fold
 * offsets are in oriented blank-inches, scaled to px. Skipped when cells are
 * too small to read.
 */
function creaseLines(
  creases: Creases | null | undefined,
  x0: number,
  y0: number,
  bW: number,
  bH: number,
  across: number,
  down: number,
  scale: number,
  colour = "#33261C",
): React.ReactNode[] {
  if (!creases || bW < 12 || bH < 12) return [];
  const lines: React.ReactNode[] = [];
  for (let r = 0; r < down; r++) {
    for (let c = 0; c < across; c++) {
      const cx = x0 + c * bW;
      const cy = y0 + r * bH;
      creases.xFolds.forEach((f, i) => {
        lines.push(
          <line
            key={`xf-${r}-${c}-${i}`}
            x1={cx + f * scale}
            y1={cy}
            x2={cx + f * scale}
            y2={cy + bH}
            stroke={colour}
            strokeWidth={0.4}
            strokeDasharray="3 2"
            opacity={0.5}
          />,
        );
      });
      creases.yFolds.forEach((f, i) => {
        lines.push(
          <line
            key={`yf-${r}-${c}-${i}`}
            x1={cx}
            y1={cy + f * scale}
            x2={cx + bW}
            y2={cy + f * scale}
            stroke={colour}
            strokeWidth={0.4}
            strokeDasharray="3 2"
            opacity={0.5}
          />,
        );
      });
    }
  }
  return lines;
}

// Fixed viewBox size in px — browser scales via CSS width.
const { W: VB_W, H: VB_H, ML, MT, MR, MB } = VB;

interface SheetDiagramProps {
  label: string;
  sheetW: number; // inches
  sheetH: number;
  blankW: number; // inches, already oriented (caller resolves A vs B)
  blankH: number;
  across: number;
  down: number;
  perSheet: number;
  sheetsNeeded: number;
  creases?: Creases | null; // keyline fold lines for this blank (oriented)
  /**
   * Mixed-orientation layout (round 5): when present, the explicit rect list
   * replaces the uniform grid — rotated pieces draw in clay,
   * exactly like
   * PrintPurchaseDiagram. `chosen` = the main grid's orientation, so rects
   * whose orientation differs are the recovered strip pieces.
   */
  layout?: PrintLayoutRect[];
  chosen?: Orientation;
}

function SheetDiagram({
  label,
  sheetW,
  sheetH,
  blankW,
  blankH,
  across,
  down,
  perSheet,
  sheetsNeeded,
  creases,
  layout,
  chosen,
}: SheetDiagramProps) {
  const drawW = VB_W - ML - MR;
  const drawH = VB_H - MT - MB;

  // Scale to fit the drawing area while keeping the sheet's aspect ratio.
  const scale = Math.min(drawW / sheetW, drawH / sheetH);
  const sW = sheetW * scale; // displayed sheet width in px
  const sH = sheetH * scale;
  const bW = blankW * scale;
  const bH = blankH * scale;

  const cells: React.ReactNode[] = [];
  let rotatedCount = 0;
  if (layout) {
    // Mixed-orientation layout (round 5): draw the engine's actual rects;
    // rotated strip pieces read in solid clay like PrintPurchaseDiagram.
    layout.forEach((r, i) => {
      const rotated = chosen != null && r.orientation !== chosen;
      if (rotated) rotatedCount++;
      cells.push(
        <rect
          key={i}
          x={ML + r.x_in * scale}
          y={MT + r.y_in * scale}
          width={r.w_in * scale}
          height={r.h_in * scale}
          fill="#B4552D"
          fillOpacity={rotated ? 0.5 : 0.22}
          stroke="#B4552D"
          strokeWidth={0.7}
        />,
      );
    });
  } else {
    for (let r = 0; r < down; r++) {
      for (let c = 0; c < across; c++) {
        cells.push(
          <rect
            key={`${r}-${c}`}
            x={ML + c * bW}
            y={MT + r * bH}
            width={bW}
            height={bH}
            fill="#B4552D"
            fillOpacity={0.22}
            stroke="#B4552D"
            strokeWidth={0.7}
          />,
        );
      }
    }
  }

  const creaseNodes = layout
    ? null // creases assume a uniform grid; skip them for mixed layouts
    : creaseLines(creases, ML, MT, bW, bH, across, down, scale);

  // Only show the in-cell label when cells are large enough to hold text.
  const showCellLabel = bW > 34 && bH > 16;
  const cellFs = Math.min(8.5, bH * 0.28, bW * 0.13);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium capitalize">{label}</span>
        <span className="tabular-nums text-xs text-muted-foreground">
          {layout
            ? `${perSheet}/sheet${rotatedCount > 0 ? ` · ${rotatedCount} rotated` : ""}`
            : `${across}×${down} = ${perSheet}/sheet`}
          &nbsp;·&nbsp;{sheetsNeeded}&nbsp;sheet
          {sheetsNeeded !== 1 ? "s" : ""}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="w-full max-h-[180px] rounded border bg-slate-50"
        aria-label={`Nesting layout: ${label}`}
      >
        {/* Sheet outline */}
        <rect
          x={ML}
          y={MT}
          width={sW}
          height={sH}
          fill="white"
          stroke="#33261C"
          strokeWidth={1.5}
        />

        {/* Blank cells */}
        {cells}

        {/* Keyline crease/fold lines (dashed) inside each blank */}
        {creaseNodes}

        {/* Width axis label (above the sheet), with a direction arrow */}
        <text
          x={ML + sW / 2}
          y={MT - 5}
          textAnchor="middle"
          fontSize={9}
          fill="#555"
        >
          width {fmt(sheetW)} in &#8596;
        </text>

        {/* Height axis label (left, rotated), with a direction arrow */}
        <text
          x={ML - 6}
          y={MT + sH / 2}
          textAnchor="middle"
          fontSize={9}
          fill="#555"
          transform={`rotate(-90 ${ML - 6} ${MT + sH / 2})`}
        >
          height {fmt(sheetH)} in &#8596;
        </text>

        {/* Blank dimension label inside the first cell — with w/h so the axis is
            unambiguous (client 7-Jul: clearer measurement axis). */}
        {across > 0 && down > 0 && showCellLabel && (
          <text
            x={ML + bW / 2}
            y={MT + bH / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={cellFs}
            fill="#33261C"
            opacity={0.85}
          >
            {fmt(blankW)}w&times;{fmt(blankH)}h
          </text>
        )}
      </svg>
    </div>
  );
}

/**
 * Renders a nesting diagram for each component in a board/paper material estimate.
 * `filter` (optional) restricts rendering to the named components — used to draw
 * only the parts still cut alone when the rest are shown in a combined-sheet diagram.
 */
export function MaterialNestingSection({
  title,
  est,
  filter,
  panels,
}: {
  title: string;
  est: MaterialEstimate;
  filter?: string[];
  panels?: KeylinePanelData[];
}) {
  const components = filter
    ? est.components.filter((c) => filter.includes(c.component))
    : est.components;
  return (
    <>
      {components.map((c) => {
        const isA = c.chosen === "A";
        const bW = isA ? c.blank.width_in : c.blank.height_in;
        const bH = isA ? c.blank.height_in : c.blank.width_in;
        const across = isA ? c.orientation.acrossA : c.orientation.acrossB;
        const down = isA ? c.orientation.downA : c.orientation.downB;
        return (
          <SheetDiagram
            key={c.component}
            label={`${title} — ${c.component.replace(/_/g, " ")}`}
            sheetW={est.sheet.width_in}
            sheetH={est.sheet.height_in}
            blankW={bW}
            blankH={bH}
            across={across}
            down={down}
            perSheet={c.perSheet}
            sheetsNeeded={c.sheetsNeeded}
            creases={creasesForBlank(panels, bW, bH)}
            // Mixed-orientation layout (round 5): rotated pieces draw in clay.
            layout={c.mixed?.layout}
            chosen={c.chosen}
          />
        );
      })}
    </>
  );
}

// Distinct hues per component in a combined layout (espresso / clay / olive /
// sienna, cycled). Kept brand-adjacent to the single-colour SheetDiagram.
// Warm palette: espresso, clay, olive-brown, muted rust. Four distinct hues
// rather than four greys — components in a combined layout have to be told
// apart at a glance, which lightness alone does poorly.
const COMBO_PALETTE = ["#33261C", "#B4552D", "#7D6A3F", "#9C4F4F"];

/**
 * Draws the ACTUAL combined cutting plan for one group: different components
 * sharing a single sheet (e.g. trays + lids), each in its own colour, with a
 * legend. This is the layout the engine already computes — it just wasn't drawn.
 */
export function CombinedSheetDiagram({
  label,
  sheetW,
  sheetH,
  group,
  panels,
}: {
  label: string;
  sheetW: number;
  sheetH: number;
  group: CombinedGroup;
  panels?: KeylinePanelData[];
}) {
  const drawW = VB_W - ML - MR;
  const drawH = VB_H - MT - MB;
  const scale = Math.min(drawW / sheetW, drawH / sheetH);
  const sW = sheetW * scale;
  const sH = sheetH * scale;

  const colourFor = (comp: string) =>
    COMBO_PALETTE[Math.max(0, group.components.indexOf(comp)) % COMBO_PALETTE.length];

  const rects = groupRects(group);
  // Per-component count + oriented blank size on one sheet (one shelf entry per component).
  const legend = group.shelves.map((s) => ({
    component: s.component,
    perSheet: s.rows * s.perRow,
    colour: colourFor(s.component),
    dims: `${fmt(s.blankW_in)}×${fmt(s.blankH_in)}`,
  }));
  // Label the first cell of each component with its blank dimensions (when the
  // cell is big enough to hold the text), like the per-part diagrams do.
  const firstOfComponent = new Set<number>();
  {
    const seen = new Set<string>();
    rects.forEach((r, i) => {
      const comp = r.component ?? "";
      if (!seen.has(comp)) {
        seen.add(comp);
        firstOfComponent.add(i);
      }
    });
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium capitalize">{label}</span>
        <span className="tabular-nums text-xs text-muted-foreground">
          {group.boxesPerSheet}&nbsp;box{group.boxesPerSheet === 1 ? "" : "es"}/sheet&nbsp;·&nbsp;
          {group.sheetsNeeded}&nbsp;sheet{group.sheetsNeeded === 1 ? "" : "s"}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="w-full max-h-[180px] rounded border bg-slate-50"
        aria-label={`Combined nesting layout: ${label}`}
      >
        <rect x={ML} y={MT} width={sW} height={sH} fill="white" stroke="#33261C" strokeWidth={1.5} />
        {rects.map((r, i) => (
          <rect
            key={i}
            x={ML + r.x_in * scale}
            y={MT + r.y_in * scale}
            width={r.w_in * scale}
            height={r.h_in * scale}
            fill={colourFor(r.component ?? "")}
            fillOpacity={0.28}
            stroke={colourFor(r.component ?? "")}
            strokeWidth={0.7}
          />
        ))}
        {/* Keyline creases per shared-sheet blank (client 7-Jul). */}
        {rects.flatMap((r) =>
          creaseLines(
            creasesForBlank(panels, r.w_in, r.h_in),
            ML + r.x_in * scale,
            MT + r.y_in * scale,
            r.w_in * scale,
            r.h_in * scale,
            1,
            1,
            scale,
            colourFor(r.component ?? ""),
          ),
        )}
        {rects.map((r, i) => {
          if (!firstOfComponent.has(i)) return null;
          const cw = r.w_in * scale;
          const ch = r.h_in * scale;
          if (cw <= 32 || ch <= 14) return null; // too small to label
          return (
            <text
              key={`dim-${i}`}
              x={ML + (r.x_in + r.w_in / 2) * scale}
              y={MT + (r.y_in + r.h_in / 2) * scale}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={Math.min(9, ch * 0.3, cw * 0.14)}
              fill={colourFor(r.component ?? "")}
              opacity={0.9}
            >
              {fmt(r.w_in)}×{fmt(r.h_in)}
            </text>
          );
        })}
        <text x={ML + sW / 2} y={MT - 5} textAnchor="middle" fontSize={9} fill="#555">
          width {fmt(sheetW)} in &#8596;
        </text>
        <text
          x={ML - 6}
          y={MT + sH / 2}
          textAnchor="middle"
          fontSize={9}
          fill="#555"
          transform={`rotate(-90 ${ML - 6} ${MT + sH / 2})`}
        >
          height {fmt(sheetH)} in &#8596;
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {legend.map((l) => (
          <span key={l.component} className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: l.colour, opacity: 0.55 }}
            />
            <span className="capitalize">{l.component.replace(/_/g, " ")}</span>
            <span className="tabular-nums">{l.dims} in</span>
            <span className="tabular-nums">×{l.perSheet}/sheet</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * One material layer's nesting block: combined-sheet diagram(s) + an amber
 * summary when combination nesting applied, else the plain per-part grid.
 * Shared by board, outer paper, and inner paper — anything that goes through
 * combination nesting (see `combine` on estimateBoardMaterial/estimatePaperMaterial).
 */
export function MaterialNestingBlock({
  label,
  est,
  panels,
}: {
  label: string;
  est: MaterialEstimate;
  panels?: KeylinePanelData[];
}) {
  // Layer total (round 6, client 15-Jul "board summary like the paper's"):
  // one line summing the whole layer, since per-component diagrams each show
  // only their own count.
  const summary = Number.isFinite(est.totalSheets) ? (
    <p className="text-xs font-medium">
      {label} total:{" "}
      <span className="text-primary">
        {est.totalSheets} sheet{est.totalSheets === 1 ? "" : "s"}
      </span>{" "}
      of {fmt(est.sheet.width_in)} × {fmt(est.sheet.height_in)} in
    </p>
  ) : null;
  const combo = est.combination;
  if (!combo?.applied) {
    return (
      <>
        {summary}
        <MaterialNestingSection title={label} est={est} panels={panels} />
      </>
    );
  }
  return (
    <>
      {summary}
      <p className="rounded border border-dashed border-amber-400/60 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        {combo.combinedSheets < combo.separateSheets ? (
          <>
            {label} parts are cut <strong>combined on shared sheets</strong> — different
            parts share each sheet, so the order needs only {combo.combinedSheets} sheets
            (vs {combo.separateSheets} if each part were cut alone). The layout below
            shows the shared sheet.
          </>
        ) : (
          // Round 6: a sheet TIE still wins on a printed layer — one shared
          // layout means ONE print job/plate instead of one per part.
          <>
            {label} parts are cut <strong>combined on shared sheets</strong> — same
            sheet count as cutting each part alone ({combo.combinedSheets}), but one
            shared layout means <strong>one print job/plate</strong> instead of{" "}
            {combo.separateComponents.length + combo.groups.reduce((s, g) => s + g.components.length, 0)}.
            The layout below shows the shared sheet.
          </>
        )}
      </p>
      {combo.groups.map((g, i) => (
        <CombinedSheetDiagram
          key={i}
          label={combo.groups.length > 1 ? `${label} — combined sheet ${i + 1}` : `${label} — combined sheet`}
          sheetW={est.sheet.width_in}
          sheetH={est.sheet.height_in}
          group={g}
          panels={panels}
        />
      ))}
      {combo.separateComponents.length > 0 && (
        <>
          <p className="-mb-2 text-xs text-muted-foreground">
            Per-part layouts (parts still cut alone, for reference):
          </p>
          <MaterialNestingSection title={label} est={est} filter={combo.separateComponents} panels={panels} />
        </>
      )}
    </>
  );
}

/** Nesting diagram for a foam insert (+ its optional cover) on stock sheets. */
export function FoamNestingSection({
  est,
  label = "Foam insert",
}: {
  est: FoamEstimate;
  label?: string;
}) {
  // Foam pieces occupy nestedBlank (footprint + punching margin per side) on
  // the sheet — draw that so the grid always matches the engine's count.
  // Legacy pre-round-3 data has no nestedBlank; fall back to the footprint.
  const nested = est.nestedBlank ?? est.insertFootprint;
  const o = nestOrient(
    nested.length_in,
    nested.width_in,
    est.foamSheet.width_in,
    est.foamSheet.height_in,
  );
  const isA = est.chosen === "A";
  const bW = isA ? nested.length_in : nested.width_in;
  const bH = isA ? nested.width_in : nested.length_in;
  const across = isA ? o.acrossA : o.acrossB;
  const down = isA ? o.downA : o.downB;

  // Cover pieces nest on the cover material's sheet (the PRINT area when the
  // cover is printed — the purchase note then explains the sheets bought).
  const cover = est.cover;
  let coverDiagram: React.ReactNode = null;
  if (cover) {
    const co = nestOrient(
      est.insertFootprint.length_in,
      est.insertFootprint.width_in,
      cover.sheet.width_in,
      cover.sheet.height_in,
    );
    const cIsA = cover.chosen === "A";
    coverDiagram = (
      <div className="flex flex-col gap-1">
        <SheetDiagram
          label={`${label} — cover (×${cover.piecesPerBox}/box)`}
          sheetW={cover.sheet.width_in}
          sheetH={cover.sheet.height_in}
          blankW={cIsA ? est.insertFootprint.length_in : est.insertFootprint.width_in}
          blankH={cIsA ? est.insertFootprint.width_in : est.insertFootprint.length_in}
          across={cIsA ? co.acrossA : co.acrossB}
          down={cIsA ? co.downA : co.downB}
          perSheet={cover.piecesPerSheet}
          sheetsNeeded={cover.sheetsNeeded}
          layout={cover.mixed?.layout}
          chosen={cover.chosen}
        />
        {cover.purchase && (
          <PrintPurchaseDiagram purchase={cover.purchase} label={`${label} — cover print on paper`} />
        )}
      </div>
    );
  }

  return (
    <>
      <SheetDiagram
        label={label}
        sheetW={est.foamSheet.width_in}
        sheetH={est.foamSheet.height_in}
        blankW={bW}
        blankH={bH}
        across={across}
        down={down}
        perSheet={est.piecesPerSheet}
        sheetsNeeded={est.sheetsNeeded}
        layout={est.mixed?.layout}
        chosen={est.chosen}
      />
      {coverDiagram}
    </>
  );
}

/**
 * Print-on-paper purchase layout (client 7-Jul: "what is the size of each print
 * axis-wise" + "1 more print fits in the wasted space if we flip to landscape").
 * Draws one stock paper sheet with the prints packed on it — main-orientation
 * prints in espresso, the rotated extras recovered from the leftover strip in
 * clay —
 * plus a summary line with the per-print size and sheets bought.
 */
export function PrintPurchaseDiagram({
  purchase,
  label = "Print on paper",
}: {
  purchase: PaperPurchase;
  label?: string;
}) {
  const sheetW = purchase.paperSheet.width_in;
  const sheetH = purchase.paperSheet.height_in;
  const drawW = VB_W - ML - MR;
  const drawH = VB_H - MT - MB;
  const scale = Math.min(drawW / sheetW, drawH / sheetH);
  const sW = sheetW * scale;
  const sH = sheetH * scale;
  const rotatedCount = purchase.layout.filter((r) => r.orientation !== purchase.chosen).length;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium">{label}</span>
        <span className="tabular-nums text-xs text-muted-foreground">
          {purchase.printsPerSheet} print{purchase.printsPerSheet === 1 ? "" : "s"}/sheet
          {rotatedCount > 0 ? ` · ${rotatedCount} rotated` : ""}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="w-full max-h-[180px] rounded border bg-slate-50"
        aria-label={`Print-on-paper layout: ${label}`}
      >
        <rect x={ML} y={MT} width={sW} height={sH} fill="white" stroke="#33261C" strokeWidth={1.5} />
        {purchase.layout.map((r, i) => {
          const rotated = r.orientation !== purchase.chosen;
          const colour = rotated ? "#B4552D" : "#33261C";
          return (
            <rect
              key={i}
              x={ML + r.x_in * scale}
              y={MT + r.y_in * scale}
              width={r.w_in * scale}
              height={r.h_in * scale}
              fill={colour}
              fillOpacity={rotated ? 0.3 : 0.22}
              stroke={colour}
              strokeWidth={0.7}
            />
          );
        })}
        <text x={ML + sW / 2} y={MT - 5} textAnchor="middle" fontSize={9} fill="#555">
          width {fmt(sheetW)} in &#8596;
        </text>
        <text
          x={ML - 6}
          y={MT + sH / 2}
          textAnchor="middle"
          fontSize={9}
          fill="#555"
          transform={`rotate(-90 ${ML - 6} ${MT + sH / 2})`}
        >
          height {fmt(sheetH)} in &#8596;
        </text>
      </svg>
      <p className="mt-1 text-xs text-muted-foreground">
        Each print{" "}
        <span className="tabular-nums">
          {fmt(purchase.printSheet.width_in)}×{fmt(purchase.printSheet.height_in)} in
        </span>
        ; {purchase.printedSheets} printed sheet{purchase.printedSheets === 1 ? "" : "s"} →{" "}
        <strong className="text-foreground">{purchase.sheetsToBuy}</strong> paper sheet
        {purchase.sheetsToBuy === 1 ? "" : "s"} of{" "}
        <span className="tabular-nums">
          {fmt(sheetW)}×{fmt(sheetH)} in
        </span>{" "}
        ({purchase.printsPerSheet}/sheet
        {rotatedCount > 0 ? `, ${rotatedCount} rotated to use the offcut` : ""}).
      </p>
    </div>
  );
}

/** Nesting diagram for a window film on its stock sheet. */
export function WindowNestingSection({ est }: { est: WindowEstimate }) {
  // Round 5: the punching allowance grows the nested piece — draw the piece
  // actually cut, not the raw window. Legacy estimates (no field) fall back
  // to the footprint, matching how they were costed.
  const piece = est.nestedBlank ?? est.windowFootprint;
  const o = nestOrient(
    piece.length_in,
    piece.width_in,
    est.filmSheet.width_in,
    est.filmSheet.height_in,
  );
  const isA = est.chosen === "A";
  const bW = isA ? piece.length_in : piece.width_in;
  const bH = isA ? piece.width_in : piece.length_in;
  const across = isA ? o.acrossA : o.acrossB;
  const down = isA ? o.downA : o.downB;
  return (
    <SheetDiagram
      label="Window film"
      sheetW={est.filmSheet.width_in}
      sheetH={est.filmSheet.height_in}
      blankW={bW}
      blankH={bH}
      across={across}
      down={down}
      perSheet={est.piecesPerSheet}
      sheetsNeeded={est.sheetsNeeded}
      layout={est.mixed?.layout}
      chosen={est.chosen}
    />
  );
}
