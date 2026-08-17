// Authenticated app shell (efferd app-shell-3, rewired to our routes + auth).
// Every signed-in page lives under this route group so it gets the persistent
// sidebar + header. verifySession() redirects logged-out users to /login.

import { verifySession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import { AppShell } from "@/components/app-shell";
import { TrialCurrencyPicker } from "@/components/trial-currency-picker";
import { TrialRateReview } from "@/components/trial-rate-review";
import { currencyMetaFor } from "@/lib/currency-meta";

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

  // A trial who hasn't picked their market yet has NO rate card (cloning is
  // deferred to that choice — see app/api/trial/set-currency), so every page
  // below would resolve against an empty card. Block on the picker instead of
  // rendering the shell. Admin/staff never match this.
  if (session.role === "trial" && !session.trialCurrency) {
    return <TrialCurrencyPicker />;
  }

  const meta = currencyMetaFor(session);

  // Second gate: the card they just had cloned is seeded with OUR figures, and
  // an estimate built on it means nothing until they've checked it. This used
  // to be a dismissible banner over the dashboard, which was too easy to miss
  // — the failure is silent, so it gets its own step now. Ordering matters:
  // currency is resolved first, so the card it points at is the one that
  // choice just cloned. Both of its buttons acknowledge, so it shows once.
  if (session.role === "trial" && !session.trialRatesAck && meta) {
    return <TrialRateReview currency={meta.code} />;
  }

  const pendingRates = session.role === "admin" ? await pendingRateCount() : 0;

  return (
    <AppShell
      role={session.role}
      fullName={session.fullName}
      email={session.email}
      pendingRates={pendingRates}
      currency={meta && { code: meta.code, symbol: meta.symbol, locale: meta.locale }}
    >
      {children}
    </AppShell>
  );
}
