"use client";

// Clients directory — reference-style cards (name, lead/customer badge,
// contact rows with icons, added date, Edit/Delete) with a full-width search
// bar + type filter chips. Editing opens a sheet reusing ClientForm (PUT).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Mail, Pencil, Phone, Search, Trash2, User } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ClientForm } from "@/components/clients/client-form";
import type { ClientRow } from "@/lib/db/clients-db";
import type { UserRole } from "@/types";

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

function TypeBadge({ type }: { type: ClientRow["type"] }) {
  const isCustomer = (type ?? "lead") === "customer";
  return (
    <Badge
      variant="outline"
      className={cn(
        "capitalize",
        isCustomer
          ? "border-green-300 text-green-700 dark:border-green-800 dark:text-green-400"
          : "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400",
      )}
    >
      {type ?? "lead"}
    </Badge>
  );
}

function InfoRow({
  icon: Icon,
  value,
}: {
  icon: typeof Mail;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{value}</span>
    </div>
  );
}

export function ClientList({
  clients,
  role,
}: {
  clients: ClientRow[];
  role: UserRole | null;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Lead / customer filter chips (client 4-Jul type column).
  const [typeFilter, setTypeFilter] = useState<"all" | "lead" | "customer">("all");
  const isAdmin = role === "admin";

  const q = search.trim().toLowerCase();
  const filtered = clients.filter((c) => {
    if (typeFilter !== "all" && (c.type ?? "lead") !== typeFilter) return false;
    if (!q) return true;
    return [c.name, c.contact_person, c.phone, c.email, c.address]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(q));
  });

  async function deleteClient(id: string, name: string) {
    const ok = await confirm({
      title: "Delete this client?",
      subject: name,
      body: "This cannot be undone. Estimates already saved for them are kept.",
    });
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/clients/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json();
        setError((j as { error?: string }).error ?? "Failed to delete.");
        return;
      }
      router.refresh();
    });
  }

  if (!clients.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No clients yet. Add the first one with the button above.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {confirmDialog}
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, contact, phone, email…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1">
          {(["all", "lead", "customer"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                typeFilter === t
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "all" ? "All" : t + "s"}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No clients match.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex h-full flex-col gap-3">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <p className="truncate text-lg font-semibold leading-tight">
                    {c.name}
                  </p>
                  <TypeBadge type={c.type} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <InfoRow icon={User} value={c.contact_person} />
                  <InfoRow icon={Phone} value={c.phone} />
                  <InfoRow icon={Mail} value={c.email} />
                  <InfoRow icon={MapPin} value={c.address} />
                  {!c.contact_person && !c.phone && !c.email && !c.address && (
                    <p className="text-sm text-muted-foreground">
                      No contact details yet.
                    </p>
                  )}
                </div>

                <p className="mt-auto border-t pt-3 text-xs text-muted-foreground">
                  Added {fmtDate(c.created_at)}
                </p>

                {isAdmin && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setEditing(c)}
                    >
                      <Pencil data-icon="inline-start" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      disabled={isPending}
                      onClick={() => void deleteClient(c.id, c.name)}
                      title="Delete client"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit sheet — same form as Add, pre-filled, submits PUT. */}
      <Sheet
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit client</SheetTitle>
            <SheetDescription>
              Changes apply everywhere this client is referenced.
            </SheetDescription>
          </SheetHeader>
          {editing && (
            <div className="px-4 pb-4">
              <ClientForm
                key={editing.id}
                initial={editing}
                onSuccess={() => setEditing(null)}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
