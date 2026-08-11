// Rate management. Round 3: STAFF can now open this page too — they see the
// rate card read-only (margin + app config stripped SERVER-SIDE in
// loadAllRates) and can PROPOSE changes; admins edit directly and get a
// pending-proposals strip to approve/reject.

import { verifySession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import { loadAllRates } from "@/lib/db/rate-admin";
import { RateCard } from "@/components/rates/rate-card";
import { PendingChanges, type PendingChange } from "@/components/rates/pending-changes";
import { PageHeader } from "@/components/page-header";

async function loadPending(): Promise<PendingChange[]> {
  const { data, error } = await createAdminClient()
    .from("rate_change_requests")
    .select("id, row_label, field, old_value, new_value, proposed_by_name, proposed_at")
    .eq("status", "pending")
    .order("proposed_at");
  // Missing table = pre-round-3 DB; the strip simply doesn't render.
  return error ? [] : ((data ?? []) as PendingChange[]);
}

export default async function RatesPage() {
  const session = await verifySession();
  const isAdmin = session.role === "admin";

  const [sections, pending] = await Promise.all([
    loadAllRates(createAdminClient(), session.role),
    isAdmin ? loadPending() : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Rates"
        description={
          isAdmin
            ? "Click any value to edit inline. Saving a rate auto-marks it as Real. Click the status badge to toggle manually."
            : "Rates are read-only for staff — click any value to propose a change; an admin approves it before it applies."
        }
      />

      {isAdmin && <PendingChanges requests={pending} />}

      <RateCard sections={sections} role={session.role} />
    </div>
  );
}
