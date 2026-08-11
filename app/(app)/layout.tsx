// Authenticated app shell (efferd app-shell-3, rewired to our routes + auth).
// Every signed-in page lives under this route group so it gets the persistent
// sidebar + header. verifySession() redirects logged-out users to /login.

import { verifySession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import { AppShell } from "@/components/app-shell";

/** Pending rate-change proposals (admin sidebar badge). 0 on a pre-round-3 DB. */
async function pendingRateCount(): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("rate_change_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return error ? 0 : count ?? 0;
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await verifySession();
  const pendingRates = session.role === "admin" ? await pendingRateCount() : 0;

  return (
    <AppShell
      role={session.role}
      fullName={session.fullName}
      email={session.email}
      pendingRates={pendingRates}
    >
      {children}
    </AppShell>
  );
}
