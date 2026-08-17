// POST /api/trial/ack-rates — a trial user confirms they've reviewed their
// rate card, which releases the blocking review step (see
// components/trial-rate-review.tsx). Self-service: it only ever writes the
// CALLER's own profile row, so no admin check is needed and no id is accepted
// from the client.

import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";

export async function POST() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }
  // trial_rates_ack is only ever read for trials, so this guard changes no
  // behaviour — it just stops another role writing a field that means nothing
  // for them, matching set-currency's shape.
  if (session.role !== "trial") {
    return Response.json({ error: "Trial accounts only." }, { status: 403 });
  }

  const { error } = await createAdminClient()
    .from("profiles")
    .update({ trial_rates_ack: true })
    .eq("id", session.userId);

  if (error) {
    console.error("POST /api/trial/ack-rates failed:", error);
    return Response.json({ error: "Failed to save." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
