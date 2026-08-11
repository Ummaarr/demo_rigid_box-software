// PATCH /api/estimate/[id]  — update the estimate's STATUS only (the snapshots
//   are immutable; status tracks the sent/accepted/revised lifecycle).
// DELETE /api/estimate/[id] — admin only (client 8-Jul: "option to delete an
//   estimate?"). Saved quotes keep their own items snapshot, so deleting an
//   estimate never breaks a quote already sent.

import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";

const STATUSES = new Set(["draft", "sent", "accepted", "revised"]);

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
    .from("estimates")
    .update({ status: body.status })
    .eq("id", id);
  if (error) {
    console.error("PATCH /api/estimate/[id] failed:", error);
    return Response.json({ error: "Failed to update status." }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (session.role !== "admin") {
    return Response.json({ error: "Admin only." }, { status: 403 });
  }

  const { id } = await params;
  const { error } = await createAdminClient().from("estimates").delete().eq("id", id);
  if (error) {
    console.error("DELETE /api/estimate/[id] failed:", error);
    return Response.json({ error: "Failed to delete estimate." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
