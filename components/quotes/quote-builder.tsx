"use client";

// Quote creation, step 1 (round 10). Two ways in:
//   • From estimates — pick one or more saved estimates; "Review quote" builds
//     the document server-side and hands it to the editor.
//   • Custom quote   — start blank and type everything (client 5-Aug).
//
// Neither path generates anything here: numbering, saving and rendering all
// happen when the user approves the draft on step 2 (QuotePreview). Before
// round 10 this screen posted straight to /api/quote and opened a PDF, with
// only description/specs/terms editable behind a collapsed disclosure.

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineNotice } from "@/components/ui/inline-notice";
import { ClientCombobox } from "@/components/clients/client-combobox";
import {
  QuotePreview,
  emptyDraftItem,
  type DraftCharge,
  type QuoteDraftState,
} from "@/components/quotes/quote-preview";
import type { EstimateListItem } from "@/lib/db/estimates";
import type { ClientRow } from "@/lib/db/clients-db";
import { boxLabel } from "@/lib/box-types";
import { useMoneyFormatter } from "@/lib/currency-context";


const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/** The preview API's QuotationData -> the editor's state shape. */
interface PreviewResponse {
  billTo?: { company?: string; contact?: string | null };
  items?: {
    description?: string;
    specsLines?: string[];
    qty?: number;
    unitPrice?: number;
    additionalDetail?: DraftCharge[];
  }[];
  terms?: string[];
  notes?: string;
}

function toDraftState(data: PreviewResponse): QuoteDraftState {
  return {
    billToCompany: data.billTo?.company === "—" ? "" : (data.billTo?.company ?? ""),
    billToContact: data.billTo?.contact ?? "",
    items: (data.items ?? []).map((it) => ({
      description: it.description ?? "",
      specsText: (it.specsLines ?? []).join("\n"),
      qty: it.qty ?? 0,
      unitPrice: it.unitPrice ?? 0,
      charges: it.additionalDetail ?? [],
    })),
    notes: data.notes ?? "",
    termsText: (data.terms ?? []).join("\n"),
  };
}

export function QuoteBuilder({
  estimates,
  clients,
  defaultTerms = [],
}: {
  estimates: EstimateListItem[];
  clients: ClientRow[];
  defaultTerms?: string[];
}) {
  const money = useMoneyFormatter();
  const inr = (n: number | null) => (n == null ? "—" : money(n));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clientId, setClientId] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Round 10: "from estimates" vs a fully manual quote, plus a review step
  // between selecting and generating. `draft` non-null = we are on step 2.
  const [mode, setMode] = useState<"estimates" | "custom">("estimates");
  const [draft, setDraft] = useState<QuoteDraftState | null>(null);

  const filtered = estimates.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      boxLabel(e.box_type).toLowerCase().includes(q) ||
      (e.client_name ?? "").toLowerCase().includes(q)
    );
  });

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((e) => e.id)));
  }

  /** Step 1 -> step 2: compute the quote server-side, then hand it to the
   *  editor. Nothing is numbered or saved until the user approves it. */
  function review() {
    if (!selected.size) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/quote/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            estimateIds: [...selected],
            clientId: clientId || undefined,
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setError(j.error ?? "Failed to build the quote preview.");
          return;
        }
        setDraft(toDraftState((await res.json()) as PreviewResponse));
      } catch {
        setError("Network error — could not reach the server.");
      }
    });
  }

  /** A blank quote with no estimate behind it (client 5-Aug). */
  function startCustom() {
    setError(null);
    setDraft({
      billToCompany: "",
      billToContact: "",
      items: [emptyDraftItem()],
      notes: "",
      termsText: defaultTerms.join("\n"),
    });
  }

  // --- Step 2 — review, edit, generate -------------------------------------
  if (draft) {
    return (
      <QuotePreview
        initial={draft}
        clientId={clientId}
        // Empty for a custom quote: the server then never treats it as a
        // revision of an existing quote and gives it a fresh FY number.
        estimateIds={mode === "custom" ? [] : [...selected]}
        onBack={() => setDraft(null)}
        backLabel={mode === "custom" ? "← Start over" : "← Back to selection"}
      />
    );
  }

  // --- Step 1 — choose a source --------------------------------------------
  return (
    <div className="flex flex-col gap-4">
      <Segmented
        className="self-start"
        value={mode}
        onValueChange={(m) => {
          setMode(m as "estimates" | "custom");
          setError(null);
        }}
        options={[
          { value: "estimates", label: "From estimates" },
          { value: "custom", label: "Custom quote" },
        ]}
      />

      {mode === "custom" ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Custom quotation</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-4">
            <p className="max-w-prose text-sm text-muted-foreground">
              Build a quotation by hand, with no estimate behind it — the same
              fields, the same automatic GST (5% on boxes, 18% on one-time
              charges), and it is numbered and saved like any other quote.
            </p>
            <div className="flex w-full max-w-sm flex-col gap-2">
              <Label>Bill to (client)</Label>
              <ClientCombobox
                clients={clients}
                value={clientId}
                onChange={setClientId}
                placeholder="Type to search clients…"
                noneLabel="— enter manually —"
              />
            </div>
            <Button onClick={startCustom}>
              Start a custom quote <ArrowRight className="ml-2 size-4" />
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Estimate selector */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search box type or client…"
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Button variant="outline" size="sm" onClick={toggleAll}>
                {selected.size === filtered.length && filtered.length > 0
                  ? "Deselect all"
                  : "Select all"}
              </Button>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              {filtered.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No estimates match.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="w-10 px-4 py-3" />
                      <th className="px-4 py-3 font-medium">Box type</th>
                      <th className="px-4 py-3 font-medium">Client</th>
                      <th className="px-4 py-3 text-right font-medium">Qty</th>
                      <th className="px-4 py-3 text-right font-medium">Total</th>
                      <th className="px-4 py-3 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((e) => {
                      const isSel = selected.has(e.id);
                      return (
                        <tr
                          key={e.id}
                          className={`cursor-pointer border-t transition-colors ${
                            isSel ? "bg-primary/5" : "hover:bg-muted/20"
                          }`}
                          onClick={() => toggle(e.id)}
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={isSel}
                              onChange={() => toggle(e.id)}
                              onClick={(ev) => ev.stopPropagation()}
                              className="size-4 rounded accent-primary"
                            />
                          </td>
                          <td className="px-4 py-3">{boxLabel(e.box_type)}</td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {e.client_name ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {e.quantity.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {inr(e.total_price)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                            {fmtDate(e.created_at)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Right panel */}
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Quote options</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Bill to (client)</Label>
                  <ClientCombobox
                    clients={clients}
                    value={clientId}
                    onChange={setClientId}
                    placeholder="Type to search clients…"
                    noneLabel="— auto (from estimate) —"
                  />
                  <p className="text-xs text-muted-foreground">
                    Overrides the client on individual estimates.
                  </p>
                </div>

                <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Estimates selected</span>
                    <span className="font-medium tabular-nums">{selected.size}</span>
                  </div>
                </div>

                <InlineNotice kind="error">{error}</InlineNotice>

                <Button onClick={review} disabled={selected.size === 0 || isPending} className="w-full">
                  {isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="mr-2 h-4 w-4" />
                  )}
                  Review quote
                </Button>

                <Link
                  href="/estimates"
                  className="text-center text-xs text-muted-foreground hover:underline"
                >
                  ← Back to estimates
                </Link>
              </CardContent>
            </Card>

            <p className="text-xs leading-relaxed text-muted-foreground">
              Each selected estimate becomes one line item. You can edit
              everything — descriptions, specs, quantities, prices, charges and
              terms — on the next screen before the PDF is generated.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
