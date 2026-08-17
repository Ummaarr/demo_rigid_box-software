// POST /api/estimate
// Compute AND persist an estimate. Stores specs_snapshot + rates_snapshot +
// the FULL cost_breakdown (incl. margin — server-trusted storage) so the quote
// is reproducible and never changes when rates are later edited. The RESPONSE
// still strips margin for non-admin callers.

import { getSession, ownerScopeFor } from "@/lib/auth";
import { buildEstimate, costForRole } from "@/lib/estimate/build-estimate";
import { isEstimateError } from "@/lib/estimate/errors";
import { createAdminClient } from "@/lib/db/admin";
import type { EstimateRequest } from "@/types";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: EstimateRequest;
  try {
    body = (await request.json()) as EstimateRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Only admins and trial accounts (their own margin, on their own private
  // estimate) may override overhead/margin; ignore it otherwise.
  if (session.role !== "admin" && session.role !== "trial") {
    delete body.overheadPct;
    delete body.marginPct;
  }

  try {
    const admin = createAdminClient();
    const built = await buildEstimate(body, admin, ownerScopeFor(session));

    const baseRow = {
      client_id: body.clientId ?? null,
      box_type: body.boxType,
      quantity: body.quantity,
      specs_snapshot: built.specsSnapshot,
      rates_snapshot: built.ratesSnapshot,
      cost_breakdown: built.cost,
      price_per_box: built.cost.pricePerBox,
      total_price: built.cost.total,
      created_by: session.userId,
    };
    const name =
      typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 200) : null;

    // Round 3: name + status columns. A DB that hasn't run migration-round3.sql
    // yet lacks them (42703 undefined column) — retry with the legacy shape so
    // estimate saving never breaks on migration lag.
    let { data, error } = await admin
      .from("estimates")
      .insert({ ...baseRow, name, status: "draft" })
      .select("id")
      .single();
    if (error && error.code === "42703") {
      ({ data, error } = await admin.from("estimates").insert(baseRow).select("id").single());
    }

    if (error || !data) {
      console.error("POST /api/estimate insert failed:", error);
      return Response.json({ error: "Failed to save estimate." }, { status: 500 });
    }

    // Re-run provenance (client 8-Jul: status "revised (if price is rerun)"):
    // saving an estimate created via /estimate?from=<id> marks the source as
    // revised. Best-effort — never fails the save.
    // Scoped for trial accounts: the source id comes from the request body, so
    // without this a lead could flip another lead's estimate to "revised".
    if (typeof body.sourceEstimateId === "string" && body.sourceEstimateId) {
      const scope = ownerScopeFor(session);
      const upd = admin
        .from("estimates")
        .update({ status: "revised" })
        .eq("id", body.sourceEstimateId);
      const { error: revErr } = await (scope == null ? upd : upd.eq("created_by", scope));
      if (revErr && revErr.code !== "42703") {
        console.warn("mark-revised failed:", revErr.message);
      }
    }

    return Response.json(
      {
        id: data.id,
        materials: built.materials,
        cost: costForRole(built.cost, session.role),
        // Auto-economical printing (round 5): what the server picked.
        autoPicks: built.ratesSnapshot.autoPicks,
      },
      { status: 201 },
    );
  } catch (err) {
    if (isEstimateError(err)) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("POST /api/estimate failed:", err);
    return Response.json({ error: "Internal error." }, { status: 500 });
  }
}
