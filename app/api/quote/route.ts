// POST /api/quote
// Generates a combined PDF quotation, assigns the next FY-sequence quote number
// (<prefix>/26-27/001) and SAVES the quote row (items/terms/totals snapshot)
// before streaming the PDF.
//
// Three shapes, all ending in the same issueQuote() pipeline:
//   1. { estimateIds, clientId?, overrides?, terms? }   — the pre-round-10 form
//   2. { estimateIds, clientId?, draft }                — a REVIEWED quote: the
//      user edited the preview (description/specs/qty/unit price/charges/terms/
//      notes) and this is what they approved.
//   3. { estimateIds: [], clientId?, draft }            — a CUSTOM quote, typed
//      from scratch with no estimate behind it (client 5-Aug).
//
// In 2 and 3 every DERIVED number (line totals, GST, grand total) is recomputed
// server-side by finalizeQuoteDraft — the browser sends only typed values, so a
// quote can never be posted with totals that disagree with its line items.
//
// Auth required; uses the session user's name as "Prepared By".

import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import {
  buildMultiQuotationData,
  finalizeQuoteDraft,
  type QuoteDraft,
  type QuoteItemOverride,
} from "@/lib/pdf/quotation-data";
import { issueQuote, quoteFilename } from "@/lib/pdf/generate-quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: {
    estimateIds?: string[];
    clientId?: string;
    overrides?: Record<string, QuoteItemOverride>;
    terms?: string[];
    draft?: QuoteDraft;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const estimateIds = body.estimateIds ?? [];
  const draft = body.draft;

  // A quote needs either estimates to build from, or a typed draft.
  if (!estimateIds.length && !draft) {
    return Response.json({ error: "At least one estimate ID is required." }, { status: 400 });
  }
  if (draft && (!Array.isArray(draft.items) || draft.items.length === 0)) {
    return Response.json({ error: "A quote needs at least one line item." }, { status: 400 });
  }
  if (body.terms && (!Array.isArray(body.terms) || body.terms.some((t) => typeof t !== "string"))) {
    return Response.json({ error: "terms must be an array of strings." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();

    const data = draft
      ? finalizeQuoteDraft(draft, session.fullName ?? "—", body.clientId ?? null)
      : await buildMultiQuotationData(
          admin,
          estimateIds,
          session.fullName ?? "—",
          body.clientId,
          body.overrides,
          body.terms,
        );

    if (!data) {
      return Response.json({ error: "No estimates found." }, { status: 404 });
    }

    // estimateIds stays the provenance record — empty for a custom quote, which
    // also makes nextRevisionNo return null so it takes a fresh FY number and
    // is never treated as a revision of something.
    const { pdf, quoteId, quoteNo } = await issueQuote(admin, data, {
      clientId: data.clientId,
      estimateIds,
      createdBy: session.userId,
    });

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${quoteFilename(quoteNo)}"`,
        "Cache-Control": "no-store",
        // Surfaced so the builder can link to the saved quote (null = pre-migration DB).
        "X-Quote-Id": quoteId ?? "",
        "X-Quote-No": quoteNo,
      },
    });
  } catch (err) {
    console.error("POST /api/quote failed:", err);
    return Response.json({ error: "Failed to generate quotation." }, { status: 500 });
  }
}
