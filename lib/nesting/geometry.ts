// Pure nesting-diagram geometry, shared by the browser SVG components
// (components/estimate/nesting-diagram.tsx) and the raw-materials PDF
// (components/pdf/materials-document.tsx). No React, no "use client", no
// server-only — and TYPE-ONLY imports from the engine/keylines, so neither
// bundle drags runtime code it doesn't need (the browser file deliberately
// keeps material.ts out of the client bundle).

import type {
  BlankMaterialResult,
  CombinedGroup,
  Orientation,
  PaperPurchase,
  Sheet,
} from "@/lib/engines/material";
import type { KeylinePanelData } from "@/components/keylines/keyline-base";

/** One placed piece on a sheet, in sheet-inches. */
export interface DiagramRect {
  x_in: number;
  y_in: number;
  w_in: number;
  h_in: number;
  rotated: boolean;
  component?: string;
}

/** Fixed diagram viewBox (px). The browser scales via CSS; the PDF draws it
 *  at 1 unit = 1 pt, giving pixel parity with the app for free. */
export const VB = { W: 320, H: 180, ML: 30, MT: 20, MR: 4, MB: 4 } as const;

/** px per sheet-inch that fits the sheet in the drawing area. */
export function diagramScale(sheetW_in: number, sheetH_in: number): number {
  return Math.min(
    (VB.W - VB.ML - VB.MR) / sheetW_in,
    (VB.H - VB.MT - VB.MB) / sheetH_in,
  );
}

/** Inches formatted for labels: whole numbers plain, else 2dp. */
export const fmtIn = (n: number): string =>
  Number.isInteger(n) ? String(n) : (Math.round(n * 100) / 100).toFixed(2);

/** Two-orientation nest math (same as nestBlank in material.ts, duplicated so
 *  the client bundle doesn't pull the engine module). */
export function nestOrient(bW: number, bH: number, sW: number, sH: number) {
  return {
    acrossA: Math.floor(sW / bW),
    downA: Math.floor(sH / bH),
    acrossB: Math.floor(sW / bH),
    downB: Math.floor(sH / bW),
  };
}

/** A uniform grid of one oriented blank: size + counts. */
export interface OrientedGrid {
  w_in: number;
  h_in: number;
  across: number;
  down: number;
}

/** Resolve a component's chosen orientation into its oriented grid. */
export function orientedBlank(c: BlankMaterialResult): OrientedGrid {
  const isA = c.chosen === "A";
  return {
    w_in: isA ? c.blank.width_in : c.blank.height_in,
    h_in: isA ? c.blank.height_in : c.blank.width_in,
    across: isA ? c.orientation.acrossA : c.orientation.acrossB,
    down: isA ? c.orientation.downA : c.orientation.downB,
  };
}

/** Grid for a free piece (foam / cover / window) on a stock sheet. */
export function pieceGrid(
  piece: { length_in: number; width_in: number },
  sheet: Sheet,
  chosen: Orientation,
): OrientedGrid {
  const o = nestOrient(piece.length_in, piece.width_in, sheet.width_in, sheet.height_in);
  const isA = chosen === "A";
  return {
    w_in: isA ? piece.length_in : piece.width_in,
    h_in: isA ? piece.width_in : piece.length_in,
    across: isA ? o.acrossA : o.acrossB,
    down: isA ? o.downA : o.downB,
  };
}

/**
 * Placed pieces for a FREE piece (foam / foam cover / window film): the engine's
 * mixed-orientation layout when it packed one, else the pure grid. Mirrors
 * componentRects for blanks, so every nesting surface in the app — live
 * preview, result panel, materials PDF — draws mixed layouts the same way.
 */
export function pieceRects(
  piece: { length_in: number; width_in: number },
  sheet: Sheet,
  chosen: Orientation,
  mixed?: { layout: { x_in: number; y_in: number; w_in: number; h_in: number; orientation: Orientation }[] },
  component?: string,
): DiagramRect[] {
  if (mixed) {
    return mixed.layout.map((r) => ({
      x_in: r.x_in,
      y_in: r.y_in,
      w_in: r.w_in,
      h_in: r.h_in,
      rotated: r.orientation !== chosen,
      component,
    }));
  }
  return gridRects(pieceGrid(piece, sheet, chosen), component);
}

/** Rect list of a uniform grid (row-major, origin top-left of the sheet). */
export function gridRects(g: OrientedGrid, component?: string): DiagramRect[] {
  const rects: DiagramRect[] = [];
  for (let r = 0; r < g.down; r++) {
    for (let c = 0; c < g.across; c++) {
      rects.push({
        x_in: c * g.w_in,
        y_in: r * g.h_in,
        w_in: g.w_in,
        h_in: g.h_in,
        rotated: false,
        component,
      });
    }
  }
  return rects;
}

/** One component's placed pieces: the mixed layout when the engine packed one
 *  (rotated pieces flagged), else its pure grid. Length === perSheet. */
export function componentRects(c: BlankMaterialResult): DiagramRect[] {
  if (c.mixed) {
    return c.mixed.layout.map((r) => ({
      x_in: r.x_in,
      y_in: r.y_in,
      w_in: r.w_in,
      h_in: r.h_in,
      rotated: r.orientation !== c.chosen,
      component: c.component,
    }));
  }
  return gridRects(orientedBlank(c), c.component);
}

/**
 * Lay out one CombinedGroup's blanks on the sheet, matching the engine's
 * guillotine geometry (bestGroupLayout in material.ts). "rows" = shelf bands
 * stacked up the height, blanks running across the width; "cols" = strip bands
 * stacked across the width, blanks running up the height (transposed).
 */
export function groupRects(group: CombinedGroup): DiagramRect[] {
  const rects: DiagramRect[] = [];
  if (group.direction === "rows") {
    let y = 0;
    for (const s of group.shelves) {
      for (let r = 0; r < s.rows; r++) {
        for (let c = 0; c < s.perRow; c++) {
          rects.push({
            x_in: c * s.blankW_in,
            y_in: y,
            w_in: s.blankW_in,
            h_in: s.blankH_in,
            rotated: false,
            component: s.component,
          });
        }
        y += s.blankH_in;
      }
    }
  } else {
    let x = 0;
    for (const s of group.shelves) {
      for (let r = 0; r < s.rows; r++) {
        for (let c = 0; c < s.perRow; c++) {
          rects.push({
            x_in: x,
            y_in: c * s.blankW_in,
            w_in: s.blankH_in,
            h_in: s.blankW_in,
            rotated: false,
            component: s.component,
          });
        }
        x += s.blankH_in;
      }
    }
  }
  return rects;
}

/** The prints packed on one purchased paper sheet (rotated extras flagged). */
export function purchaseRects(p: PaperPurchase): DiagramRect[] {
  return p.layout.map((r) => ({
    x_in: r.x_in,
    y_in: r.y_in,
    w_in: r.w_in,
    h_in: r.h_in,
    rotated: r.orientation !== p.chosen,
  }));
}

// --- Crease/cut lines (client 7-Jul: "crease/cut lines as per the keyline") ---
// The nesting diagram draws only the outer blank rectangles; the fold geometry
// lives in the keyline panels. Renderers overlay the keyline's internal fold
// lines onto each nested blank by matching a panel to the blank's footprint.

export type Creases = { xFolds: number[]; yFolds: number[] };

const segSum = (segs: { length: number }[]) => segs.reduce((s, x) => s + x.length, 0);

/** Internal fold offsets (inches) along an axis = cumulative segment edges minus the last. */
function internalFolds(segs: { length: number }[]): number[] {
  const edges: number[] = [];
  let acc = 0;
  for (let i = 0; i < segs.length - 1; i++) {
    acc += segs[i].length;
    edges.push(acc);
  }
  return edges;
}

/**
 * Find the keyline panel whose footprint matches the ORIENTED blank (already
 * rotated to how it sits on the sheet) and return its fold offsets in that
 * orientation. Matching is by dimensions, so it draws creases for the board
 * (blank == keyline) and the 0-reduction inner liner, and correctly skips the
 * grown outer wrap (dims differ) rather than drawing misplaced lines.
 */
export function creasesForBlank(
  panels: KeylinePanelData[] | undefined,
  blankW: number,
  blankH: number,
): Creases | null {
  if (!panels?.length) return null;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  for (const p of panels) {
    const w = segSum(p.x);
    const h = segSum(p.y);
    const xf = internalFolds(p.x);
    const yf = internalFolds(p.y);
    if (near(w, blankW) && near(h, blankH)) return { xFolds: xf, yFolds: yf };
    if (near(w, blankH) && near(h, blankW)) return { xFolds: yf, yFolds: xf };
  }
  return null;
}
