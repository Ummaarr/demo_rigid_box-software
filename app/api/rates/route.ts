// PATCH  /api/rates — admin-only rate field update (staff PROPOSE instead).
// POST   /api/rates — new rate row insert: admin OR staff (client final doc,
//        "Staff Access: should be able to add and delete materials").
// DELETE /api/rates — rate row delete: admin OR staff (same ask).
// All use a strict whitelist (lib/db/rate-whitelist.ts): only listed tables and
// fields are allowed. The propose/approve workflow reuses the same whitelist.
//
// WHY add/delete are open to staff but PATCH is not: adding or removing a
// catalogue row cannot change what an existing estimate costs (every estimate
// carries its own rates_snapshot) and new rows land as is_dummy until priced.
// EDITING a live rate silently moves the price of every future estimate, which
// is exactly what the round-3 propose/approve workflow exists to gate.

import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import {
  ALLOWED,
  INSERTABLE,
  NULL_WHEN_BLANK,
  applyRateUpdate,
  normaliseRateValue,
} from "@/lib/db/rate-whitelist";

async function requireAdmin() {
  const session = await getSession();
  if (!session) return { error: Response.json({ error: "Not authenticated." }, { status: 401 }) };
  if (session.role !== "admin") return { error: Response.json({ error: "Admin only." }, { status: 403 }) };
  return { session };
}

/** Any signed-in user (admin or staff) — used by the row add/delete routes. */
async function requireUser() {
  const session = await getSession();
  if (!session) return { error: Response.json({ error: "Not authenticated." }, { status: 401 }) };
  return { session };
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let body: { table?: string; id?: unknown; field?: string; value?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { table, id, field, value } = body;

  if (typeof table !== "string" || !ALLOWED[table])
    return Response.json({ error: "Invalid table." }, { status: 400 });
  if (typeof field !== "string")
    return Response.json({ error: "field is required." }, { status: 400 });
  if (id == null || (typeof id !== "string" && typeof id !== "number"))
    return Response.json({ error: "id is required." }, { status: 400 });

  const result = await applyRateUpdate(
    createAdminClient(),
    table,
    id,
    field,
    value,
    auth.session.fullName ?? auth.session.email ?? "Unknown",
  );
  if ("error" in result) {
    const status = result.error === "Failed to update rate." ? 500 : 400;
    return Response.json({ error: result.error }, { status });
  }
  // Return the stamped meta so the client can update its row in place (no refresh).
  return Response.json({ ok: true, ...result });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  let body: { table?: string; fields?: Record<string, unknown> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { table, fields } = body;
  if (typeof table !== "string" || !INSERTABLE[table])
    return Response.json({ error: "Invalid table for insert." }, { status: 400 });
  if (!fields || typeof fields !== "object" || Array.isArray(fields))
    return Response.json({ error: "fields must be an object." }, { status: 400 });

  const spec = INSERTABLE[table];
  const allAllowed = new Set([...spec.required, ...spec.optional]);
  // Stamp who added the row + when (all insertable tables are rate tables, which
  // carry updated_by/updated_at). Vendor may still be overridden by `fields`.
  const newRow: Record<string, unknown> = {
    is_dummy: true,
    updated_by: auth.session.fullName ?? auth.session.email ?? "Unknown",
    updated_at: new Date().toISOString(),
  };

  // Validate required fields.
  for (const f of spec.required) {
    if (!(f in fields)) return Response.json({ error: `Missing required field: ${f}.` }, { status: 400 });
  }

  // Validate each provided field.
  for (const [f, v] of Object.entries(fields)) {
    if (!allAllowed.has(f))
      return Response.json({ error: `Unknown field: ${f}.` }, { status: 400 });
    if (spec.numeric.has(f)) {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
        return Response.json({ error: `${f} must be a non-negative number.` }, { status: 400 });
    } else {
      // Round 10: a blank value is legitimate for fields that mean "not set"
      // when empty (printing vendor) — it is stored as NULL, not "". Every
      // other text field still has to be filled in.
      const blankOk = NULL_WHEN_BLANK.has(`${table}.${f}`);
      if (typeof v !== "string" || (v.trim() === "" && !blankOk))
        return Response.json({ error: `${f} must be a non-empty string.` }, { status: 400 });
      if (v.length > 200)
        return Response.json({ error: `${f} must be 200 chars or less.` }, { status: 400 });
    }
    newRow[f] = spec.numeric.has(f)
      ? v
      : normaliseRateValue(table, f, (v as string).trim());
  }

  const admin = createAdminClient();
  const { data, error } = await admin.from(table).insert(newRow).select().single();
  if (error) {
    console.error(`POST /api/rates (${table}):`, error);
    return Response.json({ error: "Failed to insert row." }, { status: 500 });
  }
  return Response.json({ ok: true, row: data }, { status: 201 });
}

// DELETE /api/rates?table=<rate table>&id=<row id> — admin or staff (client
// 7-Jul: "can I delete any product that has been listed?"; final doc: staff may
// add and delete materials). Only real rate tables (the INSERTABLE set) can be
// deleted from — config rows can't. Old estimates are unaffected: they carry
// their own rates_snapshot.
export async function DELETE(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const table = url.searchParams.get("table");
  const id = url.searchParams.get("id");
  if (!table || !INSERTABLE[table])
    return Response.json({ error: "Invalid table for delete." }, { status: 400 });
  if (!id) return Response.json({ error: "id is required." }, { status: 400 });

  const { error } = await createAdminClient().from(table).delete().eq("id", id);
  if (error) {
    console.error(`DELETE /api/rates (${table}):`, error);
    return Response.json({ error: "Failed to delete row." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
