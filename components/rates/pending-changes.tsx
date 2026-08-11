"use client";

// Pending rate-change proposals (round 3): admins see old → new per request and
// approve/reject inline. Approving applies the change through the same
// validated path as a direct edit (PATCH /api/rates/propose).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineNotice } from "@/components/ui/inline-notice";

export interface PendingChange {
  id: number;
  row_label: string | null;
  field: string;
  old_value: string | null; // JSON-encoded
  new_value: string; // JSON-encoded
  proposed_by_name: string | null;
  proposed_at: string;
}

const showVal = (json: string | null): string => {
  if (json == null) return "—";
  try {
    const v = JSON.parse(json) as unknown;
    return v == null ? "—" : String(v);
  } catch {
    return json;
  }
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

/** Read a motion token back into JS so the timeout stays in sync with the CSS. */
function readMs(name: string, fallback: number) {
  if (typeof document === "undefined") return fallback;
  const n = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name),
  );
  return Number.isFinite(n) ? n : fallback;
}

export function PendingChanges({ requests }: { requests: PendingChange[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  /** Decided but still collapsing — rendered, but with the reveal closed. */
  const [leaving, setLeaving] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const open = requests.filter((r) => !done.has(r.id));
  if (open.length === 0) return null;

  async function decide(id: number, action: "approve" | "reject") {
    setBusy(id);
    setErr(null);
    try {
      const r = await fetch("/api/rates/propose", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Failed to decide.");
      }
      // Collapse the row out before dropping it, so the admin sees the
      // decision land instead of the row blinking away. `leaving` drives the
      // .t-reveal collapse; `done` (which removes it) follows one beat later.
      setLeaving((s) => new Set(s).add(id));
      const ms = readMs("--reveal-dur", 260);
      setTimeout(() => {
        setDone((s) => new Set(s).add(id));
        // Approved values changed rate rows — refresh the server-rendered tables.
        if (action === "approve") router.refresh();
      }, ms);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(null);
  }

  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">
          Proposed rate changes ({open.length} pending)
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col pt-0">
        <InlineNotice kind="error">{err}</InlineNotice>
        {open.map((r) => (
          <div key={r.id} className="t-reveal" data-open={!leaving.has(r.id) || undefined}>
            <div>
          <div
            className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm transition-opacity duration-200 data-[leaving]:opacity-0"
            data-leaving={leaving.has(r.id) || undefined}
          >
            <div className="min-w-0">
              <span className="font-medium">{r.row_label ?? "Rate"}</span>{" "}
              <span className="text-muted-foreground">
                {r.field.replace(/_/g, " ")}:
              </span>{" "}
              <span className="tabular-nums line-through opacity-60">{showVal(r.old_value)}</span>
              {" → "}
              <span className="font-medium tabular-nums">{showVal(r.new_value)}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                by {r.proposed_by_name ?? "—"} · {fmtDate(r.proposed_at)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                disabled={busy === r.id}
                onClick={() => void decide(r.id, "approve")}
              >
                <Check data-icon="inline-start" /> Approve
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy === r.id}
                onClick={() => void decide(r.id, "reject")}
              >
                <X data-icon="inline-start" /> Reject
              </Button>
            </div>
          </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
