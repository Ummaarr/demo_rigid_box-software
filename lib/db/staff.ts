import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Lists all app users (admin-only feature). Email lives in auth.users (via the
// Auth admin API); role + name live in public.profiles. We merge the two.
// Admin client only — runs in trusted server code after the caller is verified.

export interface StaffUser {
  id: string;
  email: string | null;
  fullName: string | null;
  role: string | null;
  createdAt: string;
}

export async function loadStaff(admin: SupabaseClient): Promise<StaffUser[]> {
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) throw new Error(`list users failed: ${error.message}`);

  const users = data.users ?? [];
  const ids = users.map((u) => u.id);

  const profilesRes = ids.length
    ? await admin.from("profiles").select("id, role, full_name").in("id", ids)
    : { data: [] as { id: string; role: string | null; full_name: string | null }[], error: null };
  if (profilesRes.error)
    throw new Error(`load profiles failed: ${profilesRes.error.message}`);

  const profileById = new Map(
    (profilesRes.data ?? []).map((p) => [p.id, p]),
  );

  return users
    .map((u) => {
      const p = profileById.get(u.id);
      return {
        id: u.id,
        email: u.email ?? null,
        fullName: p?.full_name ?? (u.user_metadata?.full_name as string | undefined) ?? null,
        role: p?.role ?? null,
        createdAt: u.created_at,
      };
    })
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}
