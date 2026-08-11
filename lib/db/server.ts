import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for use in Server Components, Server Actions, and Route
 * Handlers. Uses the public anon key and is bound to the request's cookies so
 * the user's auth session is read/refreshed. RLS applies to this client.
 *
 * Per project rules, the browser NEVER talks to Supabase directly — all access
 * goes through server code that uses this (or the admin) client.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore because the
            // proxy refreshes the session cookie on every request.
          }
        },
      },
    },
  );
}
