import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Saved quotes (round 3). The list shows the client's requested columns:
// quote number, client name, number of items, date created, total price, status.
export interface QuoteListItem {
  id: string;
  quote_no: string;
  /** From the bill_to snapshot — stable even if the client row changes later. */
  client_name: string;
  items_count: number;
  grand_total: number;
  status: string;
  created_at: string;
}

/**
 * Load all saved quotes, newest first. Returns null when the quotes table
 * doesn't exist yet (live DB pre-migration-round3.sql) so the page can show a
 * "run the migration" notice instead of crashing.
 */
export async function loadQuotesList(
  supabase: SupabaseClient,
): Promise<QuoteListItem[] | null> {
  const { data, error } = await supabase
    .from("quotes")
    .select("id, quote_no, bill_to, items, grand_total, status, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    // 42P01 = undefined table (pre-migration DB).
    if (error.code === "42P01") return null;
    throw new Error(`quotes load failed: ${error.message}`);
  }

  return (data ?? []).map((q) => ({
    id: q.id as string,
    quote_no: q.quote_no as string,
    client_name:
      ((q.bill_to as { company?: string } | null)?.company ?? "—") || "—",
    items_count: Array.isArray(q.items) ? q.items.length : 0,
    grand_total: Number(q.grand_total),
    status: (q.status as string) ?? "sent",
    created_at: q.created_at as string,
  }));
}
