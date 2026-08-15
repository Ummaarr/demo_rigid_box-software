"use client";

// Estimates table (round 3 — client 8-Jul column list): Name, client, box
// type, qty, price, total, date, created by, status (inline dropdown), plus
// admin-only delete. Status 'revised' is also set automatically when a re-run
// of the estimate is saved.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  FilterActions,
  FilterBar,
  FilterField,
  FilterGrid,
  FilterReveal,
  FilterToggle,
} from "@/components/ui/filter-panel";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SearchInput } from "@/components/ui/search-input";
import type { EstimateListItem } from "@/lib/db/estimates";
import { boxLabel } from "@/lib/box-types";
import { BOX_LABELS } from "@/lib/box-types";
import { inDateRange, localDateKey } from "@/lib/utils";
import type { BoxType, UserRole } from "@/types";
import { formatMoney } from "@/lib/currency";

const STATUSES = ["draft", "sent", "accepted", "revised"] as const;

const STATUS_STYLES: Record<string, string> = {
  draft: "text-muted-foreground",
  sent: "text-primary",
  accepted: "text-emerald-700",
  revised: "text-amber-700",
};

const ALL = "all";

/** Filter panel state (client 18-Jul — same pattern as the rate card). */
interface EstimateFilters {
  query: string;
  boxType: string;
  status: string;
  client: string;
  createdBy: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: EstimateFilters = {
  query: "",
  boxType: ALL,
  status: ALL,
  client: ALL,
  createdBy: ALL,
  from: "",
  to: "",
};

/** Dropdown filters narrowing the list — the count shown on the Filter button. */
function activeCountOf(f: EstimateFilters): number {
  return (
    (f.boxType !== ALL ? 1 : 0) +
    (f.status !== ALL ? 1 : 0) +
    (f.client !== ALL ? 1 : 0) +
    (f.createdBy !== ALL ? 1 : 0) +
    (f.from !== "" ? 1 : 0) +
    (f.to !== "" ? 1 : 0)
  );
}

const inr = (n: number | null) => (n == null ? "—" : formatMoney(n));

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export function EstimatesList({
  estimates,
  role,
}: {
  estimates: EstimateListItem[];
  role?: UserRole | null;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const isAdmin = role === "admin";
  const [filters, setFilters] = useState<EstimateFilters>(EMPTY_FILTERS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (p: Partial<EstimateFilters>) => setFilters((f) => ({ ...f, ...p }));

  // Option lists come from the rows on screen, so they never offer a value that
  // would match nothing. Box type is the exception — it's a fixed union.
  const clients = useMemo(
    () => [...new Set(estimates.map((e) => e.client_name).filter((v): v is string => !!v))].sort(),
    [estimates],
  );
  const creators = useMemo(
    () => [...new Set(estimates.map((e) => e.created_by_name).filter((v): v is string => !!v))].sort(),
    [estimates],
  );

  // The status a row currently SHOWS — an inline change is applied optimistically,
  // so filtering must agree with the dropdown the user is looking at.
  const statusOf = (e: EstimateListItem) => statuses[e.id] ?? e.status ?? "";

  const activeCount = activeCountOf(filters);
  const filtered = estimates.filter((e) => {
    if (filters.boxType !== ALL && e.box_type !== filters.boxType) return false;
    if (filters.status !== ALL && statusOf(e) !== filters.status) return false;
    if (filters.client !== ALL && (e.client_name ?? "") !== filters.client) return false;
    if (filters.createdBy !== ALL && (e.created_by_name ?? "") !== filters.createdBy) return false;
    if (!inDateRange(localDateKey(e.created_at), filters.from, filters.to)) return false;
    const q = filters.query.trim().toLowerCase();
    if (!q) return true;
    return (
      boxLabel(e.box_type).toLowerCase().includes(q) ||
      (e.name ?? "").toLowerCase().includes(q) ||
      (e.client_name ?? "").toLowerCase().includes(q) ||
      (e.created_by_name ?? "").toLowerCase().includes(q)
    );
  });

  async function setStatus(id: string, status: string) {
    const prev = statuses[id];
    setStatuses((m) => ({ ...m, [id]: status }));
    setError(null);
    try {
      const res = await fetch(`/api/estimate/${id}`, {
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

  async function deleteEstimate(e: EstimateListItem) {
    const label = e.name || `${boxLabel(e.box_type)} × ${e.quantity.toLocaleString()}`;
    const ok = await confirm({
      title: "Delete this estimate?",
      subject: label,
      body: "Quotes already sent keep their own copy and stay intact.",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/estimate/${e.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        setError(j.error ?? "Failed to delete.");
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error — could not reach the server.");
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {confirmDialog}
      {/* Toolbar + panel share one un-gapped group, so a collapsed panel adds
          no stray spacing; the panel's own mt-4 supplies the gap when open. */}
      <div>
        <FilterBar
          search={
            <SearchInput
              size="lg"
              value={filters.query}
              onChange={(query) => patch({ query })}
              placeholder="Search estimates…"
            />
          }
          actions={
            <FilterToggle
              open={panelOpen}
              onToggle={() => setPanelOpen((v) => !v)}
              count={activeCount}
            />
          }
        />

        <FilterReveal open={panelOpen}>
          <FilterGrid>
            <FilterField label="Box Type">
              <NativeSelect
                value={filters.boxType}
                onChange={(e) => patch({ boxType: e.target.value })}
              >
                <option value={ALL}>All Box Types</option>
                {(Object.keys(BOX_LABELS) as BoxType[]).map((bt) => (
                  <option key={bt} value={bt}>{BOX_LABELS[bt]}</option>
                ))}
              </NativeSelect>
            </FilterField>

            <FilterField label="Status">
              <NativeSelect
                value={filters.status}
                onChange={(e) => patch({ status: e.target.value })}
              >
                <option value={ALL}>All Statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s} className="capitalize">{s}</option>
                ))}
              </NativeSelect>
            </FilterField>

            <FilterField label="Client">
              <NativeSelect
                value={filters.client}
                onChange={(e) => patch({ client: e.target.value })}
                disabled={clients.length === 0}
              >
                <option value={ALL}>
                  {clients.length === 0 ? "No clients yet" : "All Clients"}
                </option>
                {clients.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </NativeSelect>
            </FilterField>

            <FilterField label="Created By">
              <NativeSelect
                value={filters.createdBy}
                onChange={(e) => patch({ createdBy: e.target.value })}
                disabled={creators.length === 0}
              >
                <option value={ALL}>
                  {creators.length === 0 ? "No staff recorded" : "All Staff"}
                </option>
                {creators.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </NativeSelect>
            </FilterField>

            <div className="grid grid-cols-2 gap-3">
              <FilterField label="Created From">
                <Input
                  type="date"
                  className="h-8"
                  value={filters.from}
                  onChange={(e) => patch({ from: e.target.value })}
                />
              </FilterField>
              <FilterField label="Created To">
                <Input
                  type="date"
                  className="h-8"
                  value={filters.to}
                  onChange={(e) => patch({ to: e.target.value })}
                />
              </FilterField>
            </div>

            <FilterActions
              onClear={() => setFilters(EMPTY_FILTERS)}
              disabled={activeCount === 0 && filters.query === ""}
            />
          </FilterGrid>
        </FilterReveal>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No estimates match.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Box type</th>
                <th className="px-4 py-3 text-right font-medium">Qty</th>
                <th className="px-4 py-3 text-right font-medium">Price / box</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">By</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-t transition-colors hover:bg-muted/20">
                  <td className="max-w-44 truncate px-4 py-3 font-medium">
                    {e.name || <span className="font-normal text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{e.client_name ?? "—"}</td>
                  <td className="px-4 py-3">{boxLabel(e.box_type)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {e.quantity.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{inr(e.price_per_box)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{inr(e.total_price)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {fmtDate(e.created_at)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {e.created_by_name ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {e.status != null ? (
                      <NativeSelect
                        aria-label="Estimate status"
                        className={`h-8 w-28 text-xs capitalize ${STATUS_STYLES[statuses[e.id] ?? e.status] ?? ""}`}
                        value={statuses[e.id] ?? e.status}
                        onChange={(ev) => setStatus(e.id, ev.target.value)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-2">
                      <Link
                        href={`/estimates/${e.id}`}
                        className="text-xs text-primary underline-offset-2 hover:underline"
                      >
                        View
                      </Link>
                      {isAdmin && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground/60 hover:text-destructive"
                          disabled={busy}
                          onClick={() => void deleteEstimate(e)}
                          title="Delete estimate"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length !== estimates.length && (
        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {estimates.length}
        </p>
      )}
    </div>
  );
}
