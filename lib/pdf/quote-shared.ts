// Pure, shareable pieces of the quote pipeline: the company constants and the
// structured spec lines. Extracted from quotation-data.ts (which is
// server-only) in round 6 so the raw-materials PDF builder and offline
// validation scripts can use them without dragging server-only in. No DB, no
// costs — text shaping over a frozen EstimateRequest only.

import { BRAND } from "@/lib/brand";
import type {
  EstimateRequest,
  FinishingSelection,
  InnerWrap,
  OuterWrap,
} from "@/types";

// Static company details — the letterhead fields from docs/quotation-template.md.
// The values themselves live in lib/brand.ts so the demo deployment can swap the
// whole identity from one env var; the SHAPE here is load-bearing
// (QuotationData.company is typed `typeof COMPANY`).
export const COMPANY = {
  name: BRAND.name,
  tagline: BRAND.tagline,
  address: BRAND.address,
  gstin: BRAND.gstin,
};

// --- structured spec lines (client 4-Jul PDF format) ------------------------

export const fmt2 = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
};

/**
 * "multicolour offset print (18x25)" — but the size is OMITTED rather than
 * interpolated when absent. Auto-economical printing (round 5) deliberately
 * leaves sizeLabel off the request (the server picks it and freezes the winner
 * in rates_snapshot), so interpolating it blindly printed the literal text
 * "(undefined)" onto customer-facing quotations and output sheets.
 */
function printText(p: { colour?: string; type: string; sizeLabel?: string }): string {
  const colour = p.colour === "single" ? "single-colour" : "multicolour";
  return `${colour} ${p.type} print${p.sizeLabel ? ` (${p.sizeLabel})` : ""}`;
}

function finishingText(finishing?: FinishingSelection[]): string[] {
  return (finishing ?? []).map((f) => {
    const key = f.key.replace(/_/g, " ");
    if (f.kind === "lamination") return `${key} lamination`;
    if (f.kind === "foiling") return `foiling ${key}${f.finish ? ` (${f.finish})` : ""}`;
    if (f.kind === "uv") return `UV ${key}`;
    return key; // relief: emboss / deboss
  });
}

function outerLine(outer: OuterWrap | undefined, finishing?: FinishingSelection[]): string | null {
  if (!outer) return null;
  const parts: string[] = [];
  if (outer.mode === "special") {
    parts.push(`${outer.specialPaperName} (special paper, ${outer.specialSizeLabel})`);
  } else {
    parts.push(`art paper ${outer.gsm} GSM`);
    const p = outer.printing;
    parts.push(printText(p));
  }
  parts.push(...finishingText(finishing));
  return `Outer: ${parts.join(" · ")}`;
}

function innerLine(inner: InnerWrap | undefined): string | null {
  if (!inner) return null;
  const parts: string[] = [];
  if (inner.mode === "special") {
    parts.push(`${inner.specialPaperName} (special paper, ${inner.specialSizeLabel})`);
  } else if (inner.mode === "white") {
    parts.push(`white paper ${inner.gsm} GSM`);
  } else {
    parts.push(`art paper ${inner.gsm} GSM`);
    const p = inner.printing;
    if (p) parts.push(printText(p));
  }
  parts.push(...finishingText(inner.finishing));
  return `Inner: ${parts.join(" · ")}`;
}

function insertsLine(specs: EstimateRequest): string | null {
  const parts: string[] = [];
  const foams = specs.inserts?.foams ?? (specs.inserts?.foam ? [specs.inserts.foam] : []);
  for (const f of foams) {
    let s = `${f.type} foam ${f.thickness_mm} mm, ${fmt2(f.insert.length_in)} × ${fmt2(f.insert.width_in)} in`;
    if (f.cover && (f.cover.top || f.cover.bottom)) {
      const mat =
        f.cover.material === "special" ? "special paper"
        : f.cover.material === "art_card" ? "art card"
        : "art paper";
      s += ` (${mat} cover${f.cover.printing ? ", printed" : ""})`;
    }
    parts.push(s);
  }
  const rb = specs.inserts?.reverseBoard;
  if (rb) parts.push(`reverse board ${rb.thickness_mm} mm${rb.topPaper ? " + top paper" : ""}`);
  // Round-5 inserts (client 13-Jul; sleeve = card stock since round 6).
  const sv = specs.inserts?.sleeve;
  if (sv) {
    const stock = sv.stock;
    const matLabel =
      stock?.material === "special"
        ? `special paper${stock.specialPaperName ? ` ${stock.specialPaperName}` : ""}`
        : stock?.material === "art_card"
          ? stock.boardType ?? "art card"
          : "art paper";
    const bits = [matLabel];
    if (stock?.printing) bits.push("printed");
    if (stock?.finishing?.length) bits.push("finished");
    parts.push(
      `sleeve ${fmt2(sv.dims.length_in)} × ${fmt2(sv.dims.width_in)} × ${fmt2(sv.dims.height_in)} in (${bits.join(", ")})`,
    );
  }
  const stockNote = (stock: { printing?: unknown; lamination?: unknown[] } | undefined) => {
    const bits: string[] = [];
    if (stock?.printing) bits.push("printed");
    if (stock?.lamination?.length) bits.push("laminated");
    return bits.length ? ` (${bits.join(", ")})` : "";
  };
  const bd = specs.inserts?.beading;
  if (bd) parts.push(`beading BH ${fmt2(bd.height_in)} / BT ${fmt2(bd.thickness_in)} in${stockNote(bd.stock)}`);
  const cp = specs.inserts?.cardPartitions;
  if (cp) parts.push(`card partition ${cp.countL}L + ${cp.countW}W${stockNote(cp.stock)}`);
  const xp = specs.inserts?.customPartition;
  if (xp) parts.push(`custom partition ${fmt2(xp.size.length_in)} × ${fmt2(xp.size.width_in)} in ×${xp.count}${stockNote(xp.stock)}`);
  if (specs.inserts?.card?.total) parts.push("custom card insert");
  if (specs.inserts?.ribbonTagSizeLabel) parts.push(`ribbon tag ${specs.inserts.ribbonTagSizeLabel}`);
  const a = specs.addons;
  if (a?.window) parts.push(`window ${fmt2(a.window.size.length_in)} × ${fmt2(a.window.size.width_in)} in (${a.window.name})`);
  if (a?.handles?.count) parts.push(`${a.handles.count}× handle (${a.handles.type})`);
  if (a?.locks?.count) parts.push(`${a.locks.count}× lock (${a.locks.type})`);
  for (const m of a?.misc ?? []) {
    parts.push(`${m.label}${m.units > 1 ? ` ×${m.units}` : ""}`);
  }
  if (!parts.length) return null;
  return `Inserts & add-ons: ${parts.join(" · ")}`;
}

/**
 * Structured spec lines for one estimate (client 4-Jul format): board + dims
 * (2 decimals), then Outer / Inner / Inserts detail lines. The box type itself
 * is the item's description column, not repeated here.
 */
export function specsLines(specs: EstimateRequest): string[] {
  const { length_in: l, width_in: w, height_in: h } = specs.dims;
  const lines: string[] = [
    `${specs.boardThickness_mm} mm kappa board · ${fmt2(l)} × ${fmt2(w)} × ${fmt2(h)} in`,
  ];
  const outer = outerLine(specs.wrapping?.outer, specs.finishing);
  if (outer) lines.push(outer);
  const inner = innerLine(specs.wrapping?.inner);
  if (inner) lines.push(inner);
  const ins = insertsLine(specs);
  if (ins) lines.push(ins);
  return lines;
}
