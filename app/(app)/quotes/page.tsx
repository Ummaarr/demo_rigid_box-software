// Quotes list (round 3): every generated quotation is saved with a real
// FY-sequence number and tracked here — quote no, client, items, date, total,
// status (client 8-Jul). Search covers quote number + client name, which also
// answers the clients-page "search any quotes that have been sent" ask.

import Link from "next/link";
import { ReceiptText } from "lucide-react";

import { verifySession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import { loadQuotesList } from "@/lib/db/quotes";
import { QuotesList } from "@/components/quotes/quotes-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";

export default async function QuotesPage() {
  await verifySession();
  const quotes = await loadQuotesList(createAdminClient());

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Quotes"
        description="Every generated quotation, numbered and tracked."
      >
        <Link href="/quotes/new" className={buttonVariants({ size: "lg" })}>
          <ReceiptText data-icon="inline-start" /> Create quote
        </Link>
      </PageHeader>

      {quotes === null ? (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Quote tracking needs a one-time database update — run{" "}
          <code className="font-mono">supabase/migration-round3.sql</code> in the
          Supabase SQL editor. Until then quotes still generate as PDFs, they
          just aren&apos;t saved here.
        </div>
      ) : (
        <QuotesList quotes={quotes} />
      )}
    </div>
  );
}
