// Quote creation. Round 10 made this a TWO-STEP flow (client 5-Aug): pick a
// source (saved estimates, or a blank custom quote), then review and edit the
// whole document — bill-to, per-item description/specs/qty/unit price, one-time
// charges, notes and terms — before anything is numbered, saved or rendered.
// Spec text is no longer precomputed here: /api/quote/preview returns the
// fully-built quote, so the editor and the PDF start from the same object.

import { redirect } from "next/navigation";

import { verifySession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import { loadEstimatesList } from "@/lib/db/estimates";
import { loadClientsList } from "@/lib/db/clients-db";
import { DEFAULT_TERMS } from "@/lib/pdf/quotation-data";
import { QuoteBuilder } from "@/components/quotes/quote-builder";
import { PageHeader } from "@/components/page-header";

export default async function QuotesNewPage() {
  const session = await verifySession();
  if (!session) redirect("/login");

  const admin = createAdminClient();
  const [estimates, clients] = await Promise.all([
    loadEstimatesList(admin),
    loadClientsList(admin),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 lg:p-8">
      <PageHeader
        title="Create quotation"
        description="Build from saved estimates or from scratch, review and edit every line, then generate the PDF."
      />
      <QuoteBuilder estimates={estimates} clients={clients} defaultTerms={DEFAULT_TERMS} />
    </div>
  );
}
