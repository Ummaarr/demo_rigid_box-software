import { redirect } from "next/navigation";

import { verifySession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import { loadClientsList } from "@/lib/db/clients-db";
import Link from "next/link";
import { Plus } from "lucide-react";

import { ClientList } from "@/components/clients/client-list";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";

export default async function ClientsPage() {
  const session = await verifySession();
  if (!session) redirect("/login");

  const clients = await loadClientsList(createAdminClient());

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title="Clients" description="Leads and customers in one place.">
        <Link href="/clients/new" className={buttonVariants({ size: "lg" })}>
          <Plus data-icon="inline-start" />
          Add client
        </Link>
      </PageHeader>

      <ClientList clients={clients} role={session.role} />
    </div>
  );
}
