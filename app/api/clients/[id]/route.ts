// PUT  /api/clients/[id] — update client fields (admin only)
// DELETE /api/clients/[id] — delete client (admin only)

import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";

async function requireAdmin(request: Request) {
  const session = await getSession();
  if (!session) return { error: "Not authenticated.", status: 401 };
  if (session.role !== "admin") return { error: "Admin only.", status: 403 };
  return { session };
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return Response.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;

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
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return Response.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;

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
