import { redirect } from "next/navigation";

import { verifySession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import { loadEstimatesList } from "@/lib/db/estimates";
import { loadClientsList } from "@/lib/db/clients-db";
import { EstimatesPageClient } from "@/components/estimates/estimates-page-client";

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await verifySession();
  if (!session) redirect("/login");

  const { new: openNew } = await searchParams;

  const admin = createAdminClient();
  const [estimates, clients] = await Promise.all([
    loadEstimatesList(admin),
    loadClientsList(admin),
  ]);

  return (
    <EstimatesPageClient
      estimates={estimates}
      clients={clients}
      role={session.role}
      initialShowForm={openNew === "1"}
    />
  );
}
