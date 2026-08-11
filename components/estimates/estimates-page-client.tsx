"use client";

// "New estimate" used to navigate to a separate /estimate page. It now opens
// the same EstimateForm inline on this page (toggled state, no navigation) —
// the form is too wide/complex for a slide-over, so it swaps in place instead.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FilePlus2, ReceiptText } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { EstimatesList } from "@/components/estimates/estimates-list";
import { EstimateForm } from "@/components/estimate/estimate-form";
import { PageHeader } from "@/components/page-header";
import type { EstimateListItem } from "@/lib/db/estimates";
import type { ClientRow } from "@/lib/db/clients-db";
import type { UserRole } from "@/types";

export function EstimatesPageClient({
  estimates,
  clients,
  role,
  initialShowForm = false,
}: {
  estimates: EstimateListItem[];
  clients: ClientRow[];
  role: UserRole | null;
  /** Open the inline form on mount (from /estimates?new=1). */
  initialShowForm?: boolean;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(initialShowForm);

  function closeForm() {
    setShowForm(false);
    // Drop ?new=1 from the URL so a refresh/back doesn't reopen the form.
    router.replace("/estimates");
    router.refresh();
  }

  if (showForm) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 lg:p-8">
        <PageHeader
          title="New estimate"
          description="Fill the spec, calculate, then save."
        >
          <Button variant="outline" size="sm" onClick={closeForm}>
            <ArrowLeft data-icon="inline-start" />
            Back to estimates
          </Button>
        </PageHeader>

        <EstimateForm role={role} clients={clients} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Estimates"
        description={`${estimates.length} saved`}
      >
        <Link
          href="/quotes/new"
          className={buttonVariants({ size: "lg", variant: "outline" })}
        >
          <ReceiptText data-icon="inline-start" />
          Create quote
        </Link>
        <Button size="lg" onClick={() => setShowForm(true)}>
          <FilePlus2 data-icon="inline-start" />
          New estimate
        </Button>
      </PageHeader>

      <EstimatesList estimates={estimates} role={role} />
    </div>
  );
}
