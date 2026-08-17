// Section-wise cost breakdown (client final doc item 11: "provide a clearer,
// section-wise breakdown of raw materials and rates", with an exact table of
// what each category must show — quantities, sizes, sheet counts, the total
// and a PER BOX figure on every line).
//
// PURE: it joins an estimate's frozen specs + its recomputed materials + its
// cost breakdown into display rows. No DB, no rate lookups, no re-costing —
// every amount here comes straight from the stored CostBreakdown, so this view
// can never disagree with what was quoted.
//
// Per-box divides by the ORDERED quantity (client item 3), so a production
// wastage run is carried by the order exactly like `pricePerBox` is.

import type { AdjustableLine, CostBreakdown } from "@/lib/engines/cost";
import { wrapGroupsOf, type MaterialEstimate, type MaterialQuantities } from "@/lib/engines/material";
import type { EstimateRequest, OuterWrap, InnerWrap, PrintingSelection } from "@/types";
import { DEFAULT_BOARD_TYPE } from "@/types";
import { chargeDetail } from "@/lib/estimate/charges";
import { BRAND } from "@/lib/brand";
import type { MoneyFormat } from "@/lib/currency";

/** One line: what it is, how much of it, the total and the per-box share. */
export interface CostViewRow {
  label: string;
  /** Quantities / sizes / types — the "Information to Include" column. */
  detail?: string;
  total: number;
  /** Per-box share. Absent when the line is NOT divided into the box price —
   *  one-time charges quoted separately (client 28-Jul) have no per-box share
   *  and showing one would contradict the quote. */
  perBox?: number;
  /** Which Level-1 line this row charges, when it maps to exactly one. Rows
   *  that split a line (per-group paper, foam sub-lines) leave it unset — they
   *  aren't individually editable, the line as a whole is. */
  line?: AdjustableLine;
  /** Set when this line was manually edited (item 9): the figure the engine
   *  originally computed, so the row can show it was changed on purpose.
   *  `stale` means the specs moved since the edit was made. */
  edited?: { computed: number; delta: number; note?: string; stale?: boolean };
}

export interface CostViewSection {
  title: string;
  rows: CostViewRow[];
  /** Section total, when it's worth repeating (multi-row sections). */
  total?: number;
  /**
   * Set when the section's ROWS split a single Level-1 line (itemised foam):
   * the line is then edited at the section total rather than per row, since no
   * individual row owns it. Her case — "mend the total foam price" — lands here
   * whenever a foam carries a cover.
   */
  line?: AdjustableLine;
  /** Present when that section-level line was edited. */
  edited?: { computed: number; delta: number; note?: string; stale?: boolean };
}

const n2 = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
};
/**
 * A rate inside a detail string ("5 litres × ₹250"). Applies the brand's
 * display divisor so it scales with the row's total, but keeps n2's compact
 * formatting — formatMoney() would force 2 decimals and thousands separators,
 * turning "₹250" into "₹250.00" and changing the real app's output.
 */
const rate = (n: number) => `${BRAND.currencySymbol}${n2(n / BRAND.currencyDivisor)}`;
const sheets = (n: number) => `${n} sheet${n === 1 ? "" : "s"}`;
const dims = (s: { width_in: number; height_in: number }) =>
  `${n2(s.width_in)} × ${n2(s.height_in)} in`;
const pretty = (s: string) => s.replace(/_/g, " ");

/** "printed 130 GSM 23x36" / "special: White Linen" — the stock in words. */
function stockLabel(w: OuterWrap | InnerWrap | undefined): string {
  if (!w) return "";
  if (w.mode === "special") return `special paper ${w.specialPaperName ?? ""}`.trim();
  if (w.mode === "white") return `white paper ${w.gsm} GSM`;
  return `art paper ${w.gsm} GSM`;
}

/**
 * "art paper 130 GSM" / "Duplex White Board" / "special paper White Linen" —
 * the stock a card insert or foam cover is cut from (client final doc item 11
 * asks for the paper/card TYPE on those rows, not just the sheet count).
 */
function cardStockLabel(
  s: { material: string; gsm?: number; boardType?: string; specialPaperName?: string } | undefined,
): string {
  if (!s) return "";
  if (s.material === "special") return `special paper ${s.specialPaperName ?? ""}`.trim();
  if (s.material === "art_card") {
    // Board section rows carry a type (art card / duplex / grey board / …);
    // snapshots saved before that column resolve to the default board type.
    return `${s.boardType ?? DEFAULT_BOARD_TYPE}${s.gsm ? ` ${s.gsm} GSM` : ""}`;
  }
  return `art paper${s.gsm ? ` ${s.gsm} GSM` : ""}`;
}

/** "offset multicolour 18x25" — a printing selection in words. */
function printJobLabel(p: PrintingSelection | undefined): string {
  if (!p) return "";
  const colour = p.colour === "single" ? "single-colour" : "multicolour";
  return `${p.type} ${colour}${p.sizeLabel ? ` ${p.sizeLabel}` : ""}`;
}

/** "offset multicolour 18x25" — the print job on a wrap layer. */
function printLabel(w: OuterWrap | InnerWrap | undefined): string {
  if (!w || w.mode === "special" || w.mode === "white") return "";
  return printJobLabel(w.printing);
}

/**
 * "10 × 8 in · Greyboard · 300 GSM" — the custom card insert's descriptive
 * spec (client 22-Jul). Falls back to "manual cost" when nothing was entered,
 * which is every snapshot saved before those fields existed.
 */
function customCardDetail(specs: EstimateRequest): string {
  const c = specs.inserts?.card;
  const bits = [
    c?.size ? `${n2(c.size.length_in)} × ${n2(c.size.width_in)} in` : null,
    c?.materialType || null,
    c?.gsm ? `${c.gsm} GSM` : null,
  ].filter(Boolean);
  return bits.length ? `${bits.join(" · ")} · manual cost` : "manual cost";
}

/** Sheets required vs the wastage run, when the layer carries a wastage %. */
function sheetDetail(est: MaterialEstimate): string {
  const total = est.totalSheets;
  if (!Number.isFinite(total)) return "—";
  const base = est.preWastageSheets;
  if (base == null || base >= total) return sheets(total);
  return `${sheets(total)} (${base} required + ${total - base} wastage)`;
}

/**
 * Build the section-wise view. `materials` is the recomputed Engine-1 output
 * for the same snapshot; pass undefined when it can't be recomputed (a legacy
 * estimate) and the rows degrade to cost-only.
 */
export function buildCostView(
  specs: EstimateRequest,
  cost: CostBreakdown,
  materials?: MaterialQuantities,
  // A trial account's own market dressing (lib/currency-meta.ts). Omitted —
  // as every offline validator in /scripts does — keeps the BRAND-based
  // `rate()` above, so existing output is byte-identical.
  money?: MoneyFormat,
): CostViewSection[] {
  // No divisor for a trial: their card is priced in its own currency, so
  // there is nothing to scale (see the note on `rate` above).
  const rateStr = money ? (n: number) => `${money.symbol}${n2(n)}` : rate;
  // Per-box always divides by the ORDERED quantity (client item 3).
  const orderedQty = cost.orderedQuantity ?? specs.quantity ?? 0;
  const per = (n: number) => (orderedQty > 0 ? n / orderedQty : 0);
  // Manual line edits (item 9), keyed by line so each row can show what the
  // engine originally computed beside the edited figure.
  const editedBy = new Map((cost.adjustments ?? []).map((a) => [a.line, a]));
  const row = (
    label: string,
    total: number,
    detail?: string,
    line?: AdjustableLine,
  ): CostViewRow => {
    const e = line ? editedBy.get(line) : undefined;
    return {
      label,
      detail,
      total,
      perBox: per(total),
      ...(line ? { line } : {}),
      ...(e
        ? { edited: { computed: e.computed, delta: e.delta, note: e.note, stale: e.stale } }
        : {}),
    };
  };
  const sections: CostViewSection[] = [];
  const push = (title: string, rows: (CostViewRow | null)[], line?: AdjustableLine) => {
    // An edited line stays visible even at 0 — the user set that deliberately.
    const kept = rows.filter(
      (r): r is CostViewRow => r != null && (r.total !== 0 || r.edited != null),
    );
    if (kept.length) {
      const e = line ? editedBy.get(line) : undefined;
      // When a SPLIT line was edited, the sub-rows still show the computed
      // breakdown (that's where the number came from) but the section total is
      // what's actually charged — so it must report the edited figure, not the
      // sum of the rows. The `edited` note below explains the difference.
      const summed = kept.length > 1 ? kept.reduce((s, r) => s + r.total, 0) : undefined;
      sections.push({
        title,
        rows: kept,
        total: e ? e.applied : summed,
        ...(line ? { line } : {}),
        ...(e
          ? { edited: { computed: e.computed, delta: e.delta, note: e.note, stale: e.stale } }
          : {}),
      });
    }
  };

  // --- Boards: number of boards, total, per box ---------------------------
  push("Boards", [
    cost.board
      ? row(
          "Kappa board",
          cost.board,
          materials
            ? `${specs.boardThickness_mm} mm · ${sheets(materials.board.totalSheets)} of ${dims(materials.board.sheet)}`
            : `${specs.boardThickness_mm} mm`,
          "board",
        )
      : null,
  ]);

  // --- Wrap layers: paper + printing, per group (client item 2) -----------
  for (const [layer, title] of [
    ["outer", "Outer"],
    ["inner", "Inner"],
  ] as const) {
    const groups = materials ? wrapGroupsOf(materials, layer) : [];
    const sel = layer === "outer" ? specs.wrapping?.outer : specs.wrapping?.inner;
    const paperTotal = layer === "outer" ? cost.outerPaper : cost.innerPaper;
    const printTotal = layer === "outer" ? cost.printing : (cost.innerPrinting ?? 0);
    // Round-10 tier itemisation; absent on pre-round-10 stored breakdowns, which
    // then render exactly as before.
    const printDetail =
      layer === "outer" ? cost.printingDetail : cost.innerPrintingDetail;
    // A layer is editable as ONE line; when per-component wrapping splits it
    // into several rows those rows share the line, so none is tagged.
    const paperLine: AdjustableLine = layer === "outer" ? "outerPaper" : "innerPaper";
    const printLine: AdjustableLine = layer === "outer" ? "printing" : "innerPrinting";

    // Paper: type – size – sheets required – wastage sheets – total – per box.
    const paperRows: (CostViewRow | null)[] = [];
    const printRows: (CostViewRow | null)[] = [];
    if (groups.length && paperTotal) {
      // Amounts are per-layer in the stored breakdown, so split them across
      // groups by their share of purchased sheets rather than inventing rates.
      const buyOf = (g: (typeof groups)[number]) =>
        g.purchase?.sheetsToBuy ?? g.material.totalSheets;
      const buyTotal = groups.reduce((s, g) => s + (Number.isFinite(buyOf(g)) ? buyOf(g) : 0), 0);
      const printedTotal = groups.reduce(
        (s, g) => s + (Number.isFinite(g.material.totalSheets) ? g.material.totalSheets : 0),
        0,
      );
      for (const g of groups) {
        const tag = groups.length > 1 && g.components.length
          ? ` (${g.components.map(pretty).join(", ")})`
          : "";
        const share = buyTotal > 0 ? buyOf(g) / buyTotal : 1 / groups.length;
        const bought = g.purchase?.sheetsToBuy;
        paperRows.push(
          row(
            `${title} paper${tag}`,
            paperTotal * share,
            [
              stockLabel(sel),
              dims(g.material.sheet),
              sheetDetail(g.material),
              bought != null ? `→ buy ${sheets(bought)}` : null,
            ]
              .filter(Boolean)
              .join(" · "),
          ),
        );
        if (printTotal && !printDetail?.length) {
          const pShare =
            printedTotal > 0 ? g.material.totalSheets / printedTotal : 1 / groups.length;
          printRows.push(
            row(
              `${title} printing${tag}`,
              printTotal * pShare,
              [printLabel(sel), sheets(g.material.totalSheets)].filter(Boolean).join(" · "),
            ),
          );
        }
      }
    } else {
      if (paperTotal)
        paperRows.push(row(`${title} paper`, paperTotal, stockLabel(sel), paperLine));
      if (printTotal && !printDetail?.length)
        printRows.push(row(`${title} printing`, printTotal, printLabel(sel), printLine));
    }
    push(`${title} paper`, paperRows);

    // Printing. Round 10: when the engine itemized the tiers, show them as
    // sub-rows (the real per-job plate + additional-1000 figures, which sum to
    // the charged total — the group rows above are only a prorated estimate)
    // and move the editable line to the SECTION, since no single tier row maps
    // 1:1 to the whitelisted `printing` line. The foamDetail precedent.
    if (printDetail?.length) {
      push(
        `${title} printing`,
        printDetail.map((d) =>
          row(d.label, d.amount, [printLabel(sel), sheets(d.sheets)].filter(Boolean).join(" · ")),
        ),
        printLine,
      );
    } else {
      push(`${title} printing`, printRows);
    }

    // Finishing: type – total – per box (already itemized in round 6).
    const detail = layer === "outer" ? cost.finishingDetail : cost.innerFinishingDetail;
    const finTotal = layer === "outer" ? cost.finishing : (cost.innerFinishing ?? 0);
    if (detail?.length) {
      push(`${title} finishing`, detail.map((d) => row(d.label, d.amount)));
    } else if (finTotal) {
      push(`${title} finishing`, [
        row(
          `${title} finishing`,
          finTotal,
          undefined,
          layer === "outer" ? "finishing" : "innerFinishing",
        ),
      ]);
    }
  }

  // --- Inserts ------------------------------------------------------------
  // Foam — the doc wants type + thickness + total + per box, and where a foam
  // carries a card cover: size, card type, sheets and the printing split. The
  // engine itemises the cost (cost.foamDetail); the specs supply the wording.
  const foamSels = specs.inserts?.foams ?? (specs.inserts?.foam ? [specs.inserts.foam] : []);
  const foamRowDetail = (i: number): string | undefined => {
    const f = foamSels[i];
    if (!f) return undefined;
    const est = materials?.foams?.[i];
    return [
      `${f.type} ${f.thickness_mm} mm`,
      `${n2(f.insert.length_in)} × ${n2(f.insert.width_in)} in`,
      est ? sheets(est.sheetsNeeded) : null,
      est?.cover ? `cover ${sheets(est.cover.sheetsNeeded)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  if (cost.foamDetail?.length) {
    // One row per cost line, each tagged with the foam it belongs to.
    push(
      "Foam",
      cost.foamDetail.map((d) => {
        // "Foam 2 cover stock" -> index 1; "Foam" / "Foam cover stock" -> 0.
        const m = /^Foam\s*(\d+)?/.exec(d.label);
        const idx = m?.[1] ? Number(m[1]) - 1 : 0;
        const f = foamSels[idx];
        const est = materials?.foams?.[idx];
        let detail: string | undefined;
        if (/cover stock$/.test(d.label)) {
          detail = [
            cardStockLabel(f?.cover),
            est?.cover
              ? sheets(est.cover.purchase?.sheetsToBuy ?? est.cover.sheetsNeeded)
              : null,
            est?.cover ? `${est.cover.piecesPerBox}/box` : null,
          ].filter(Boolean).join(" · ") || undefined;
        } else if (/cover printing$/.test(d.label)) {
          detail = [printJobLabel(f?.cover?.printing), est?.cover ? sheets(est.cover.sheetsNeeded) : null]
            .filter(Boolean).join(" · ") || undefined;
        } else if (/cover finishing$/.test(d.label)) {
          detail = (f?.cover?.finishing ?? []).map((x) => x.key).join(", ") || undefined;
        } else {
          detail = f
            ? [
                `${f.type} ${f.thickness_mm} mm`,
                `${n2(f.insert.length_in)} × ${n2(f.insert.width_in)} in`,
                est ? sheets(est.sheetsNeeded) : null,
              ].filter(Boolean).join(" · ")
            : undefined;
        }
        return row(d.label, d.amount, detail);
      }),
      "foam",
    );
  } else {
    push("Foam", [
      cost.foam
        ? row(
            "Foam inserts (incl. covers)",
            cost.foam,
            foamSels.map((_, i) => foamRowDetail(i)).filter(Boolean).join(" | ") || undefined,
            "foam",
          )
        : null,
    ]);
  }

  // Card-stock inserts: the doc asks for "paper type – size – total – per box",
  // so the stock (art paper / board type / special) leads the detail.
  const cardStock = (
    label: string,
    total: number | undefined,
    est: MaterialQuantities["beading"],
    stock?: { material: string; gsm?: number; boardType?: string; specialPaperName?: string },
  ): CostViewRow | null =>
    total
      ? row(
          label,
          total,
          est
            ? [
                cardStockLabel(stock),
                dims(est.paper.sheet),
                sheetDetail(est.paper),
                est.purchase ? `buy ${sheets(est.purchase.sheetsToBuy)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : cardStockLabel(stock) || undefined,
        )
      : null;

  push("Inserts & add-ons", [
    cost.reverseBoard
      ? row("Reverse board", cost.reverseBoard,
          materials?.reverseBoard ? sheets(materials.reverseBoard.board.totalSheets) : undefined, "reverseBoard")
      : null,
    cost.topPaper
      ? row("Reverse board top paper", cost.topPaper,
          materials?.reverseBoard?.topPaper ? sheets(materials.reverseBoard.topPaper.totalSheets) : undefined, "topPaper")
      : null,
    cardStock("Sleeve insert", cost.sleeve, materials?.sleeve, specs.inserts?.sleeve?.stock),
    cardStock("Beading", cost.beading, materials?.beading, specs.inserts?.beading?.stock),
    cardStock("Card partition", cost.cardPartition, materials?.cardPartitions, specs.inserts?.cardPartitions?.stock),
    cardStock("Custom card partition", cost.customPartition, materials?.customPartition, specs.inserts?.customPartition?.stock),
    cost.card ? row("Custom card insert", cost.card, customCardDetail(specs), "card") : null,
    cost.handles
      ? row("Handles", cost.handles,
          specs.addons?.handles ? `${specs.addons.handles.count} × ${specs.addons.handles.type}` : undefined, "handles")
      : null,
    cost.locks
      ? row("Locks", cost.locks,
          specs.addons?.locks ? `${specs.addons.locks.count} × ${specs.addons.locks.type}` : undefined, "locks")
      : null,
    cost.window
      ? row("Window film", cost.window,
          materials?.addons.window
            ? `${dims({ width_in: materials.addons.window.windowFootprint.length_in, height_in: materials.addons.window.windowFootprint.width_in })} · ${sheets(materials.addons.window.sheetsNeeded)}`
            : undefined, "window")
      : null,
    (cost.addonsMisc ?? 0)
      ? row("Miscellaneous add-ons", cost.addonsMisc!,
          (specs.addons?.misc ?? [])
            .map((m) => `${m.label} ×${m.units}${m.perBox ? "/box" : ""}`)
            .join(", ") || undefined, "addonsMisc")
      : null,
  ]);

  // --- Consumables: cost per box + total ----------------------------------
  const acc = cost.accessories;
  push("Consumables", [
    acc.magnets ? row("Magnets", acc.magnets, materials ? `${materials.accessories.magnets} pcs` : undefined) : null,
    acc.washers ? row("Washers", acc.washers, materials ? `${materials.accessories.washers} pcs` : undefined) : null,
    acc.tape ? row("Tape", acc.tape, materials ? `${materials.accessories.tape} units` : undefined) : null,
    acc.ribbonTag ? row("Ribbon tag", acc.ribbonTag, materials ? `${materials.accessories.ribbonTag} pcs` : undefined) : null,
    // Glue/metlock (client 21-Jul): show the real count when it was entered by
    // quantity, else note it was a direct cost entry.
    cost.glue
      ? row(
          "Glue",
          cost.glue,
          specs.manual?.glueQty
            ? `${n2(specs.manual.glueQty.qty)} ${specs.manual.glueQty.unit} × ${rateStr(specs.manual.glueQty.rate)}`
            : "manual cost",
          "glue",
        )
      : null,
    cost.metlock
      ? row(
          "Metlock",
          cost.metlock,
          specs.manual?.metlockQty
            ? `${n2(specs.manual.metlockQty.qty)} ${specs.manual.metlockQty.unit} × ${rateStr(specs.manual.metlockQty.rate)}`
            : "manual cost",
          "metlock",
        )
      : null,
  ]);

  // --- Labour: hours/days + total ----------------------------------------
  // Engine 2 stores one labour total, not per-line amounts, so the roles and
  // their hours/days ride along as the detail on a single row.
  push("Labour", [
    cost.labour
      ? row(
          "Labour",
          cost.labour,
          (specs.labour ?? [])
            .map((l) => `${l.role} ${l.quantity} ${l.unit}${l.quantity === 1 ? "" : "s"}`)
            .join(" · ") || undefined,
          "labour",
        )
      : null,
  ]);

  // --- One-time charges: name – units – cost ------------------------------
  // Client 28-Jul: when they're quoted separately they carry NO per-box share
  // (that's the whole point), so those rows are built without `perBox` and the
  // table shows a dash. "included" keeps the amortised figure.
  const separateCharges = cost.additionalMode === "separate";
  const chargeRow = (label: string, total: number, detail?: string): CostViewRow => ({
    label,
    detail,
    total,
    ...(separateCharges ? {} : { perBox: per(total) }),
  });
  const charges = [
    chargeDetail("Die", specs.additional?.die),
    chargeDetail("Mould", specs.additional?.mould),
    chargeDetail("Block", specs.additional?.block),
    chargeDetail("Designer", specs.additional?.designer),
  ].filter((d): d is NonNullable<typeof d> => d != null);
  push(
    separateCharges
      ? "One-time charges — billed separately (no margin)"
      : "Additional charges — included in box price (no margin)",
    charges.length
      ? charges.map((d) =>
          chargeRow(
            d.label,
            d.amount,
            d.qty != null && d.rate != null ? `${d.qty} × ${rateStr(d.rate)}` : undefined,
          ),
        )
      : [cost.additional.total ? chargeRow("One-time charges", cost.additional.total) : null],
  );

  return sections;
}
