// PATCH /api/staff/[id] — edit a user (name / role / reset password).
// DELETE /api/staff/[id] — remove a user's login entirely.
// Admin-only, mirroring POST /api/staff (defense in depth beyond the page).
// Self-guards: an admin cannot demote or delete their OWN account — that's the
// easiest way to lock the last admin out of the app.

import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";

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
  if (role !== undefined && role !== "staff" && role !== "admin") {
    return Response.json({ error: "Invalid role." }, { status: 400 });
  }
  if (password !== undefined && password.length < 8) {
    return Response.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }
  if (role === "staff" && id === session!.userId) {
    return Response.json(
      { error: "You cannot demote your own account." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

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

  // Profile-side updates (role, name shown across the app).
  if (fullName !== undefined || role !== undefined) {
    const { error } = await admin
      .from("profiles")
      .update({
        ...(fullName !== undefined ? { full_name: fullName } : {}),
        ...(role !== undefined ? { role } : {}),
      })
      .eq("id", id);
    if (error) {
      console.error("PATCH /api/staff/[id] profile update failed:", error);
      return Response.json(
        { error: "Failed to update the user's profile." },
        { status: 500 },
      );
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

  // Deleting the auth user cascades the profiles row (schema: on delete
  // cascade) and nulls estimates.created_by (on delete set null).
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ ok: true });
}
