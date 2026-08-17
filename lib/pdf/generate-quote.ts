// Shared quote generation (round 3): every quote PDF path goes through here so
// each sent quote gets a real FY-sequence number and is SAVED as a row in
// `quotes` (items/terms/totals snapshotted — the PDF can always be re-rendered
// byte-identical even after estimates/rates/clients change).

import "server-only";

import { createElement } from "react";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { renderToBuffer } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";

import { QuotationDocument } from "@/components/pdf/quotation-document";
import {
  formatQuoteNo,
  fyLabel,
  type QuotationData,
} from "@/lib/pdf/quotation-data";

async function loadLogo(): Promise<string | undefined> {
  try {
    const buf = await readFile(join(process.cwd(), "public", "brand", "logo.png"));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return undefined; // component falls back to the company name as text
  }
}

/** Render a quotation PDF from its (possibly stored) data snapshot. */
export async function renderQuotePdf(data: QuotationData): Promise<Buffer> {
  const logo = await loadLogo();
  return renderToBuffer(
    createElement(QuotationDocument, { data, logo }) as unknown as Parameters<
      typeof renderToBuffer
    >[0],
  );
}

export function quoteFilename(quoteNo: string): string {
  return `quotation-${quoteNo.replace(/[/\\]/g, "-")}.pdf`;
}

/**
 * Assign the next real quote number (<prefix>/26-27/001) via the atomic DB counter.
 * Returns null when the DB predates migration-round3.sql (missing function) —
 * callers keep the fallback number and skip persisting.
 */
export async function assignQuoteNo(supabase: SupabaseClient): Promise<string | null> {
  const fy = fyLabel(new Date());
  const { data, error } = await supabase.rpc("next_quote_no", { p_fy: fy });
  if (error || typeof data !== "number") {
    if (error) console.warn("next_quote_no unavailable (run migration-round3.sql):", error.message);
    return null;
  }
  return formatQuoteNo(fy, data);
}

/**
 * Persist a generated quote. Returns the new row id, or null when the quotes
 * table doesn't exist yet (pre-migration DB) — the PDF still streams, we just
 * can't track it.
 */
export async function saveQuote(
  supabase: SupabaseClient,
  data: QuotationData,
  opts: { clientId: string | null; estimateIds: string[]; createdBy: string },
): Promise<string | null> {
  const base = {
    quote_no: data.quoteNo,
    client_id: opts.clientId,
    bill_to: data.billTo,
    estimate_ids: opts.estimateIds,
    items: data.items,
    sub_total: data.subTotal,
    additional_sub_total: data.additionalSubTotal,
    gst: data.gstLines,
    grand_total: data.grandTotal,
    terms: data.terms,
    status: "sent",
    created_by: opts.createdBy,
  };

  const insert = (row: Record<string, unknown>) =>
    supabase.from("quotes").insert(row).select("id").single();

  const optional = {
    ...(data.notes ? { notes: data.notes } : {}),
    // Frozen so a re-render prints the currency it was issued in, not the
    // re-generator's. Omitted for admin/staff (BRAND dressing, as before).
    ...(data.currency && data.currency !== "INR" ? { currency: data.currency } : {}),
  };

  let { data: row, error } = await insert(
    Object.keys(optional).length ? { ...base, ...optional } : base,
  );
  // 42703 = undefined_column: a live DB that hasn't run migration-round10.sql
  // (notes) or migration-multi-currency.sql (currency) yet. Save the quote
  // anyway rather than losing it — only those extras are dropped. (Same
  // degradation as round 3's name/status.)
  if (error?.code === "42703" && Object.keys(optional).length) {
    console.warn(
      "quote notes/currency skipped (run migration-round10.sql / migration-multi-currency.sql):",
      error.message,
    );
    ({ data: row, error } = await insert(base));
  }
  if (error || !row) {
    console.warn("quote save skipped (run migration-round3.sql?):", error?.message);
    return null;
  }
  return row.id as string;
}

/** Strip a revision suffix: "ABC/26-27/001-R2" -> "ABC/26-27/001". */
export function baseQuoteNo(quoteNo: string): string {
  return quoteNo.replace(/-R\d+$/i, "");
}

/**
 * Revision number for a re-quote (client final doc item 13: "if an estimate /
 * quote is revised, the revised version is renamed R1, R2, R3…").
 *
 * A quote covering an estimate that has already been quoted keeps the ORIGINAL
 * number and gains a suffix, so the whole revision history reads as one
 * document — and no new FY sequence number is burned on a revision.
 * Returns null when this is the first quote for the estimate (or the quotes
 * table doesn't exist yet), in which case the caller numbers it normally.
 */
export async function nextRevisionNo(
  supabase: SupabaseClient,
  estimateIds: string[],
): Promise<string | null> {
  if (estimateIds.length === 0) return null;
  const { data, error } = await supabase
    .from("quotes")
    .select("quote_no, created_at")
    .contains("estimate_ids", [estimateIds[0]])
    .order("created_at", { ascending: true });
  if (error) {
    // Pre-migration DB (no quotes table) — fall back to normal numbering.
    return null;
  }
  const rows = (data ?? []) as { quote_no: string }[];
  if (rows.length === 0) return null;
  const base = baseQuoteNo(rows[0].quote_no);
  // Count every quote already issued against this estimate: the original is
  // revision 0, so the next one is R<count>.
  const issued = rows.filter((r) => baseQuoteNo(r.quote_no) === base).length;
  return `${base}-R${issued}`;
}

/**
 * Full pipeline for a new quote: number it, save it, render the PDF. On a
 * pre-migration DB both steps degrade gracefully (fallback number, no row).
 *
 * Re-quoting an already-quoted estimate produces a REVISION (…-R1, -R2) of the
 * original number instead of a fresh sequence number (client item 13).
 */
export async function issueQuote(
  supabase: SupabaseClient,
  data: QuotationData,
  opts: { clientId: string | null; estimateIds: string[]; createdBy: string },
): Promise<{ pdf: Buffer; quoteId: string | null; quoteNo: string }> {
  const revisionNo = await nextRevisionNo(supabase, opts.estimateIds);
  const realNo = revisionNo ?? (await assignQuoteNo(supabase));
  if (realNo) data.quoteNo = realNo;
  const quoteId = realNo ? await saveQuote(supabase, data, opts) : null;
  const pdf = await renderQuotePdf(data);
  return { pdf, quoteId, quoteNo: data.quoteNo };
}
