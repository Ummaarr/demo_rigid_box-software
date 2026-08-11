// Dedicated "Add client" page (avama-style create flow). Mirrors how the
// reference admin creates staff — a full page with a back link + form, rather
// than a slide-over sheet.

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { verifySession } from "@/lib/auth";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { ClientCreatePanel } from "@/components/clients/client-create-panel";

export default async function NewClientPage() {
  const session = await verifySession();
  if (!session) redirect("/login");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 lg:p-8">
      <div className="flex flex-col gap-4">
        <Link
          href="/clients"
          className={buttonVariants({ variant: "ghost", size: "sm" }) + " self-start"}
        >
          <ArrowLeft data-icon="inline-start" />
          Back to clients
        </Link>
        <PageHeader
          title="Add new client"
          description="New contacts default to Lead — mark Customer once they've ordered."
        />
      </div>

      <ClientCreatePanel />
    </div>
  );
}
