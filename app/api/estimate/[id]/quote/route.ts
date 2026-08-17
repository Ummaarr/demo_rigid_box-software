// GET /api/estimate/[id]/quote
// Renders the branded PDF quotation for a saved estimate. Round 3: this path
// also assigns a real FY-sequence quote number and saves the quote row, so
// single-estimate quotes are tracked exactly like builder quotes.

import { getSession, ownerScopeFor } from "@/lib/auth";
import { currencyCodeFor } from "@/lib/currency-meta";
import { createAdminClient } from "@/lib/db/admin";
import { buildQuotationData } from "@/lib/pdf/quotation-data";
import { issueQuote, quoteFilename } from "@/lib/pdf/generate-quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id } = await params;

  try {
    const admin = createAdminClient();
    const data = await buildQuotationData(
      admin,
      id,
      session.fullName ?? "—",
      ownerScopeFor(session),
      currencyCodeFor(session),
    );
    if (!data) {
      return Response.json({ error: "Estimate not found." }, { status: 404 });
    }

    const { pdf, quoteId, quoteNo } = await issueQuote(admin, data, {
      clientId: data.clientId,
      estimateIds: [id],
      createdBy: session.userId,
    });

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${quoteFilename(quoteNo)}"`,
        "Cache-Control": "no-store",
        "X-Quote-Id": quoteId ?? "",
        "X-Quote-No": quoteNo,
      },
    });
  } catch (err) {
    console.error("GET /api/estimate/[id]/quote failed:", err);
    return Response.json(
      { error: "Failed to generate quotation." },
      { status: 500 },
    );
  }
}
