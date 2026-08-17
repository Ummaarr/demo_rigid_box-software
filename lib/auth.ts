import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/db/server";
import { isCurrencyCode } from "@/lib/currency-meta";
import type { SessionInfo, UserRole } from "@/types";

/**
 * Data Access Layer for auth (per Next.js security guidance).
 *
 * verifySession() is the single place every Server Component / Action / Route
 * Handler calls to confirm the user is logged in and to learn their role.
 * It validates the session with Supabase (auth.getUser contacts the auth
 * server) and loads the role from the profiles table. Wrapped in React cache()
 * so it runs at most once per request render pass.
 *
 * On no session it redirects to /login, so callers can treat the return value
 * as a guaranteed-authenticated user.
 */
/**
 * Like verifySession() but returns null instead of redirecting when there is no
 * session. Use this in Route Handlers (API), which must answer with a 401 JSON
 * response rather than an HTML redirect. Wrapped in cache() so it runs at most
 * once per request render pass.
 */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // RLS lets an authenticated user read only their own profile row.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, trial_rates_ack, trial_currency")
    .eq("id", user.id)
    .single();

  return {
    userId: user.id,
    role: (profile?.role as UserRole | undefined) ?? null,
    fullName: profile?.full_name ?? null,
    email: user.email ?? null,
    trialRatesAck: profile?.trial_rates_ack ?? false,
    // Validated rather than cast: a value outside the four known codes would
    // otherwise reach CURRENCY_META and index to undefined at render time.
    trialCurrency: isCurrencyCode(profile?.trial_currency) ? profile.trial_currency : null,
  };
});

export const verifySession = cache(async (): Promise<SessionInfo> => {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
});

/**
 * For admin-only operations. Returns the session if the user is an admin,
 * otherwise null. Route Handlers should translate a null result into a 403;
 * pages/components should hide admin UI. (No admin-only routes exist yet in
 * Phase 1 — this is the shared guard for Phase 7 onward.)
 */
export async function requireAdmin(): Promise<SessionInfo | null> {
  const session = await verifySession();
  return session.role === "admin" ? session : null;
}

/**
 * The data scope for a session: null = unrestricted (admin/staff — the
 * shared master rate card and every client/estimate/quote, exactly as
 * before); a trial user's own id = ONLY their own rows.
 *
 * Used for both `owner_id` (their private rate-card clone) and `created_by`
 * (their own clients/estimates/quotes) — the same id scopes both. Single
 * source of truth: every scoped read and write derives it from the session
 * here, never from a client-sent value.
 */
export function ownerScopeFor(session: Pick<SessionInfo, "role" | "userId">): string | null {
  return session.role === "trial" ? session.userId : null;
}
