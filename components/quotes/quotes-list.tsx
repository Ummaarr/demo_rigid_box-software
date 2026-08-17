"use client";

// Saved-quotes table (round 3): search (quote no / client), inline status
// dropdown (PATCH /api/quote/[id]) and a PDF re-render from the stored
// snapshot. Columns per the client's 8-Jul list.

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileDown, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { QuoteListItem } from "@/lib/db/quotes";
import { useMoneyFormatter } from "@/lib/currency-context";

const STATUSES = ["draft", "sent", "accepted", "rejected", "revised"] as const;


const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const STATUS_STYLES: Record<string, string> = {
  draft: "text-muted-foreground",
  sent: "text-primary",
  accepted: "text-emerald-700",
  rejected: "text-destructive",
  revised: "text-amber-700",
};

export function QuotesList({ quotes }: { quotes: QuoteListItem[] }) {
  const inr = useMoneyFormatter();
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // Status filter (client item 14): the dashboard's quote tiles link here with
  // ?status=…, and the dropdown keeps it changeable once you land.
  const params = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(params.get("status") ?? "");

  const filtered = quotes.filter((q) => {
    // Filter on the OPTIMISTIC status so a row can't contradict its own
    // dropdown while a PATCH is in flight.
    if (statusFilter && (statuses[q.id] ?? q.status) !== statusFilter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      q.quote_no.toLowerCase().includes(s) ||
      q.client_name.toLowerCase().includes(s)
    );
  });

  async function setStatus(id: string, status: string) {
    const prev = statuses[id];
    setStatuses((m) => ({ ...m, [id]: status }));
    setError(null);
    try {
      const res = await fetch(`/api/quote/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        setError(j.error ?? "Failed to update status.");
        setStatuses((m) => ({ ...m, [id]: prev ?? "" }));
      }
    } catch {
      setError("Network error — could not reach the server.");
      setStatuses((m) => ({ ...m, [id]: prev ?? "" }));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search quote no. or client…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <NativeSelect
          aria-label="Filter by status"
          className="h-9 w-40 capitalize"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s} className="capitalize">{s}</option>
          ))}
        </NativeSelect>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-lg border">
        {filtered.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            {quotes.length === 0 ? "No quotes generated yet." : "No quotes match."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Quote no.</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 text-right font-medium">Items</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => (
                <tr key={q.id} className="border-t">
                  <td className="px-4 py-2.5 font-mono text-xs">{q.quote_no}</td>
                  <td className="px-4 py-2.5">{q.client_name}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{q.items_count}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                    {fmtDate(q.created_at)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{inr(q.grand_total)}</td>
                  <td className="px-4 py-2.5">
                    <NativeSelect
                      aria-label="Quote status"
                      className={`h-8 w-28 text-xs capitalize ${STATUS_STYLES[statuses[q.id] ?? q.status] ?? ""}`}
                      value={statuses[q.id] ?? q.status}
                      onChange={(e) => setStatus(q.id, e.target.value)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </NativeSelect>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <a
                      href={`/api/quote/${q.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <FileDown className="h-3.5 w-3.5" /> PDF
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
