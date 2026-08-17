// GET /api/quote/[id]/pdf — re-render a SAVED quote's PDF from its stored
// snapshot (items/terms/totals/bill-to frozen at issue time — no recompute, so
// the document never drifts from what was originally sent).

import { getSession, ownerScopeFor } from "@/lib/auth";
import { isCurrencyCode } from "@/lib/currency-meta";
import { createAdminClient } from "@/lib/db/admin";
import { renderQuotePdf, quoteFilename } from "@/lib/pdf/generate-quote";
import {
  BANK,
  COMPANY,
  type GstLine,
  type QuotationData,
  type QuoteItem,
} from "@/lib/pdf/quotation-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id } = await params;
  // Trial accounts can only re-render their own saved quotes.
  const scope = ownerScopeFor(session);
  const base = createAdminClient().from("quotes").select("*").eq("id", id);
  const { data: q, error } = await (scope == null ? base : base.eq("created_by", scope))
    .maybeSingle();
  if (error) {
    console.error("GET /api/quote/[id]/pdf failed:", error);
    return Response.json({ error: "Failed to load quote." }, { status: 500 });
  }
  if (!q) return Response.json({ error: "Quote not found." }, { status: 404 });

  const issued = new Date(q.created_at as string);
  const valid = new Date(issued);
  valid.setDate(valid.getDate() + 15);

  const data: QuotationData = {
    quoteNo: q.quote_no as string,
    issueDate: fmtDate(issued),
    validUntil: fmtDate(valid),
    // Prepared-by isn't snapshotted on the row; show the re-generator's name.
    preparedBy: session.fullName ?? "—",
    billTo: q.bill_to as QuotationData["billTo"],
    items: q.items as QuoteItem[],
    subTotal: Number(q.sub_total),
    additionalSubTotal: Number(q.additional_sub_total),
    gstLines: q.gst as GstLine[],
    grandTotal: Number(q.grand_total),
    terms: q.terms as string[],
    // Absent on quotes issued before round 10 (and on a pre-migration DB).
    ...(q.notes ? { notes: q.notes as string } : {}),
    // The market it was ISSUED in — deliberately not the re-generating
    // session's, so an admin re-rendering a trial's quote reproduces the
    // original document rather than converting it to INR. Absent on quotes
    // predating multi-currency, which fall back to the BRAND dressing.
    ...(isCurrencyCode(q.currency) ? { currency: q.currency } : {}),
    company: COMPANY,
    bank: BANK,
  };

  const pdf = await renderQuotePdf(data);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${quoteFilename(data.quoteNo)}"`,
      "Cache-Control": "no-store",
    },
  });
}
