// PATCH /api/quote/[id] — update a saved quote's status (sent/accepted/…).
// Auth required (staff send + track quotes; margin isn't involved here).
// A trial account may only touch quotes it created.

import { getSession, ownerScopeFor } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";

const STATUSES = new Set(["draft", "sent", "accepted", "rejected", "revised"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id } = await params;
  let body: { status?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (typeof body.status !== "string" || !STATUSES.has(body.status)) {
    return Response.json({ error: "Invalid status." }, { status: 400 });
  }

  const admin = createAdminClient();
  const scope = ownerScopeFor(session);
  if (scope != null) {
    const { data, error: findErr } = await admin
      .from("quotes")
      .select("id")
      .eq("id", id)
      .eq("created_by", scope)
      .maybeSingle();
    if (findErr || !data) {
      return Response.json({ error: "Not found." }, { status: 404 });
    }
  }

  const { error } = await admin
    .from("quotes")
    .update({ status: body.status })
    .eq("id", id);
  if (error) {
    console.error("PATCH /api/quote/[id] failed:", error);
    return Response.json({ error: "Failed to update quote." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
