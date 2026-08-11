"use client";

import { useState } from "react";

// Presentational result panel for a computed estimate: material quantities
// (sheets per component) + the cost breakdown. The cost may arrive WITHOUT the
// margin fields (Staff) — those rows simply don't render. No role logic here;
// the API already stripped what Staff may not see.

import { wrapGroupsOf } from "@/lib/engines/material";
import type {
  MaterialEstimate,
  MaterialQuantities,
  PaperPurchase,
} from "@/lib/engines/material";
import type { AdjustableLine, CostBreakdown, FinishingDetailLine } from "@/lib/engines/cost";
import type { ChargeDetail } from "@/lib/estimate/charges";
import type { CostViewSection } from "@/lib/estimate/cost-view";
import { formatMoney } from "@/lib/currency";
import { PrintPurchaseDiagram } from "./nesting-diagram";

/**
 * Cost as returned by the API — margin fields optional (absent for Staff).
 * `innerPrinting`/`innerFinishing`/`addonsMisc` are optional for backwards
 * compat with estimates saved before these fields existed.
 */
export type ResultCost = Omit<
  CostBreakdown,
  | "margin"
  | "subtotalAfterMargin"
  | "innerPrinting"
  | "innerFinishing"
  | "addonsMisc"
  | "sleeve"
  | "beading"
  | "cardPartition"
  | "customPartition"
> &
  Partial<
    Pick<
      CostBreakdown,
      | "margin"
      | "subtotalAfterMargin"
      | "innerPrinting"
      | "innerFinishing"
      | "addonsMisc"
      // Round-5 insert lines — absent on estimates saved before round 5.
      | "sleeve"
      | "beading"
      | "cardPartition"
      | "customPartition"
    >
  >;

/** What the auto printing pick chose (round 5) — from the API response. */
export interface AutoPickInfo {
  layer: "outer" | "inner";
  sizeLabel: string;
  paperSizeLabel: string;
  considered: number;
}

const inr = formatMoney;

const fmtDim = (n: number) =>
  Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);

/**
 * Section-wise cost breakdown (client final doc item 11): every line shows
 * what it is, how much of it, the total and the per-box share.
 */
export function CostViewTable({
  sections,
  onEditLine,
  onResetLine,
}: {
  sections: CostViewSection[];
  /**
   * Manual line edits (item 9). When given, every row that maps to a single
   * Level-1 line becomes click-to-edit and the caller re-costs. Omitted on
   * read-only views (the saved estimate detail page).
   */
  onEditLine?: (line: AdjustableLine, to: number, basis: number) => void;
  onResetLine?: (line: AdjustableLine) => void;
}) {
  // Which row is being edited, and its in-progress text.
  const [editing, setEditing] = useState<
    { line: AdjustableLine; value: string; basis: number } | null
  >(null);
  if (!sections.length) return null;

  const commit = () => {
    if (!editing) return;
    const n = parseFloat(editing.value);
    if (Number.isFinite(n) && n >= 0) onEditLine?.(editing.line, n, editing.basis);
    setEditing(null);
  };

  // Edits made against figures the engine no longer computes — the specs moved
  // underneath an absolute amount. Deliberately loud: a pinned figure that no
  // longer matches the job would otherwise quietly misprice it.
  const stale = [
    ...sections.filter((s) => s.edited?.stale).map((s) => s.title),
    ...sections.flatMap((s) => s.rows.filter((r) => r.edited?.stale).map((r) => r.label)),
  ];

  return (
    <div className="flex flex-col gap-4">
      {stale.length > 0 && (
        <div className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>
            {stale.length === 1 ? "An edited amount is" : `${stale.length} edited amounts are`} out
            of date.
          </strong>{" "}
          The specification changed after {stale.length === 1 ? "it was" : "they were"} edited, so{" "}
          {stale.join(", ")} {stale.length === 1 ? "is" : "are"} still pinned to the amount entered
          earlier and no longer reflects what the job now calculates. Re-enter{" "}
          {stale.length === 1 ? "it" : "them"} or reset to the calculated figure.
        </div>
      )}
      {sections.map((s) => (
        <div key={s.title} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {s.title}
            </h4>
            {/* When the rows SPLIT one cost line (itemised foam), the line is
                edited here at the section total — no single row owns it. */}
            {s.line && onEditLine ? (
              editing?.line === s.line ? (
                <input
                  autoFocus
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-28 rounded border px-2 py-0.5 text-right text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  value={editing.value}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setEditing((p) => (p ? { ...p, value: e.target.value } : null))}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  title="Click to edit this total — overhead, margin and the box price recalculate"
                  className={`text-xs tabular-nums transition-colors hover:text-primary ${s.edited ? "font-medium text-amber-700" : "text-muted-foreground"}`}
                  onClick={() =>
                    setEditing({
                      line: s.line!,
                      value: String(Math.round((s.total ?? s.rows.reduce((t, r) => t + r.total, 0)) * 100) / 100),
                      // Basis is what the ENGINE computes now, so a later spec
                      // change is detectable — not the previously edited value.
                      basis: s.edited?.computed ?? s.total ?? s.rows.reduce((t, r) => t + r.total, 0),
                    })
                  }
                >
                  {inr(s.total ?? s.rows.reduce((t, r) => t + r.total, 0))}
                </button>
              )
            ) : (
              s.total != null && (
                <span className="text-xs tabular-nums text-muted-foreground">{inr(s.total)}</span>
              )
            )}
          </div>
          {s.edited && (
            <p className="text-xs text-amber-700">
              Section total edited from {inr(s.edited.computed)} ({s.edited.delta >= 0 ? "+" : "−"}
              {inr(Math.abs(s.edited.delta))}){s.edited.note ? ` · ${s.edited.note}` : ""}
              {onResetLine && s.line && (
                <button
                  type="button"
                  className="ml-2 underline hover:no-underline"
                  onClick={() => onResetLine(s.line!)}
                >
                  reset
                </button>
              )}
            </p>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="font-normal">Item</th>
                <th className="text-right font-normal">Total</th>
                <th className="text-right font-normal">Per box</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r, i) => {
                const editable = onEditLine != null && r.line != null;
                // Bind the narrowed value so the input below doesn't re-read the
                // nullable state (TS can't narrow it across the JSX callbacks).
                const active = r.line != null && editing?.line === r.line ? editing : null;
                return (
                  <tr key={`${r.label}-${i}`} className="border-t align-top">
                    <td className="py-1">
                      <div>{r.label}</div>
                      {r.detail && (
                        <div className="text-xs text-muted-foreground">{r.detail}</div>
                      )}
                      {/* An edited line always shows what the engine computed,
                          so it never reads as a calculation error later. */}
                      {r.edited && (
                        <div className="text-xs text-amber-700">
                          Edited from {inr(r.edited.computed)} ({r.edited.delta >= 0 ? "+" : "−"}
                          {inr(Math.abs(r.edited.delta))})
                          {r.edited.note ? ` · ${r.edited.note}` : ""}
                          {onResetLine && r.line && (
                            <button
                              type="button"
                              className="ml-2 underline hover:no-underline"
                              onClick={() => onResetLine(r.line!)}
                            >
                              reset
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {active ? (
                        <input
                          autoFocus
                          type="number"
                          step="0.01"
                          min="0"
                          className="w-28 rounded border px-2 py-0.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          value={active.value}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) =>
                            setEditing((p) => (p ? { ...p, value: e.target.value } : null))
                          }
                          onBlur={commit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commit();
                            if (e.key === "Escape") setEditing(null);
                          }}
                        />
                      ) : editable ? (
                        <button
                          type="button"
                          title="Click to edit this amount — overhead, margin and the box price recalculate"
                          className={`tabular-nums transition-colors hover:text-primary ${r.edited ? "font-medium text-amber-700" : ""}`}
                          onClick={() =>
                            setEditing({
                              line: r.line!,
                              value: String(Math.round(r.total * 100) / 100),
                              basis: r.edited?.computed ?? r.total,
                            })
                          }
                        >
                          {inr(r.total)}
                        </button>
                      ) : (
                        inr(r.total)
                      )}
                    </td>
                    {/* No per-box share when the line isn't divided into the
                        box price (one-time charges quoted separately). */}
                    <td className="py-1 text-right tabular-nums">
                      {r.perBox != null ? inr(r.perBox) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {onEditLine && (
        <p className="text-xs text-muted-foreground">
          Click any amount above to edit it. Overhead, margin and the price per box
          recalculate from the edited figure, and the originally calculated amount is kept
          alongside it.
        </p>
      )}
    </div>
  );
}

/** "tray, lid" — names a wrap group's components in headings. */
const componentTag = (components: string[]) =>
  components.map((c) => c.replace(/_/g, " ")).join(", ");

/**
 * "What to actually buy" for one material — the client's 21-Jul ask to carry
 * the wrapping paper's summary onto the lining paper "and other sections too".
 * Rendered by MaterialTable itself, so every section (board, both wrap layers,
 * every card-stock insert, and any section added later) gets one by
 * construction rather than by remembering to add it.
 *
 * Printed layers quote the print run AND the purchased sheets, because those
 * differ: printing is charged on the print run, paper on what's bought.
 */
function MaterialSummary({
  est,
  purchase,
}: {
  est: MaterialEstimate;
  purchase?: PaperPurchase;
}) {
  if (!Number.isFinite(est.totalSheets)) return null;
  const s = (n: number) => (n === 1 ? "" : "s");
  if (purchase) {
    return (
      <p className="text-xs text-muted-foreground">
        Print run {purchase.printedSheets} sheet{s(purchase.printedSheets)} at{" "}
        <span className="tabular-nums">
          {fmtDim(purchase.printSheet.width_in)}×{fmtDim(purchase.printSheet.height_in)}
        </span>{" "}
        → buy{" "}
        <strong className="text-foreground">{purchase.sheetsToBuy}</strong> paper sheet
        {s(purchase.sheetsToBuy)} of{" "}
        <span className="tabular-nums">
          {fmtDim(purchase.paperSheet.width_in)}×{fmtDim(purchase.paperSheet.height_in)}
        </span>{" "}
        ({purchase.printsPerSheet} print{s(purchase.printsPerSheet)}/sheet). Paper is
        charged on the purchased count.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      Buy <strong className="text-foreground">{est.totalSheets}</strong> sheet
      {s(est.totalSheets)} of{" "}
      <span className="tabular-nums">
        {fmtDim(est.sheet.width_in)} × {fmtDim(est.sheet.height_in)} in
      </span>{" "}
      — no printing step, charged on this count.
    </p>
  );
}

/** How many pieces the engine rotated into the offcut, if it packed a mixed layout. */
function rotatedCount(
  mixed: { layout: { orientation: "A" | "B" }[] } | undefined,
  chosen: "A" | "B",
): number {
  return mixed ? mixed.layout.filter((r) => r.orientation !== chosen).length : 0;
}

/**
 * Buy-line for a FREE piece — foam, a foam cover, window film. Same shape as
 * MaterialSummary so the whole breakdown ends each section the same way, but
 * these have no per-component blank table above them (one piece, not a keyline).
 */
function PieceSummary({
  title,
  sheetsNeeded,
  piecesPerSheet,
  sheet,
  rotated = 0,
  purchase,
}: {
  title: string;
  sheetsNeeded: number;
  piecesPerSheet: number;
  sheet: { width_in: number; height_in: number };
  rotated?: number;
  /** Printed covers buy paper by the print size, like the wrap layers. */
  purchase?: PaperPurchase;
}) {
  if (!Number.isFinite(sheetsNeeded)) return null;
  const s = (n: number) => (n === 1 ? "" : "s");
  const buy = purchase?.sheetsToBuy ?? sheetsNeeded;
  const buySheet = purchase?.paperSheet ?? sheet;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-medium">{title}</h4>
        <span className="text-sm text-muted-foreground">
          {buy} sheet{s(buy)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {piecesPerSheet} piece{s(piecesPerSheet)}/sheet
        {rotated > 0 ? ` (${rotated} rotated to use the offcut)` : ""} · Buy{" "}
        <strong className="text-foreground">{buy}</strong> sheet{s(buy)} of{" "}
        <span className="tabular-nums">
          {fmtDim(buySheet.width_in)} × {fmtDim(buySheet.height_in)} in
        </span>
        .
      </p>
    </div>
  );
}

function MaterialTable({
  title,
  est,
  purchase,
}: {
  title: string;
  est: MaterialEstimate;
  /** Print-on-paper purchase, when this layer is printed. */
  purchase?: PaperPurchase;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-medium">{title}</h4>
        <span className="text-sm text-muted-foreground">
          {est.totalSheets} sheet{est.totalSheets === 1 ? "" : "s"}
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="font-normal">Component</th>
            <th className="font-normal">Blank (in)</th>
            <th className="text-right font-normal">Per sheet</th>
            <th className="text-right font-normal">Sheets</th>
          </tr>
        </thead>
        <tbody>
          {est.components.map((c) => (
            <tr key={c.component} className="border-t">
              <td className="py-1 capitalize">{c.component.replace(/_/g, " ")}</td>
              <td className="py-1">
                {fmtDim(c.blank.width_in)} × {fmtDim(c.blank.height_in)}
              </td>
              <td className="py-1 text-right">{c.perSheet}</td>
              <td className="py-1 text-right">{c.sheetsNeeded}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {est.combination?.applied &&
        (est.combination.combinedSheets < est.combination.separateSheets ? (
          <p className="text-xs text-muted-foreground">
            Combined cutting: parts share sheets, so the order needs{" "}
            <strong className="text-foreground">{est.combination.combinedSheets}</strong>{" "}
            sheets — not {est.combination.separateSheets} (the per-part totals above
            assume each part is cut on its own sheets). Charged on the combined count.
          </p>
        ) : (
          // Round 6: a sheet tie still wins on a printed layer — one shared
          // layout = one print job/plate instead of one per part.
          <p className="text-xs text-muted-foreground">
            Combined cutting: parts share sheets — same total (
            <strong className="text-foreground">{est.combination.combinedSheets}</strong>{" "}
            sheets) as cutting each part alone, but one shared layout means{" "}
            <strong className="text-foreground">one print job/plate</strong> instead of
            one per part.
          </p>
        ))}
      <MaterialSummary est={est} purchase={purchase} />
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between ${
        strong ? "font-semibold" : ""
      } ${muted ? "text-muted-foreground" : ""}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Finishing total with itemized per-pass sub-rows + per-box amounts (round 6 —
 * the client's repeated "foiling / lamination / UV separate, and what is the
 * charge per box"). Old estimates (no detail in the breakdown) keep the single
 * total row.
 */
export function FinishingRows({
  label,
  total,
  detail,
  qty,
}: {
  label: string;
  total: number;
  detail?: FinishingDetailLine[];
  qty: number;
}) {
  return (
    <>
      <Row label={label} value={inr(total)} />
      {(detail ?? []).map((d, i) => (
        <div
          key={`${d.label}-${i}`}
          className="flex items-baseline justify-between pl-4 text-xs text-muted-foreground"
        >
          <span>{d.label}</span>
          <span className="tabular-nums">
            {inr(d.amount)}
            {qty > 0 ? ` · ${inr(d.amount / qty)}/box` : ""}
          </span>
        </div>
      ))}
    </>
  );
}

export function ResultPanel({
  materials,
  cost,
  additionalDetail,
  autoPicks,
  costView,
  onEditLine,
  onResetLine,
}: {
  materials: MaterialQuantities;
  cost: ResultCost;
  /**
   * Itemized one-time charges (qty × rate) from the estimate's specs snapshot
   * (round 3). When absent the plain per-type amounts from `cost` render.
   */
  additionalDetail?: ChargeDetail[];
  /** Auto-printing picks (round 5) — which size/paper won, out of how many. */
  autoPicks?: AutoPickInfo[];
  /**
   * Section-wise breakdown (client final doc item 11). When given it renders
   * ABOVE the running cost ladder, which stays as the level-1/2/margin trail.
   */
  costView?: CostViewSection[];
  /** Manual line edits (item 9) — omitted makes the breakdown read-only. */
  onEditLine?: (line: AdjustableLine, to: number, basis: number) => void;
  onResetLine?: (line: AdjustableLine) => void;
}) {
  const acc = cost.accessories;

  return (
    <div className="flex flex-col gap-6">
      {/* Auto-economical printing (round 5): show what the server picked. */}
      {(autoPicks ?? []).length > 0 && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
          {autoPicks!.map((p) => (
            <p key={p.layer}>
              Print size ({p.layer}, auto): <strong>{p.sizeLabel}</strong> on{" "}
              <strong>{p.paperSizeLabel}</strong> paper — cheapest of {p.considered}{" "}
              option{p.considered === 1 ? "" : "s"} compared.
            </p>
          ))}
        </div>
      )}

      {/* Materials */}
      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold">Materials (qty {materials.quantity})</h3>
        <MaterialTable title="Board" est={materials.board} />
        {/* Wrap layers (client item 2): one block per group — a single block
            unless components carry different paper/print/finish. */}
        {wrapGroupsOf(materials, "outer").map((g, i, all) => (
          <div key={`outer-${i}`} className="flex flex-col gap-1">
            <MaterialTable
              title={`Wrapping paper (outer)${all.length > 1 ? ` — ${componentTag(g.components)}` : ""}`}
              est={g.material}
              purchase={g.purchase}
            />
            {g.purchase && (
              <PrintPurchaseDiagram
                purchase={g.purchase}
                label={`Wrapping print on paper${all.length > 1 ? ` — ${componentTag(g.components)}` : ""}`}
              />
            )}
          </div>
        ))}
        {wrapGroupsOf(materials, "inner").map((g, i, all) => (
          <div key={`inner-${i}`} className="flex flex-col gap-1">
            {/* The summary line now comes from MaterialTable for BOTH the
                printed and the unprinted case (client 21-Jul), so the lining
                reads exactly like the wrapping paper above it. */}
            <MaterialTable
              title={`Lining paper (inner)${all.length > 1 ? ` — ${componentTag(g.components)}` : ""}`}
              est={g.material}
              purchase={g.purchase}
            />
            {g.purchase && (
              <PrintPurchaseDiagram
                purchase={g.purchase}
                label={`Lining print on paper${all.length > 1 ? ` — ${componentTag(g.components)}` : ""}`}
              />
            )}
          </div>
        ))}
        {/* Round-5 inserts (client 13-Jul; sleeve = card stock since round 6). */}
        {materials.sleeve && (
          <div className="flex flex-col gap-1">
            <MaterialTable
              title="Sleeve insert"
              est={materials.sleeve.paper}
              purchase={materials.sleeve.purchase}
            />
            {materials.sleeve.purchase && (
              <PrintPurchaseDiagram purchase={materials.sleeve.purchase} label="Sleeve print on paper" />
            )}
          </div>
        )}
        {materials.beading && (
          <MaterialTable
            title="Beading"
            est={materials.beading.paper}
            purchase={materials.beading.purchase}
          />
        )}
        {materials.cardPartitions && (
          <MaterialTable
            title="Card partitions"
            est={materials.cardPartitions.paper}
            purchase={materials.cardPartitions.purchase}
          />
        )}
        {materials.customPartition && (
          <MaterialTable
            title="Custom card partition"
            est={materials.customPartition.paper}
            purchase={materials.customPartition.purchase}
          />
        )}

        {/* Foam + window film get the same "what to buy" summary as the sheet
            materials above (client 21-Jul: the other sections too). A cover is
            a different stock, so it gets its own line rather than a suffix. */}
        {(materials.foams ?? []).map((f, i, all) => (
          <div key={`foam-${i}`} className="flex flex-col gap-2">
            <PieceSummary
              title={`Foam insert${all.length > 1 ? ` ${i + 1}` : ""}`}
              sheetsNeeded={f.sheetsNeeded}
              piecesPerSheet={f.piecesPerSheet}
              sheet={f.foamSheet}
              rotated={rotatedCount(f.mixed, f.chosen)}
            />
            {f.cover && (
              <PieceSummary
                title={`Foam cover (×${f.cover.piecesPerBox}/box)`}
                sheetsNeeded={f.cover.sheetsNeeded}
                piecesPerSheet={f.cover.piecesPerSheet}
                sheet={f.cover.sheet}
                rotated={rotatedCount(f.cover.mixed, f.cover.chosen)}
                purchase={f.cover.purchase}
              />
            )}
          </div>
        ))}
        {materials.addons.window && materials.addons.window.sheetsNeeded > 0 && (
          <PieceSummary
            title="Window film"
            sheetsNeeded={materials.addons.window.sheetsNeeded}
            piecesPerSheet={materials.addons.window.piecesPerSheet}
            sheet={materials.addons.window.filmSheet}
            rotated={rotatedCount(materials.addons.window.mixed, materials.addons.window.chosen)}
          />
        )}

        <div className="text-sm text-muted-foreground">
          {materials.accessories.tape > 0 && (
            <span>Tape: {materials.accessories.tape} units. </span>
          )}
          {materials.accessories.magnets > 0 && (
            <span>
              Magnets: {materials.accessories.magnets}, washers:{" "}
              {materials.accessories.washers}.{" "}
            </span>
          )}
          {materials.accessories.ribbonTag > 0 && (
            <span>Ribbon tags: {materials.accessories.ribbonTag}. </span>
          )}
          {materials.addons.handles > 0 && (
            <span>Handles: {materials.addons.handles}. </span>
          )}
          {materials.addons.locks > 0 && (
            <span>Locks: {materials.addons.locks}. </span>
          )}
        </div>
      </section>

      {/* Section-wise breakdown (client item 11) — quantities, sizes, totals
          and a per-box figure on every line. */}
      {costView && costView.length > 0 && (
        <section className="flex flex-col gap-3 border-t pt-4">
          <h3 className="text-sm font-semibold">Raw materials & rates</h3>
          <CostViewTable sections={costView} onEditLine={onEditLine} onResetLine={onResetLine} />
        </section>
      )}

      {/* Cost */}
      <section className="flex flex-col gap-1.5 border-t pt-4">
        <h3 className="mb-1 text-sm font-semibold">Cost breakdown</h3>

        {/* --- Raw materials --- */}
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Raw materials</span>
        {cost.board > 0 && <Row label="Board" value={inr(cost.board)} />}
        {cost.outerPaper > 0 && <Row label="Wrapping paper" value={inr(cost.outerPaper)} />}
        {cost.innerPaper > 0 && <Row label="Lining paper" value={inr(cost.innerPaper)} />}
        {cost.printing > 0 && <Row label="Printing (outer)" value={inr(cost.printing)} />}
        {(cost.innerPrinting ?? 0) > 0 && <Row label="Printing (inner)" value={inr(cost.innerPrinting!)} />}
        {cost.finishing > 0 && (
          <FinishingRows
            label="Finishing (outer)"
            total={cost.finishing}
            detail={cost.finishingDetail}
            qty={materials.quantity}
          />
        )}
        {(cost.innerFinishing ?? 0) > 0 && (
          <FinishingRows
            label="Finishing (inner)"
            total={cost.innerFinishing!}
            detail={cost.innerFinishingDetail}
            qty={materials.quantity}
          />
        )}
        {cost.foam > 0 && <Row label="Foam inserts (incl. covers)" value={inr(cost.foam)} />}
        {cost.reverseBoard > 0 && <Row label="Reverse board" value={inr(cost.reverseBoard)} />}
        {cost.topPaper > 0 && <Row label="Top paper" value={inr(cost.topPaper)} />}
        {cost.card > 0 && <Row label="Custom card insert" value={inr(cost.card)} />}
        {(cost.sleeve ?? 0) > 0 && <Row label="Sleeve insert" value={inr(cost.sleeve!)} />}
        {(cost.beading ?? 0) > 0 && <Row label="Beading" value={inr(cost.beading!)} />}
        {(cost.cardPartition ?? 0) > 0 && <Row label="Card partition" value={inr(cost.cardPartition!)} />}
        {(cost.customPartition ?? 0) > 0 && <Row label="Custom card partition" value={inr(cost.customPartition!)} />}
        {cost.handles > 0 && <Row label="Handles" value={inr(cost.handles)} />}
        {cost.locks > 0 && <Row label="Locks" value={inr(cost.locks)} />}
        {cost.window > 0 && <Row label="Window film" value={inr(cost.window)} />}
        {(cost.addonsMisc ?? 0) > 0 && <Row label="Add-ons (misc)" value={inr(cost.addonsMisc!)} />}
        {acc.magnets > 0 && <Row label="Magnets" value={inr(acc.magnets)} />}
        {acc.washers > 0 && <Row label="Washers" value={inr(acc.washers)} />}
        {acc.tape > 0 && <Row label="Tape" value={inr(acc.tape)} />}
        {acc.ribbonTag > 0 && <Row label="Ribbon tag" value={inr(acc.ribbonTag)} />}
        {cost.glue > 0 && <Row label="Glue" value={inr(cost.glue)} />}
        {cost.metlock > 0 && <Row label="Metlock" value={inr(cost.metlock)} />}
        <Row label="Materials subtotal" value={inr(cost.materialSubtotal)} strong />

        {/* --- Labour --- */}
        {cost.labour > 0 && (
          <>
            <div className="mt-1" />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Labour</span>
            <Row label="Labour total" value={inr(cost.labour)} strong />
          </>
        )}

        {/* --- Level summaries --- */}
        <div className="my-1 border-t" />
        <Row label="Level 1 (materials + labour)" value={inr(cost.level1)} strong />
        <Row label="Overhead" value={inr(cost.overhead)} muted />
        <Row label="Level 2 (before margin)" value={inr(cost.costBeforeMargin)} />
        {cost.margin !== undefined && (
          <Row label="Margin" value={inr(cost.margin)} muted />
        )}

        {/* --- One-time charges. Client 28-Jul: `separate` keeps them out of the
             per-box rate and quotes them as their own line; `included` divides
             them into every box (the pre-28-Jul behaviour, and what every
             estimate saved before the toggle did). --- */}
        {cost.additional.total > 0 && (
          <>
            <div className="my-1 border-t" />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {cost.additionalMode === "separate"
                ? "One-time charges — billed separately (no margin)"
                : "Additional charges (no margin)"}
            </span>
            {additionalDetail && additionalDetail.length > 0 ? (
              // Itemized (round 3): "Die (2 × ₹1,500)" from the specs snapshot.
              additionalDetail.map((d) => (
                <Row
                  key={d.label}
                  label={d.qty != null && d.rate != null ? `${d.label} (${d.qty} × ${inr(d.rate)})` : d.label}
                  value={inr(d.amount)}
                />
              ))
            ) : (
              <>
                {cost.additional.die > 0 && <Row label="Die" value={inr(cost.additional.die)} />}
                {cost.additional.mould > 0 && <Row label="Mould" value={inr(cost.additional.mould)} />}
                {cost.additional.block > 0 && <Row label="Block" value={inr(cost.additional.block)} />}
                {cost.additional.designer > 0 && <Row label="Designer" value={inr(cost.additional.designer)} />}
              </>
            )}
          </>
        )}

        <div className="my-1 border-t" />
        {cost.additionalMode === "separate" && cost.additional.total > 0 ? (
          <>
            {/* Staff have subtotalAfterMargin stripped, so derive the box
                subtotal the same way splitEstimateTotals does. */}
            <Row label="Box subtotal (pre-GST)" value={inr(cost.total - cost.additional.total)} />
            <Row label="Price per box (boxes only)" value={inr(cost.pricePerBox)} strong />
            <Row label="One-time charges" value={inr(cost.additional.total)} muted />
            <Row label="Total (pre-GST)" value={inr(cost.total)} strong />
          </>
        ) : (
          <>
            <Row label="Total (pre-GST)" value={inr(cost.total)} strong />
            <Row label="Price per box" value={inr(cost.pricePerBox)} strong />
          </>
        )}
        {/* Two quantities (client item 3): costed on the production run, but
            quoted per ordered box, so the wastage is carried by the order. */}
        {cost.orderedQuantity != null &&
          cost.productionQuantity != null &&
          cost.productionQuantity > cost.orderedQuantity && (
            <p className="text-xs text-muted-foreground">
              Costed for {cost.productionQuantity.toLocaleString("en-IN")} produced boxes,
              divided by {cost.orderedQuantity.toLocaleString("en-IN")} ordered.
            </p>
          )}
      </section>
    </div>
  );
}
