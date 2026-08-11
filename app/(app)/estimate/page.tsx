// New-estimate page (Phase 6). Authenticated; passes the caller's role to the
// client form so it can hide admin-only inputs (margin etc.). The form itself
// talks to the Phase 4 API routes. Chrome (sidebar) comes from the (app) layout.
// When ?from=<id> is present the form is pre-filled from the saved estimate's
// specs_snapshot (edit / re-run flow).

import { verifySession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import { loadEstimateDetail } from "@/lib/db/estimates";
import { loadClientsList } from "@/lib/db/clients-db";
import { EstimateForm } from "@/components/estimate/estimate-form";
import { PageHeader } from "@/components/page-header";
import type { EstimateRequest } from "@/types";

export default async function EstimatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await verifySession();
  const { from } = await searchParams;

  const admin = createAdminClient();
  const [detail, clients] = await Promise.all([
    from ? loadEstimateDetail(admin, from) : Promise.resolve(null),
    loadClientsList(admin),
  ]);
  const initialSpecs: EstimateRequest | undefined = detail?.specs_snapshot;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 lg:p-8">
      <PageHeader
        title={initialSpecs ? "Re-run estimate" : "New estimate"}
        description={`${session.fullName ?? "—"} · ${session.role ?? "no role"}`}
      />

      <EstimateForm
        role={session.role}
        initialSpecs={initialSpecs}
        // Saving a re-run marks the source estimate 'revised' (client 8-Jul).
        sourceEstimateId={detail ? from : undefined}
        clients={clients}
      />
    </div>
  );
}
