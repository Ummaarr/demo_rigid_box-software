import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return Response.json({ error: "Not authenticated." }, { status: 401 });

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
  // Lead vs customer (client 4-Jul); default lead.
  const type = body.type ?? "lead";
  if (type !== "lead" && type !== "customer")
    return Response.json({ error: "type must be lead or customer." }, { status: 400 });

  const admin = createAdminClient();
  const row = {
    name,
    contact_person: body.contact_person?.trim() || null,
    phone: body.phone?.trim() || null,
    email: body.email?.trim() || null,
    address: body.address?.trim() || null,
    created_by: session.userId,
  };
  // Pre-migration DB (no type column, 42703): retry the legacy shape.
  let { data, error } = await admin
    .from("clients")
    .insert({ ...row, type })
    .select("id, name")
    .single();
  if (error && error.code === "42703") {
    ({ data, error } = await admin.from("clients").insert(row).select("id, name").single());
  }

  if (error) {
    console.error("POST /api/clients failed:", error);
    return Response.json({ error: "Failed to create client." }, { status: 500 });
  }

  return Response.json(data, { status: 201 });
}
