import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CostBreakdown } from "@/lib/engines/cost";
import type { CurrencyCode, EstimateRequest } from "@/types";
import { chargeDetail, type ChargeDetail } from "@/lib/estimate/charges";
import { boxLabel } from "@/lib/box-types";
import { BRAND } from "@/lib/brand";
// COMPANY + specsLines moved to quote-shared.ts (round 6): they are pure and
// the raw-materials PDF builder + offline scripts need them without
// server-only. Re-exported here so existing imports keep working.
import { COMPANY, specsLines } from "@/lib/pdf/quote-shared";

export { COMPANY, specsLines };

export const BANK = BRAND.bank;

/**
 * Quote-number prefix (round 3: real FY sequence <prefix>/26-27/001). Comes from the
 * brand config (not app_config — that table is numeric-only), so a rebrand or
 * the demo deployment changes it in one place.
 */
export const QUOTE_PREFIX = BRAND.quotePrefix;

// Editable-per-quote defaults; kept verbatim from the client's template, plus
// the two return-policy lines the client asked for on 7-Jul.
export const DEFAULT_TERMS = [
  "Payment Terms: 50% advance upon order confirmation; balance before dispatch",
  "Lead Time: 15 working days from order confirmation and advance payment",
  "Revision: Any change to the existing specifications or quantity will lead to change in prices",
  "Delivery: Ex-Works, Bangalore (freight charges as applicable)",
  "Validity: This quotation is valid for 15 days from the date of issue",
  "Samples: Sample charges may apply and will be adjusted against bulk order",
  "Artwork: Customer to provide print-ready artwork; design support chargeable separately",
  "Goods once sold cannot be returned.",
  "In case of defects, products should be returned within 3 days of delivery for replacement. No return will be accepted beyond that.",
];

const QUOTE_VALIDITY_DAYS = 15;
// GST: 5% on box price; 18% on additional charges (die/mould/block/designer).
const BOX_GST_PCT = 5;
const ADDL_GST_PCT = 18;

export interface QuoteItem {
  sNo: number;
  description: string;
  /** Structured spec lines (client 4-Jul format); rendered one per line on the PDF. */
  specsLines: string[];
  /** @deprecated pre-round-3 single-line specs; only for rendering old stored data. */
  specs?: string;
  qty: number;
  unitPrice: number;
  total: number;
  /** One-time charges for this estimate, itemized (die/mould/block with qty × rate). */
  additionalDetail?: ChargeDetail[];
  /** Sum of additionalDetail (18% GST, printed separately — no margin). */
  additionalTotal?: number;
}

export interface GstLine {
  label: string; // e.g. "GST @ 5% (boxes)"
  pct: number;
  base: number;
  amount: number;
}

export interface QuotationData {
  quoteNo: string;
  issueDate: string;
  validUntil: string;
  preparedBy: string;
  billTo: { company: string; contact: string | null };
  items: QuoteItem[];
  subTotal: number;
  additionalSubTotal: number; // sum of all additional charges (18% GST)
  gstLines: GstLine[];
  grandTotal: number;
  terms: string[];
  /** Free-text "Additional Notes" block (round 10; from the client's template). */
  notes?: string;
  /**
   * Market this quote is priced in. Absent on every quote saved before
   * multi-currency, and on every admin/staff quote, which the PDF renders
   * with the deployment's own BRAND dressing exactly as before.
   */
  currency?: CurrencyCode;
  company: typeof COMPANY;
  bank: typeof BANK;
}

/**
 * One line item as EDITED on the quote preview screen (round 10, client 5-Aug:
 * "a window where I am able to make necessary changes and then that gets
 * converted into a PDF"). Only the fields a human types — every total is
 * recomputed server-side by `finalizeQuoteDraft`, never taken from the client.
 */
export interface QuoteDraftItem {
  description: string;
  specsLines: string[];
  qty: number;
  unitPrice: number;
  /** One-time charges (die/mould/block/designer), each a label + amount. */
  additionalDetail?: ChargeDetail[];
}

/** A fully-edited quote, ready to be numbered, saved and rendered. */
export interface QuoteDraft {
  billTo: { company: string; contact: string | null };
  items: QuoteDraftItem[];
  terms: string[];
  notes?: string;
}

/** Per-item edits from the quote builder (client 4-Jul: "can the quote be editable"). */
export interface QuoteItemOverride {
  description?: string;
  /** Full replacement spec text; split on newlines into specsLines. */
  specsText?: string;
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

/**
 * Indian financial-year label (Apr–Mar) for a date: 2026-07-10 -> "26-27",
 * 2027-02-01 -> "26-27", 2027-04-01 -> "27-28".
 */
export function fyLabel(d: Date): string {
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  const yy = (y: number) => String(y % 100).padStart(2, "0");
  return `${yy(startYear)}-${yy(startYear + 1)}`;
}

/** Format a running number into the company's sequence: <prefix>/26-27/001. */
export function formatQuoteNo(fy: string, n: number): string {
  return `${QUOTE_PREFIX}/${fy}/${String(n).padStart(3, "0")}`;
}

/**
 * Fallback quote number when the DB sequence isn't available yet (pre-round-3
 * DB): the old estimate-id / timestamp derived format.
 */
export function fallbackQuoteNo(seed: string, year: number): string {
  const short = seed.replace(/-/g, "").slice(0, 5).toUpperCase();
  return `${QUOTE_PREFIX}/${year}/${short}`;
}

/** Itemized one-time charges for an estimate (from its frozen specs snapshot). */
export function additionalDetails(specs: EstimateRequest): ChargeDetail[] {
  const a = specs.additional;
  if (!a) return [];
  return [
    chargeDetail("Die", a.die),
    chargeDetail("Mould", a.mould),
    chargeDetail("Block", a.block),
    chargeDetail("Designer", a.designer),
  ].filter((d): d is ChargeDetail => d !== null);
}

/** Exported for scripts/validate-round9.ts (the 5%/18% split is the reason the
 *  included/separate toggle matters at quote stage).
 *
 *  GST is INDIA-ONLY. A trial account evaluating from another market gets NO
 *  tax line at all rather than an Indian one relabelled: their quote is a
 *  pre-tax figure, which is honest, whereas charging 5% "GST" on a London
 *  order is not. Proper VAT / US sales tax needs per-line rates, registration
 *  numbers and a CGST/SGST/IGST-style split — a different shape entirely, and
 *  still a documented gap (see CLAUDE.md "Known gaps"). `currency` omitted =
 *  INR = every existing caller, so admin/staff quotes are unchanged. */
export function buildGstLines(
  boxSubtotal: number,
  additionalSubtotal: number,
  currency: CurrencyCode = "INR",
): GstLine[] {
  if (currency !== "INR") return [];
  const lines: GstLine[] = [];
  if (boxSubtotal > 0) {
    lines.push({
      label: `GST @ ${BOX_GST_PCT}% (boxes)`,
      pct: BOX_GST_PCT,
      base: boxSubtotal,
      amount: (boxSubtotal * BOX_GST_PCT) / 100,
    });
  }
  if (additionalSubtotal > 0) {
    lines.push({
      label: `GST @ ${ADDL_GST_PCT}% (additional charges)`,
      pct: ADDL_GST_PCT,
      base: additionalSubtotal,
      amount: (additionalSubtotal * ADDL_GST_PCT) / 100,
    });
  }
  return lines;
}

interface EstimateRow {
  id: string;
  box_type: string;
  quantity: number;
  specs_snapshot: EstimateRequest;
  cost_breakdown: CostBreakdown | null;
  price_per_box: number | null;
  total_price: number | null;
  client_id: string | null;
}

/**
 * Split an estimate's stored money into (box subtotal, additional charges).
 * IMPORTANT (round-3 fix): `total_price` (= cost.total) already CONTAINS the
 * additional charges — the old quote code used total_price as the box subtotal
 * AND added additional again, double-counting them and charging 5% GST on a
 * base that also carried the 18%-GST charges. The box subtotal is
 * `subtotalAfterMargin` (everything margined, before additional).
 *
 * Round 9 (client 28-Jul): an estimate costed with additionalMode "included"
 * sells the tooling as part of the box supply — it rides in the unit price and
 * is taxed at the box rate, so there is nothing to split off. Absent mode =
 * the legacy split above, unchanged.
 * Exported for scripts/validate-round3.ts + validate-round9.ts.
 */
export function splitEstimateTotals(est: {
  cost_breakdown: CostBreakdown | null;
  total_price: number | null;
}): { boxSubtotal: number; additionalTotal: number } {
  const cost = est.cost_breakdown;
  const additionalTotal = cost?.additional?.total ?? 0;
  const boxSubtotal =
    cost?.subtotalAfterMargin ??
    (est.total_price ?? cost?.total ?? 0) - additionalTotal;
  if (cost?.additionalMode === "included") {
    return { boxSubtotal: boxSubtotal + additionalTotal, additionalTotal: 0 };
  }
  return { boxSubtotal, additionalTotal };
}

function toQuoteItem(est: EstimateRow, idx: number, override?: QuoteItemOverride): QuoteItem {
  const specs = est.specs_snapshot;
  const { boxSubtotal, additionalTotal } = splitEstimateTotals(est);
  // "Included" charges are already inside boxSubtotal — itemizing them would
  // print a one-time-charges block for money that has already been billed.
  const detail =
    est.cost_breakdown?.additionalMode === "included" ? [] : additionalDetails(specs);
  // Legacy safety net: cost carries additional but the snapshot lines don't
  // (shouldn't happen — both derive from the same request — but never drop money).
  const detailSum = detail.reduce((s, d) => s + d.amount, 0);
  const finalDetail =
    additionalTotal > 0 && detailSum === 0
      ? [{ label: "One-time charges", amount: additionalTotal }]
      : detail;
  return {
    sNo: idx + 1,
    description: override?.description?.trim() || boxLabel(est.box_type),
    specsLines: override?.specsText != null
      ? override.specsText.split("\n").map((s) => s.trim()).filter(Boolean)
      : specsLines(specs),
    qty: est.quantity,
    unitPrice:
      est.quantity > 0 ? boxSubtotal / est.quantity : est.price_per_box ?? 0,
    total: boxSubtotal,
    additionalDetail: finalDetail.length ? finalDetail : undefined,
    additionalTotal: additionalTotal > 0 ? additionalTotal : undefined,
  };
}

/**
 * Build a quotation from one or more saved estimates. Each estimate becomes one
 * line item (order of `estimateIds` preserved). GST split: 5% on box subtotals,
 * 18% on one-time/additional charges. `quoteNo` here is the FALLBACK number —
 * the API route replaces it with the real FY-sequence number when it saves.
 */
export async function buildMultiQuotationData(
  supabase: SupabaseClient,
  estimateIds: string[],
  preparedBy: string,
  clientId?: string,
  overrides?: Record<string, QuoteItemOverride>,
  terms?: string[],
  // Trial-role isolation: pass a user id to build ONLY from that user's own
  // estimates, so a trial account can't quote another lead's costed work by
  // posting its id. null/omitted = unrestricted (admin/staff, unchanged).
  createdBy: string | null = null,
  // The market this quote is priced in. Omitted = INR = admin/staff, whose
  // quotes keep the same GST lines and BRAND dressing as before.
  currency: CurrencyCode = "INR",
): Promise<(QuotationData & { clientId: string | null }) | null> {
  if (!estimateIds.length) return null;

  const base = supabase
    .from("estimates")
    .select(
      "id, box_type, quantity, specs_snapshot, cost_breakdown, price_per_box, total_price, client_id",
    )
    .in("id", estimateIds);
  const { data: rows, error } = await (createdBy == null
    ? base
    : base.eq("created_by", createdBy));

  if (error) throw new Error(error.message);
  if (!rows || rows.length === 0) return null;

  // Resolve client (use explicit clientId if given, else the first estimate's client).
  const resolvedClientId =
    clientId ?? (rows[0] as EstimateRow).client_id ?? null;
  let billTo = { company: "—", contact: null as string | null };
  if (resolvedClientId) {
    const { data: client } = await supabase
      .from("clients")
      .select("name, contact_person")
      .eq("id", resolvedClientId)
      .maybeSingle();
    if (client) {
      billTo = {
        company: client.name as string,
        contact: (client.contact_person as string | null) ?? null,
      };
    }
  }

  // Build line items, preserving the order of estimateIds.
  const idOrder = new Map(estimateIds.map((id, i) => [id, i]));
  const sorted = [...(rows as EstimateRow[])].sort(
    (a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0),
  );

  const items = sorted.map((est, idx) => toQuoteItem(est, idx, overrides?.[est.id]));

  const subTotal = items.reduce((s, it) => s + it.total, 0);
  const additionalSubTotal = items.reduce((s, it) => s + (it.additionalTotal ?? 0), 0);
  const gstLines = buildGstLines(subTotal, additionalSubTotal, currency);
  const totalGst = gstLines.reduce((s, l) => s + l.amount, 0);
  const grandTotal = subTotal + additionalSubTotal + totalGst;

  const issue = new Date();
  const valid = new Date(issue);
  valid.setDate(valid.getDate() + QUOTE_VALIDITY_DAYS);

  const cleanTerms = (terms ?? DEFAULT_TERMS).map((t) => t.trim()).filter(Boolean);

  return {
    quoteNo: fallbackQuoteNo(sorted[0].id, issue.getFullYear()),
    issueDate: fmtDate(issue),
    validUntil: fmtDate(valid),
    preparedBy,
    billTo,
    items,
    subTotal,
    additionalSubTotal,
    gstLines,
    grandTotal,
    terms: cleanTerms.length ? cleanTerms : DEFAULT_TERMS,
    currency,
    company: COMPANY,
    bank: BANK,
    clientId: resolvedClientId,
  };
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * Turn an EDITED draft into the QuotationData that gets numbered, saved and
 * rendered (round 10 preview-and-edit flow, and the manual "custom quote").
 *
 * SECURITY / CORRECTNESS: every derived number is recomputed here —
 *   line total   = qty × unitPrice
 *   additional   = Σ its own charge lines
 *   GST          = buildGstLines(…) — the same 5%/18% split as an
 *                  estimate-backed quote
 *   grand total  = subTotal + additionalSubTotal + Σ GST
 * The client sends only what a person typed. A browser cannot post a quote
 * whose totals disagree with its line items, or one that skips GST.
 *
 * `quoteNo` is the FALLBACK; issueQuote replaces it with the real FY number.
 */
export function finalizeQuoteDraft(
  draft: QuoteDraft,
  preparedBy: string,
  clientId: string | null,
  // The market this quote is priced in. Omitted = INR = admin/staff, whose
  // quotes keep the same GST lines and BRAND dressing as before.
  currency: CurrencyCode = "INR",
): QuotationData & { clientId: string | null } {
  const items: QuoteItem[] = draft.items.map((it, idx) => {
    const qty = num(it.qty);
    const unitPrice = num(it.unitPrice);
    const detail = (it.additionalDetail ?? [])
      .map((d) => ({ ...d, amount: num(d.amount) }))
      .filter((d) => d.amount > 0);
    const additionalTotal = detail.reduce((s, d) => s + d.amount, 0);
    return {
      sNo: idx + 1,
      description: it.description?.trim() || "Item",
      specsLines: (it.specsLines ?? []).map((s) => s.trim()).filter(Boolean),
      qty,
      unitPrice,
      total: qty * unitPrice,
      additionalDetail: detail.length ? detail : undefined,
      additionalTotal: additionalTotal > 0 ? additionalTotal : undefined,
    };
  });

  const subTotal = items.reduce((s, it) => s + it.total, 0);
  const additionalSubTotal = items.reduce((s, it) => s + (it.additionalTotal ?? 0), 0);
  const gstLines = buildGstLines(subTotal, additionalSubTotal, currency);
  const totalGst = gstLines.reduce((s, l) => s + l.amount, 0);

  const issue = new Date();
  const valid = new Date(issue);
  valid.setDate(valid.getDate() + QUOTE_VALIDITY_DAYS);

  const cleanTerms = (draft.terms ?? []).map((t) => t.trim()).filter(Boolean);
  const notes = draft.notes?.trim();

  return {
    quoteNo: fallbackQuoteNo(clientId ?? "custom", issue.getFullYear()),
    issueDate: fmtDate(issue),
    validUntil: fmtDate(valid),
    preparedBy,
    billTo: {
      company: draft.billTo?.company?.trim() || "—",
      contact: draft.billTo?.contact?.trim() || null,
    },
    items,
    subTotal,
    additionalSubTotal,
    gstLines,
    grandTotal: subTotal + additionalSubTotal + totalGst,
    terms: cleanTerms.length ? cleanTerms : DEFAULT_TERMS,
    ...(notes ? { notes } : {}),
    currency,
    company: COMPANY,
    bank: BANK,
    clientId,
  };
}

/** QuotationData -> the editable draft the preview screen starts from. */
export function toQuoteDraft(data: QuotationData): QuoteDraft {
  return {
    billTo: data.billTo,
    items: data.items.map((it) => ({
      description: it.description,
      specsLines: it.specsLines,
      qty: it.qty,
      unitPrice: it.unitPrice,
      additionalDetail: it.additionalDetail,
    })),
    terms: data.terms,
    notes: data.notes,
  };
}

/** Single-estimate quotation = the multi builder with one id. */
export async function buildQuotationData(
  supabase: SupabaseClient,
  estimateId: string,
  preparedBy: string,
  createdBy: string | null = null,
  currency: CurrencyCode = "INR",
): Promise<(QuotationData & { clientId: string | null }) | null> {
  return buildMultiQuotationData(
    supabase,
    [estimateId],
    preparedBy,
    undefined,
    undefined,
    undefined,
    createdBy,
    currency,
  );
}
