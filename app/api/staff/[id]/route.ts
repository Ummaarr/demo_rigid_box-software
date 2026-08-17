// PATCH /api/staff/[id] — edit a user (name / role / reset password).
// DELETE /api/staff/[id] — remove a user's login entirely.
// Admin-only, mirroring POST /api/staff (defense in depth beyond the page).
// Self-guards: an admin cannot demote or delete their OWN account — that's the
// easiest way to lock the last admin out of the app.
// Role changes to/from "trial" also move the private rate card with the
// account (clone on the way in, drop on the way out) — see the PATCH body.

import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import { deleteRateCardForUser } from "@/lib/db/clone-rate-card";

interface UpdateStaffBody {
  fullName?: string;
  role?: string;
  password?: string;
}

async function requireAdminSession() {
  const session = await getSession();
  if (!session) {
    return { error: Response.json({ error: "Not authenticated." }, { status: 401 }) };
  }
  if (session.role !== "admin") {
    return { error: Response.json({ error: "Admins only." }, { status: 403 }) };
  }
  return { session };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error: authError } = await requireAdminSession();
  if (authError) return authError;
  const { id } = await params;

  let body: UpdateStaffBody;
  try {
    body = (await request.json()) as UpdateStaffBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const fullName =
    body.fullName !== undefined ? String(body.fullName).trim() : undefined;
  const role = body.role !== undefined ? String(body.role) : undefined;
  const password =
    body.password !== undefined && String(body.password).length > 0
      ? String(body.password)
      : undefined;

  if (fullName !== undefined && !fullName) {
    return Response.json({ error: "Full name cannot be empty." }, { status: 400 });
  }
  if (role !== undefined && role !== "staff" && role !== "admin" && role !== "trial") {
    return Response.json({ error: "Invalid role." }, { status: 400 });
  }
  if (password !== undefined && password.length < 8) {
    return Response.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }
  if ((role === "staff" || role === "trial") && id === session!.userId) {
    return Response.json(
      { error: "You cannot demote your own account." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Converting to/from the trial role carries the private rate card with it.
  //   -> trial : NOT cloned here. Since multi-currency the master card is four
  //              per-market template sets, and which one to copy depends on a
  //              country the new trial hasn't picked yet — so they land on the
  //              picker at next login and cloning happens there
  //              (app/api/trial/set-currency). Any stale card from a previous
  //              stint as a trial is cleared below so the picker starts clean.
  //   trial -> : drop their private card; the shared master card is what
  //              staff/admin read. Their existing clients/estimates/quotes
  //              stay theirs but become visible to all staff/admin, which is
  //              the point of the promotion — the UI warns about it.
  let currentRole: string | undefined;
  if (role !== undefined) {
    const { data: current, error: curErr } = await admin
      .from("profiles")
      .select("role")
      .eq("id", id)
      .maybeSingle();
    if (curErr || !current) {
      return Response.json({ error: "User not found." }, { status: 404 });
    }
    currentRole = (current as { role: string }).role;
  }

  // Auth-side updates (password, display-name metadata).
  if (password !== undefined || fullName !== undefined) {
    const { error } = await admin.auth.admin.updateUserById(id, {
      ...(password !== undefined ? { password } : {}),
      ...(fullName !== undefined
        ? { user_metadata: { full_name: fullName } }
        : {}),
    });
    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // Profile-side updates (role, name shown across the app). Leaving the trial
  // role also re-arms the rates banner, so a future conversion back to trial
  // prompts them again rather than starting silently acknowledged.
  if (fullName !== undefined || role !== undefined) {
    const leavingTrial = role !== undefined && currentRole === "trial" && role !== "trial";
    const becomingTrial = role === "trial" && currentRole !== "trial";
    const { error } = await admin
      .from("profiles")
      .update({
        ...(fullName !== undefined ? { full_name: fullName } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(leavingTrial ? { trial_rates_ack: false } : {}),
        // Entering the trial role re-arms the country picker; leaving it
        // clears the choice so a future conversion back starts fresh rather
        // than silently reusing a market picked long ago.
        ...(becomingTrial || leavingTrial ? { trial_currency: null } : {}),
      })
      .eq("id", id);
    if (error) {
      console.error("PATCH /api/staff/[id] profile update failed:", error);
      return Response.json(
        { error: "Failed to update the user's profile." },
        { status: 500 },
      );
    }

    // Now that the role change has actually stuck, drop the private rate card
    // of an account that just left the trial role — it reads the shared master
    // card from here on. Deliberately AFTER the update (and best-effort): a
    // failure here leaves invisible orphan rows, which is harmless and
    // cascades away when the user is eventually deleted, whereas deleting
    // first and then failing the update would strip a still-trial account's
    // rate card out from under it.
    // Also clears any card left over from a previous stint as a trial, so the
    // picker's own clone starts from nothing.
    if (leavingTrial || becomingTrial) {
      await deleteRateCardForUser(admin, id);
    }
  }

  return Response.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error: authError } = await requireAdminSession();
  if (authError) return authError;
  const { id } = await params;

  if (id === session!.userId) {
    return Response.json(
      { error: "You cannot delete your own account." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // A TRIAL account's work is private to it and worthless to anyone else, so
  // it goes with the account. Staff/admin deletions deliberately do NOT do
  // this: their rows are real company history and stay behind with a nulled
  // created_by (the FK is `on delete set null`).
  //
  // Runs BEFORE deleteUser: once created_by is nulled, these rows can no
  // longer be identified as this user's, and would sit as ownerless clutter
  // nobody but an admin can even see. Their private rate-card rows need no
  // such step — owner_id is `on delete cascade`.
  const { data: target } = await admin
    .from("profiles")
    .select("role")
    .eq("id", id)
    .maybeSingle();

  if ((target as { role: string } | null)?.role === "trial") {
    // Children first: quotes and estimates reference clients.
    for (const table of ["quotes", "estimates", "clients"] as const) {
      const { error: purgeErr } = await admin.from(table).delete().eq("created_by", id);
      if (purgeErr) {
        console.error(`DELETE /api/staff/[id]: failed purging ${table}:`, purgeErr);
        return Response.json(
          { error: "Failed to remove the trial account's data. Nothing was deleted." },
          { status: 500 },
        );
      }
    }
  }

  // Deleting the auth user cascades the profiles row (schema: on delete
  // cascade), the trial rate-card clone (owner_id on delete cascade) and
  // nulls estimates.created_by (on delete set null).
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ ok: true });
}
