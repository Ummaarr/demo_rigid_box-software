// PUT  /api/clients/[id] — update client fields (admin, or a trial account
//                          editing its OWN client)
// DELETE /api/clients/[id] — delete client (same rule)
//
// Trial accounts are scoped to rows they created, so one lead can never edit
// or delete another's client by id — "Not found" on a mismatch, so an id you
// don't own looks exactly like one that doesn't exist.

import { getSession, ownerScopeFor } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionInfo } from "@/types";

async function requireAdminOrTrial() {
  const session = await getSession();
  if (!session) return { error: "Not authenticated.", status: 401 };
  if (session.role !== "admin" && session.role !== "trial")
    return { error: "Admin only.", status: 403 };
  return { session };
}

/** Does this client exist and is it in the caller's scope? */
async function inScope(
  admin: SupabaseClient,
  id: string,
  session: SessionInfo,
): Promise<boolean> {
  const scope = ownerScopeFor(session);
  if (scope == null) return true; // admin — unrestricted, as before.
  const { data, error } = await admin
    .from("clients")
    .select("id")
    .eq("id", id)
    .eq("created_by", scope)
    .maybeSingle();
  return !error && !!data;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminOrTrial();
  if ("error" in auth) return Response.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  if (!(await inScope(createAdminClient(), id, auth.session)))
    return Response.json({ error: "Not found." }, { status: 404 });

  let body: {
    name?: string;
    type?: string;
    contact_person?: string;
    phone?: string;
    email?: string;
    address?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (!name)
    return Response.json({ error: "Client name is required." }, { status: 400 });
  const type = body.type ?? "lead";
  if (type !== "lead" && type !== "customer")
    return Response.json({ error: "type must be lead or customer." }, { status: 400 });

  const fields = {
    name,
    contact_person: body.contact_person?.trim() || null,
    phone: body.phone?.trim() || null,
    email: body.email?.trim() || null,
    address: body.address?.trim() || null,
  };
  // Pre-migration DB (no type column, 42703): retry the legacy shape.
  let { data, error } = await createAdminClient()
    .from("clients")
    .update({ ...fields, type })
    .eq("id", id)
    .select("id, name")
    .single();
  if (error && error.code === "42703") {
    ({ data, error } = await createAdminClient()
      .from("clients")
      .update(fields)
      .eq("id", id)
      .select("id, name")
      .single());
  }

  if (error) {
    console.error("PUT /api/clients/[id] failed:", error);
    return Response.json({ error: "Failed to update client." }, { status: 500 });
  }
  return Response.json(data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminOrTrial();
  if ("error" in auth) return Response.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  if (!(await inScope(createAdminClient(), id, auth.session)))
    return Response.json({ error: "Not found." }, { status: 404 });

  const { error } = await createAdminClient()
    .from("clients")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("DELETE /api/clients/[id] failed:", error);
    return Response.json({ error: "Failed to delete client." }, { status: 500 });
  }
  return new Response(null, { status: 204 });
}
