// PATCH /api/estimate/[id]  — update the estimate's STATUS only (the snapshots
//   are immutable; status tracks the sent/accepted/revised lifecycle).
// DELETE /api/estimate/[id] — admin, or a trial account deleting its OWN
//   estimate (client 8-Jul: "option to delete an estimate?"). Saved quotes
//   keep their own items snapshot, so deleting an estimate never breaks a
//   quote already sent.
//
// Both are scoped for trial accounts: a trial caller may only touch rows it
// created, so one lead can never change or delete another's estimate by id.

import { getSession, ownerScopeFor } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionInfo } from "@/types";

const STATUSES = new Set(["draft", "sent", "accepted", "revised"]);

/** Does this estimate exist and is it in the caller's scope? */
async function inScope(
  admin: SupabaseClient,
  id: string,
  session: SessionInfo,
): Promise<boolean> {
  const scope = ownerScopeFor(session);
  if (scope == null) return true; // admin/staff — unrestricted, as before.
  const { data, error } = await admin
    .from("estimates")
    .select("id")
    .eq("id", id)
    .eq("created_by", scope)
    .maybeSingle();
  return !error && !!data;
}

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
  if (!(await inScope(admin, id, session))) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { error } = await admin
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
  if (session.role !== "admin" && session.role !== "trial") {
    return Response.json({ error: "Admin only." }, { status: 403 });
  }

  const { id } = await params;
  const admin = createAdminClient();
  if (!(await inScope(admin, id, session))) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { error } = await admin.from("estimates").delete().eq("id", id);
  if (error) {
    console.error("DELETE /api/estimate/[id] failed:", error);
    return Response.json({ error: "Failed to delete estimate." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
