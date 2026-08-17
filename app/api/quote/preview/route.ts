// POST /api/quote/preview
// Computes what a quote WOULD look like, as JSON. Nothing is numbered, nothing
// is saved, no PDF is rendered — this backs the round-10 review screen (client
// 5-Aug: "not directly lead to a PDF but instead a window, where I am able to
// make necessary changes and then that gets converted into a PDF").
//
// Body: { estimateIds: string[], clientId?: string }
// Response: QuotationData (its `quoteNo` is the placeholder; the real FY number
// is only assigned by POST /api/quote when the quote is actually issued).

import { getSession, ownerScopeFor } from "@/lib/auth";
import { currencyCodeFor } from "@/lib/currency-meta";
import { createAdminClient } from "@/lib/db/admin";
import { buildMultiQuotationData } from "@/lib/pdf/quotation-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: { estimateIds?: string[]; clientId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const estimateIds = body.estimateIds ?? [];
  if (!Array.isArray(estimateIds) || estimateIds.length === 0) {
    return Response.json({ error: "At least one estimate ID is required." }, { status: 400 });
  }

  try {
    const data = await buildMultiQuotationData(
      createAdminClient(),
      estimateIds,
      session.fullName ?? "—",
      body.clientId,
      undefined,
      undefined,
      ownerScopeFor(session),
      currencyCodeFor(session),
    );
    if (!data) {
      return Response.json({ error: "No estimates found." }, { status: 404 });
    }
    return Response.json(data);
  } catch (err) {
    console.error("POST /api/quote/preview failed:", err);
    return Response.json({ error: "Failed to build the quote preview." }, { status: 500 });
  }
}
