import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, FileDown, Layers, RefreshCw } from "lucide-react";

import { verifySession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import { loadEstimateDetail } from "@/lib/db/estimates";
import { recomputeMaterials } from "@/lib/estimate/build-estimate";
import { buildCostView } from "@/lib/estimate/cost-view";
import type { CostBreakdown } from "@/lib/engines/cost";
import { chargeDetail, type ChargeDetail } from "@/lib/estimate/charges";
import { boxLabel } from "@/lib/box-types";
import { buttonVariants } from "@/components/ui/button";
import { FinishingRows, ResultPanel, type ResultCost } from "@/components/estimate/result-panel";
import type { MaterialQuantities } from "@/lib/engines/material";
import { formatMoney } from "@/lib/currency";

const fmt = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const inr = formatMoney;

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
      className={`flex items-baseline justify-between ${strong ? "font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function CostBreakdownView({ cost, qty }: { cost: ResultCost; qty: number }) {
  const acc = cost.accessories;
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      {cost.board > 0 && <Row label="Board" value={inr(cost.board)} />}
      {cost.outerPaper > 0 && (
        <Row label="Wrapping paper" value={inr(cost.outerPaper)} />
      )}
      {cost.innerPaper > 0 && (
        <Row label="Lining paper" value={inr(cost.innerPaper)} />
      )}
      {cost.printing > 0 && (
        <Row label="Printing" value={inr(cost.printing)} />
      )}
      {cost.finishing > 0 && (
        <FinishingRows
          label="Finishing"
          total={cost.finishing}
          detail={cost.finishingDetail}
          qty={qty}
        />
      )}
      {cost.foam > 0 && (
        <Row label="Insert: foam" value={inr(cost.foam)} />
      )}
      {cost.reverseBoard > 0 && (
        <Row label="Insert: reverse board" value={inr(cost.reverseBoard)} />
      )}
      {cost.topPaper > 0 && (
        <Row label="Insert: top paper" value={inr(cost.topPaper)} />
      )}
      {cost.card > 0 && (
        <Row label="Insert: card" value={inr(cost.card)} />
      )}
      {cost.handles > 0 && <Row label="Handles" value={inr(cost.handles)} />}
      {cost.locks > 0 && <Row label="Locks" value={inr(cost.locks)} />}
      {cost.window > 0 && <Row label="Window film" value={inr(cost.window)} />}
      {acc.magnets > 0 && <Row label="Magnets" value={inr(acc.magnets)} />}
      {acc.washers > 0 && <Row label="Washers" value={inr(acc.washers)} />}
      {acc.tape > 0 && <Row label="Tape" value={inr(acc.tape)} />}
      {acc.ribbonTag > 0 && (
        <Row label="Ribbon tag" value={inr(acc.ribbonTag)} />
      )}
      {cost.glue > 0 && <Row label="Glue" value={inr(cost.glue)} />}
      {cost.metlock > 0 && (
        <Row label="Metlock" value={inr(cost.metlock)} />
      )}
      <div className="my-1 border-t" />
      <Row label="Materials subtotal" value={inr(cost.materialSubtotal)} />
      {cost.labour > 0 && (
        <Row label="Labour" value={inr(cost.labour)} />
      )}
      <Row
        label="Level 1 (RM + labour)"
        value={inr(cost.level1)}
        strong
      />
      <Row
        label={`Overhead (${cost.overhead > 0 ? "11" : "0"}%)`}
        value={inr(cost.overhead)}
        muted
      />
      <Row label="Level 2" value={inr(cost.costBeforeMargin)} />
      {cost.margin !== undefined && (
        <Row label="Margin" value={inr(cost.margin)} muted />
      )}
      {cost.additional.total > 0 && (
        <Row
          label={
            cost.additionalMode === "separate"
              ? "One-time charges (billed separately)"
              : "Additional charges"
          }
          value={inr(cost.additional.total)}
          muted
        />
      )}
      <div className="my-1 border-t" />
      {/* Separate mode (client 28-Jul): the per-box rate covers boxes only, so
          show the box subtotal it divides rather than implying the total. */}
      {cost.additionalMode === "separate" && cost.additional.total > 0 && (
        <Row
          label="Box subtotal (pre-GST)"
          value={inr(cost.total - cost.additional.total)}
        />
      )}
      <Row label="Total (pre-GST)" value={inr(cost.total)} strong />
      <Row
        label={
          cost.additionalMode === "separate" && cost.additional.total > 0
            ? "Price per box (boxes only)"
            : "Price per box"
        }
        value={inr(cost.pricePerBox)}
        strong
      />
    </div>
  );
}

export default async function EstimateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await verifySession();
  if (!session) redirect("/login");

  const { id } = await params;
  const est = await loadEstimateDetail(createAdminClient(), id);
  if (!est) notFound();

  // Strip margin for staff at the API boundary (same as the calculate route).
  let cost: ResultCost | null = null;
  if (est.cost_breakdown) {
    if (session.role === "admin") {
      cost = est.cost_breakdown as ResultCost;
    } else {
      const { margin: _m, subtotalAfterMargin: _s, ...staffView } =
        est.cost_breakdown;
      void _m;
      void _s;
      cost = staffView as ResultCost;
    }
  }

  const specs = est.specs_snapshot;

  // Materials (sheet counts, nesting, print-on-paper purchase) aren't persisted
  // — only cost_breakdown is. Recompute from the frozen specs_snapshot +
  // rates_snapshot (no fresh DB rates read, so this can never drift from what
  // was actually costed). Falls back to the cost-only view below for a legacy
  // or malformed snapshot the current engine can't parse.
  let materials: MaterialQuantities | null = null;
  if (cost) {
    try {
      materials = recomputeMaterials(specs, est.rates_snapshot);
    } catch {
      materials = null;
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-start gap-3">
        <Link
          href="/estimates"
          className="mt-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            {est.name || boxLabel(est.box_type)}
          </h1>
          <p className="text-xs text-muted-foreground">
            {est.name ? `${boxLabel(est.box_type)} · ` : ""}
            {est.client_name ? `${est.client_name} · ` : ""}
            {fmt(est.created_at)}
            {est.created_by_name ? ` · by ${est.created_by_name}` : ""}
            {est.status ? (
              <span className="ml-2 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize">
                {est.status}
              </span>
            ) : null}
          </p>
        </div>
        <Link
          href={`/estimate?from=${est.id}`}
          className={buttonVariants({ size: "sm", variant: "outline" })}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Re-run
        </Link>
        {/* Raw-materials PDF (round 6) — needs a recomputable snapshot, which
            `materials` already proves; hidden for legacy estimates. */}
        {materials && (
          <a
            href={`/api/estimate/${est.id}/materials`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ size: "sm", variant: "outline" })}
          >
            <Layers className="mr-2 h-4 w-4" />
            Materials PDF
          </a>
        )}
        <a
          href={`/api/estimate/${est.id}/quote`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ size: "sm" })}
        >
          <FileDown className="mr-2 h-4 w-4" />
          Download quote
        </a>
      </div>

      {/* Specifications */}
      <section className="rounded-lg border p-4 text-sm">
        <h2 className="mb-3 font-medium">Specifications</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-1">
          <dt className="text-muted-foreground">Dimensions (L×W×H)</dt>
          <dd>
            {specs.dims.length_in} × {specs.dims.width_in} ×{" "}
            {specs.dims.height_in} in
          </dd>
          <dt className="text-muted-foreground">Quantity</dt>
          <dd>{specs.quantity.toLocaleString()}</dd>
          <dt className="text-muted-foreground">Board thickness</dt>
          <dd>{specs.boardThickness_mm} mm</dd>
          {specs.wrapping?.outer && (
            <>
              <dt className="text-muted-foreground">Outer wrap</dt>
              <dd>
                {specs.wrapping.outer.mode === "printed"
                  ? `Printed ${specs.wrapping.outer.paperSizeLabel} ${specs.wrapping.outer.gsm} GSM`
                  : `Special: ${specs.wrapping.outer.specialPaperName}`}
              </dd>
            </>
          )}
          {specs.wrapping?.inner && (
            <>
              <dt className="text-muted-foreground">Inner lining</dt>
              <dd>
                {specs.wrapping.inner.mode === "special"
                  ? `Special: ${specs.wrapping.inner.specialPaperName}`
                  : specs.wrapping.inner.mode === "white"
                    ? `White ${specs.wrapping.inner.paperSizeLabel} ${specs.wrapping.inner.gsm} GSM`
                    : `${specs.wrapping.inner.printing ? "Printed " : ""}${specs.wrapping.inner.paperSizeLabel} ${specs.wrapping.inner.gsm} GSM`}
                {specs.wrapping.inner.finishing?.length
                  ? ` · ${specs.wrapping.inner.finishing.map((f) => `${f.kind} (${f.key})`).join(", ")}`
                  : ""}
              </dd>
            </>
          )}
          {specs.finishing && specs.finishing.length > 0 && (
            <>
              <dt className="text-muted-foreground">Finishing</dt>
              <dd>
                {specs.finishing
                  .map((f) => `${f.kind} (${f.key})`)
                  .join(", ")}
              </dd>
            </>
          )}
        </dl>
      </section>

      {/* Materials + cost breakdown */}
      {cost && materials ? (
        <section className="rounded-lg border p-4">
          <ResultPanel
            materials={materials}
            cost={cost}
            // Section-wise breakdown (client final doc item 11).
            costView={buildCostView(specs, cost as CostBreakdown, materials)}
            // Auto-printing picks (round 5) frozen in the rates snapshot.
            autoPicks={est.rates_snapshot?.autoPicks}
            additionalDetail={
              // Itemized one-time charges (round 3): qty × rate from the snapshot.
              [
                chargeDetail("Die", specs.additional?.die),
                chargeDetail("Mould", specs.additional?.mould),
                chargeDetail("Block", specs.additional?.block),
                chargeDetail("Designer", specs.additional?.designer),
              ].filter((d): d is ChargeDetail => d !== null)
            }
          />
        </section>
      ) : cost ? (
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium text-sm">Cost breakdown</h2>
          <CostBreakdownView cost={cost} qty={specs.quantity} />
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          No cost breakdown stored for this estimate.
        </p>
      )}
    </div>
  );
}
