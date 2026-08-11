// PATCH /api/quote/[id] — update a saved quote's status (sent/accepted/…).
// Auth required (staff send + track quotes; margin isn't involved here).

import { getSession } from "@/lib/auth";
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

  const { error } = await createAdminClient()
    .from("quotes")
    .update({ status: body.status })
    .eq("id", id);
  if (error) {
    console.error("PATCH /api/quote/[id] failed:", error);
    return Response.json({ error: "Failed to update quote." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
