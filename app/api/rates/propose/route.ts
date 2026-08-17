// Rate-change approval workflow (round 3, client 17-Jun):
//   POST  /api/rates/propose — staff or admin PROPOSE a rate change (does not
//         apply); validated against the same whitelist as direct edits, minus
//         the config tables (margin is admin-only by hard rule).
//   PATCH /api/rates/propose — admin approve/reject. Approving applies the
//         change through the exact same path as a direct admin edit.
// Values are stored JSON-encoded in text columns so numbers/booleans round-trip.

import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import {
  ALLOWED,
  PROPOSABLE_EXCLUDED,
  applyRateUpdate,
  validateRateValue,
} from "@/lib/db/rate-whitelist";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }
  // Trial accounts never propose — they edit their own private card directly
  // (PATCH /api/rates already allows it). Propose/approve exists only for
  // staff changing the SHARED master card.
  if (session.role === "trial") {
    return Response.json({ error: "Not available for trial accounts." }, { status: 403 });
  }

  let body: {
    table?: string;
    id?: unknown;
    field?: string;
    value?: unknown;
    rowLabel?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { table, id, field, value } = body;
  if (typeof table !== "string" || !ALLOWED[table] || PROPOSABLE_EXCLUDED.has(table))
    return Response.json({ error: "Invalid table." }, { status: 400 });
  if (typeof field !== "string")
    return Response.json({ error: "field is required." }, { status: 400 });
  if (field === "is_dummy")
    return Response.json({ error: "The dummy flag can't be proposed." }, { status: 400 });
  if (id == null || (typeof id !== "string" && typeof id !== "number"))
    return Response.json({ error: "id is required." }, { status: 400 });
  const invalid = validateRateValue(table, field, value);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });

  const admin = createAdminClient();

  // Snapshot the current value so the approver sees old -> new.
  const { data: current, error: curErr } = await admin
    .from(table)
    .select(field)
    .eq(ALLOWED[table].idCol, id)
    .maybeSingle();
  if (curErr || !current) {
    return Response.json({ error: "Rate row not found." }, { status: 404 });
  }

  const { error } = await admin.from("rate_change_requests").insert({
    table_name: table,
    row_id: String(id),
    row_label: typeof body.rowLabel === "string" ? body.rowLabel.slice(0, 200) : null,
    field,
    old_value: JSON.stringify((current as unknown as Record<string, unknown>)[field] ?? null),
    new_value: JSON.stringify(value),
    proposed_by: session.userId,
    proposed_by_name: session.fullName ?? session.email ?? "Unknown",
  });
  if (error) {
    console.error("POST /api/rates/propose failed:", error);
    const msg = error.code === "42P01"
      ? "Rate proposals need migration-round3.sql to be run first."
      : "Failed to save proposal.";
    return Response.json({ error: msg }, { status: 500 });
  }
  return Response.json({ ok: true }, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (session.role !== "admin") {
    return Response.json({ error: "Admin only." }, { status: 403 });
  }

  let body: { id?: unknown; action?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const { id, action } = body;
  if (typeof id !== "number" && typeof id !== "string")
    return Response.json({ error: "id is required." }, { status: 400 });
  if (action !== "approve" && action !== "reject")
    return Response.json({ error: "action must be approve or reject." }, { status: 400 });

  const admin = createAdminClient();
  const { data: req, error: loadErr } = await admin
    .from("rate_change_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) {
    console.error("PATCH /api/rates/propose load failed:", loadErr);
    return Response.json({ error: "Failed to load proposal." }, { status: 500 });
  }
  if (!req) return Response.json({ error: "Proposal not found." }, { status: 404 });
  if (req.status !== "pending")
    return Response.json({ error: "Proposal already decided." }, { status: 409 });

  if (action === "approve") {
    let value: unknown;
    try {
      value = JSON.parse(req.new_value as string);
    } catch {
      return Response.json({ error: "Proposal value is corrupt." }, { status: 500 });
    }
    // Apply through the same validated path as a direct edit. The rate-card
    // "updated by" shows the proposer (it's their change); the request row
    // records who approved it.
    const result = await applyRateUpdate(
      admin,
      req.table_name as string,
      req.row_id as string,
      req.field as string,
      value,
      (req.proposed_by_name as string | null) ?? "Unknown",
      // The approving admin always writes to the SHARED master card — a
      // proposal only ever names a master (owner_id null) row, since trial
      // accounts never propose (rejected above).
      { role: "admin", userId: session.userId },
    );
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: 500 });
    }
  }

  const { error: updErr } = await admin
    .from("rate_change_requests")
    .update({
      status: action === "approve" ? "approved" : "rejected",
      decided_by_name: session.fullName ?? session.email ?? "Unknown",
      decided_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updErr) {
    console.error("PATCH /api/rates/propose update failed:", updErr);
    return Response.json({ error: "Failed to record decision." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
