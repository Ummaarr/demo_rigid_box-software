"use client";

// Step 2 of the quote flow (round 10, client 5-Aug: "can the create quotation
// option not directly lead to a PDF but instead a window, where I am able to
// make necessary changes and then that gets converted into a PDF?").
//
// Laid out like the printed quotation, with every field editable: bill-to,
// per-item description / specs / qty / unit price, the one-time charge lines,
// the notes block and the terms. GST (5% boxes, 18% charges) and the totals
// recompute live as you type.
//
// The arithmetic here is for DISPLAY ONLY — the server recomputes every derived
// number from the same typed values (finalizeQuoteDraft), so what is billed can
// never disagree with what is shown, and a tampered payload cannot skip GST.

import { useMemo, useState } from "react";
import { FileDown, Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NumberField } from "@/components/ui/number-field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineNotice } from "@/components/ui/inline-notice";
import { useCurrencyCode, useMoneyFormatter } from "@/lib/currency-context";

// Mirrors lib/pdf/quotation-data.ts (BOX_GST_PCT / ADDL_GST_PCT). Display only.
const BOX_GST_PCT = 5;
const ADDL_GST_PCT = 18;

export interface DraftCharge {
  label: string;
  qty?: number;
  rate?: number;
  amount: number;
}

export interface DraftItem {
  description: string;
  specsText: string;
  qty: number;
  unitPrice: number;
  charges: DraftCharge[];
}

export interface QuoteDraftState {
  billToCompany: string;
  billToContact: string;
  items: DraftItem[];
  notes: string;
  termsText: string;
}

export function emptyDraftItem(): DraftItem {
  return { description: "", specsText: "", qty: 0, unitPrice: 0, charges: [] };
}

export function QuotePreview({
  initial,
  clientId,
  estimateIds,
  onBack,
  backLabel = "← Back",
}: {
  initial: QuoteDraftState;
  clientId: string;
  /** Provenance; empty for a custom quote (server then never treats it as a revision). */
  estimateIds: string[];
  onBack?: () => void;
  backLabel?: string;
}) {
  const inr = useMoneyFormatter();
  // GST is India-only (5% boxes / 18% charges — see lib/pdf/quotation-data.ts,
  // which this block mirrors). A trial evaluating from another market would
  // otherwise see an Indian tax on their own quote, so it is dropped entirely
  // there rather than guessed at. VAT / US sales tax needs a different shape
  // and stays a documented gap. Admin/staff resolve to INR and are unaffected.
  const gstApplies = useCurrencyCode() === "INR";
  const [draft, setDraft] = useState<QuoteDraftState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null);

  const patchItem = (i: number, p: Partial<DraftItem>) =>
    setDraft((d) => ({
      ...d,
      items: d.items.map((it, idx) => (idx === i ? { ...it, ...p } : it)),
    }));

  const totals = useMemo(() => {
    const subTotal = draft.items.reduce((s, it) => s + it.qty * it.unitPrice, 0);
    const additional = draft.items.reduce(
      (s, it) => s + it.charges.reduce((c, ch) => c + (ch.amount || 0), 0),
      0,
    );
    const boxGst = gstApplies ? (subTotal * BOX_GST_PCT) / 100 : 0;
    const addlGst = gstApplies ? (additional * ADDL_GST_PCT) / 100 : 0;
    return {
      subTotal,
      additional,
      boxGst,
      addlGst,
      grand: subTotal + additional + boxGst + addlGst,
    };
  }, [draft.items, gstApplies]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estimateIds,
          clientId: clientId || undefined,
          draft: {
            billTo: {
              company: draft.billToCompany,
              contact: draft.billToContact || null,
            },
            items: draft.items.map((it) => ({
              description: it.description,
              specsLines: it.specsText.split("\n").map((s) => s.trim()).filter(Boolean),
              qty: it.qty,
              unitPrice: it.unitPrice,
              additionalDetail: it.charges.filter((c) => c.amount > 0),
            })),
            terms: draft.termsText.split("\n").filter((t) => t.trim()),
            notes: draft.notes.trim() || undefined,
          },
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "Failed to generate the PDF.");
        return;
      }
      const quoteNo = res.headers.get("X-Quote-No");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setIssued(quoteNo ? `Quote ${quoteNo} issued and saved.` : "Quote issued and saved.");
    } catch {
      setError("Network error — could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="flex flex-col gap-4">
        {/* Bill to */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Bill to</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="q-company">Company</Label>
              <Input
                id="q-company"
                value={draft.billToCompany}
                onChange={(e) => setDraft((d) => ({ ...d, billToCompany: e.target.value }))}
                placeholder="Customer company name"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="q-contact">Contact person</Label>
              <Input
                id="q-contact"
                value={draft.billToContact}
                onChange={(e) => setDraft((d) => ({ ...d, billToContact: e.target.value }))}
                placeholder="Optional"
              />
            </div>
          </CardContent>
        </Card>

        {/* Line items */}
        {draft.items.map((it, i) => {
          const lineTotal = it.qty * it.unitPrice;
          return (
            <Card key={i}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base">Item {i + 1}</CardTitle>
                {draft.items.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove item ${i + 1}`}
                    onClick={() =>
                      setDraft((d) => ({ ...d, items: d.items.filter((_, idx) => idx !== i) }))
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`q-desc-${i}`}>Description</Label>
                  <Input
                    id={`q-desc-${i}`}
                    value={it.description}
                    onChange={(e) => patchItem(i, { description: e.target.value })}
                    placeholder="e.g. Magnetic closure rigid box"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`q-specs-${i}`}>Specifications (one per line)</Label>
                  <Textarea
                    id={`q-specs-${i}`}
                    className="min-h-20"
                    value={it.specsText}
                    onChange={(e) => patchItem(i, { specsText: e.target.value })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`q-qty-${i}`}>Quantity</Label>
                    <NumberField
                      id={`q-qty-${i}`}
                      step="1"
                      min="0"
                      value={it.qty}
                      onValueChange={(n) => patchItem(i, { qty: n })}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`q-price-${i}`}>Unit price</Label>
                    <NumberField
                      id={`q-price-${i}`}
                      step="0.01"
                      min="0"
                      value={it.unitPrice}
                      onValueChange={(n) => patchItem(i, { unitPrice: n })}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Line total</Label>
                    <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm tabular-nums">
                      {inr(lineTotal)}
                    </div>
                  </div>
                </div>

                {/* One-time charges — billed at 18%, shown as their own block. */}
                <div className="flex flex-col gap-2 border-t pt-3">
                  <div className="flex items-center justify-between">
                    <Label>One-time charges (18% GST)</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        patchItem(i, {
                          charges: [...it.charges, { label: "", amount: 0 }],
                        })
                      }
                    >
                      <Plus className="mr-1 size-3.5" /> Add charge
                    </Button>
                  </div>
                  {it.charges.map((ch, ci) => (
                    <div key={ci} className="flex items-center gap-2">
                      <Input
                        aria-label="Charge description"
                        className="flex-1"
                        value={ch.label}
                        placeholder="e.g. Die · Block · Designer"
                        onChange={(e) =>
                          patchItem(i, {
                            charges: it.charges.map((c, x) =>
                              x === ci ? { ...c, label: e.target.value } : c,
                            ),
                          })
                        }
                      />
                      <NumberField
                        aria-label="Charge amount"
                        className="w-32"
                        step="0.01"
                        min="0"
                        value={ch.amount}
                        onValueChange={(n) =>
                          patchItem(i, {
                            charges: it.charges.map((c, x) =>
                              // qty × rate came from the estimate; once the
                              // amount is typed over, drop them so the PDF
                              // doesn't print "2 × ₹1,500" beside a new figure.
                              x === ci ? { label: c.label, amount: n } : c,
                            ),
                          })
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label="Remove charge"
                        onClick={() =>
                          patchItem(i, { charges: it.charges.filter((_, x) => x !== ci) })
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}

        <Button
          type="button"
          variant="outline"
          onClick={() => setDraft((d) => ({ ...d, items: [...d.items, emptyDraftItem()] }))}
        >
          <Plus className="mr-2 size-4" /> Add item
        </Button>

        {/* Notes + terms */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Notes &amp; terms</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="q-notes">Additional notes</Label>
              <Textarea
                id="q-notes"
                className="min-h-20"
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                placeholder="Anything specific to this quote. Printed above the terms; left out when empty."
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="q-terms">Terms &amp; conditions (one per line)</Label>
              <Textarea
                id="q-terms"
                className="min-h-32"
                value={draft.termsText}
                onChange={(e) => setDraft((d) => ({ ...d, termsText: e.target.value }))}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Totals + issue */}
      <div className="flex flex-col gap-4">
        <Card className="lg:sticky lg:top-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Totals</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 text-sm">
            <Row label="Box subtotal" value={inr(totals.subTotal)} />
            {totals.additional > 0 && (
              <Row label="One-time charges" value={inr(totals.additional)} />
            )}
            {gstApplies && (
              <Row label={`GST @ ${BOX_GST_PCT}% (boxes)`} value={inr(totals.boxGst)} muted />
            )}
            {gstApplies && totals.additional > 0 && (
              <Row label={`GST @ ${ADDL_GST_PCT}% (charges)`} value={inr(totals.addlGst)} muted />
            )}
            <div className="my-1 border-t" />
            <Row label="Grand total" value={inr(totals.grand)} strong />

            <InlineNotice kind="error">{error}</InlineNotice>
            <InlineNotice kind="success" autoDismissMs={0}>
              {issued}
            </InlineNotice>

            <Button className="mt-3 w-full" onClick={generate} disabled={busy}>
              {busy ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <FileDown className="mr-2 size-4" />
              )}
              Generate PDF
            </Button>
            {onBack && (
              <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={onBack}>
                {backLabel}
              </Button>
            )}
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Generating assigns the next quote number, saves the quote and opens
              the PDF. Totals and GST are recalculated on the server from these
              figures.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between ${strong ? "font-semibold" : ""} ${
        muted ? "text-muted-foreground" : ""
      }`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
