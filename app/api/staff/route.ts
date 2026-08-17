// POST /api/staff
// Admin-only: provision a new user (Staff, Admin, or a short-lived Trial lead
// account) directly with an email + password so the account works immediately
// (no SMTP/invite needed). Uses the Supabase Auth admin API (service role)
// server-side only — the key never reaches the browser. Re-checks admin here
// (defense in depth beyond the page).
//
// A TRIAL user also gets a private clone of the master rate card, so they can
// enter their own real material costs without seeing or touching anyone
// else's — but NOT here. Since multi-currency, the master card is four
// per-market template sets, and which one to copy isn't known until the lead
// picks their country on first login. Cloning therefore happens in
// POST /api/trial/set-currency, and a freshly created trial account
// deliberately has a profiles row and nothing else until then.

import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CreateStaffBody {
  email?: string;
  fullName?: string;
  password?: string;
  role?: string;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (session.role !== "admin") {
    return Response.json({ error: "Admins only." }, { status: 403 });
  }

  let body: CreateStaffBody;
  try {
    body = (await request.json()) as CreateStaffBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const fullName = String(body.fullName ?? "").trim();
  const password = String(body.password ?? "");
  const role = String(body.role ?? "staff");

  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!fullName) {
    return Response.json({ error: "Full name is required." }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }
  if (role !== "staff" && role !== "admin" && role !== "trial") {
    return Response.json({ error: "Invalid role." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (error || !data.user) {
    const msg = error?.message ?? "Failed to create user.";
    const duplicate = /already|registered|exists/i.test(msg);
    return Response.json(
      { error: duplicate ? "A user with this email already exists." : msg },
      { status: duplicate ? 409 : 400 },
    );
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: data.user.id,
    role,
    full_name: fullName,
  });

  if (profileError) {
    // Roll back the auth user so we don't leave an account without a role.
    await admin.auth.admin.deleteUser(data.user.id);
    console.error("POST /api/staff profile insert failed:", profileError);
    return Response.json(
      { error: "Failed to assign the user's role. Please try again." },
      { status: 500 },
    );
  }

  return Response.json(
    { id: data.user.id, email, role },
    { status: 201 },
  );
}
