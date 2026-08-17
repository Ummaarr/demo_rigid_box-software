// POST /api/estimate/calculate
// Compute an estimate from a request WITHOUT saving it. Loads real rates from
// the DB, runs Engine 1 + Engine 2, and returns the breakdown — with margin
// stripped for non-admin (Staff) callers. All Supabase access is server-side.

import { getSession, ownerScopeFor } from "@/lib/auth";
import { buildEstimate, costForRole } from "@/lib/estimate/build-estimate";
import { isEstimateError } from "@/lib/estimate/errors";
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
    const built = await buildEstimate(body, undefined, ownerScopeFor(session));
    return Response.json({
      materials: built.materials,
      cost: costForRole(built.cost, session.role),
      // Auto-economical printing (round 5): what the server picked, so the
      // result panel can show "Print size (auto): 18x25 on 25x36".
      autoPicks: built.ratesSnapshot.autoPicks,
    });
  } catch (err) {
    if (isEstimateError(err)) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("POST /api/estimate/calculate failed:", err);
    return Response.json({ error: "Internal error." }, { status: 500 });
  }
}
