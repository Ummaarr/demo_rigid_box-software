import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Privileged Supabase client using the service_role key. BYPASSES Row Level
 * Security — use only in trusted server code after the caller's role has been
 * verified (see lib/auth.ts). The service_role key must never reach the browser.
 *
 * Use this for privileged reads/writes (e.g. reading any user's profile,
 * managing rates). For normal session-scoped access, use createClient() from
 * ./server instead.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
