"use client";

// Staff directory — reference-style cards (avatar, name, role badge, email,
// joined date) with a search bar, plus Edit (sheet → PATCH /api/staff/[id])
// and Delete. Your own card hides Delete and locks the role field (the API
// enforces both guards server-side too).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Pencil, Search, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { StaffUser } from "@/lib/db/staff";

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function RoleBadge({ role }: { role: string | null }) {
  return (
    <Badge
      className={cn(
        "uppercase tracking-wide",
        role === "admin"
          ? "bg-clay/15 text-clay dark:bg-clay/20" // admin: the accent chip marks the most privileged role
          : role === "trial"
            ? "bg-primary/10 text-primary dark:bg-primary/20"
            : "bg-secondary text-secondary-foreground",
      )}
    >
      {role ?? "no role"}
    </Badge>
  );
}

type EditState = {
  id: string;
  fullName: string;
  role: string;
  /** The role this account ALREADY has — `role` is the in-progress choice.
   *  Keeping both apart is what lets the dialog explain a trial conversion
   *  without mistaking "you just picked Trial" for "this IS a trial". */
  originalRole: string;
  password: string;
};

export function StaffDirectory({
  users,
  currentUserId,
}: {
  users: StaffUser[];
  currentUserId: string;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const q = search.trim().toLowerCase();
  const filtered = users.filter((u) => {
    if (!q) return true;
    return [u.fullName, u.email]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(q));
  });

  function startEdit(u: StaffUser) {
    setError(null);
    setEditing({
      id: u.id,
      fullName: u.fullName ?? "",
      role: u.role ?? "staff",
      originalRole: u.role ?? "staff",
      password: "",
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/staff/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: editing.fullName,
          role: editing.role,
          // Empty = keep the current password.
          ...(editing.password ? { password: editing.password } : {}),
        }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        setError(j.error ?? "Failed to save changes.");
        return;
      }
      setEditing(null);
      router.refresh();
    } catch {
      setError("Network error — could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(u: StaffUser) {
    const label = u.fullName ?? u.email ?? "this user";
    // Upstream's in-app dialog, carrying the trial-specific warning: a trial
    // account's clients/estimates/quotes and private rate card are deleted WITH
    // it (server-side, DELETE /api/staff/[id]), which is not reversible and has
    // to be said out loud. Staff/admin rows are real company history and stay.
    const isTrial = u.role === "trial";
    const ok = await confirm({
      title: isTrial ? "Delete this trial account?" : "Delete this login?",
      subject: label,
      body: isTrial
        ? "Their clients, estimates, quotes and private rate card are all deleted too. This cannot be undone."
        : "They will no longer be able to sign in. Their saved estimates stay.",
    });
    if (!ok) return;
    setBusy(true);
    setListError(null);
    try {
      const res = await fetch(`/api/staff/${u.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        setListError(j.error ?? "Failed to delete.");
      } else {
        router.refresh();
      }
    } catch {
      setListError("Network error — could not reach the server.");
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      {confirmDialog}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search staff by name or email…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {listError && <p className="text-sm text-destructive">{listError}</p>}

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No staff match.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((u) => {
            const display = u.fullName ?? u.email ?? "User";
            const isSelf = u.id === currentUserId;
            return (
              <Card key={u.id}>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <Avatar className="size-11 shrink-0">
                      <AvatarFallback className="bg-primary/10 text-primary font-medium">
                        {display.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="truncate text-lg font-semibold leading-tight">
                        {display}
                        {isSelf && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            (you)
                          </span>
                        )}
                      </p>
                      <RoleBadge role={u.role} />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="size-3.5 shrink-0" />
                    <span className="truncate">{u.email ?? "—"}</span>
                  </div>

                  <p className="border-t pt-3 text-xs text-muted-foreground">
                    Joined {dateFmt.format(new Date(u.createdAt))}
                  </p>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => startEdit(u)}
                    >
                      <Pencil data-icon="inline-start" />
                      Edit
                    </Button>
                    {!isSelf && (
                      <Button
                        variant="outline"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        disabled={busy}
                        onClick={() => void deleteUser(u)}
                        title="Delete login"
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit sheet */}
      <Sheet
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit staff</SheetTitle>
            <SheetDescription>
              Change the name or role, or set a new password. Leave the
              password blank to keep the current one.
            </SheetDescription>
          </SheetHeader>
          {editing && (
            <form
              onSubmit={(e) => void saveEdit(e)}
              className="grid gap-3 px-4 pb-4"
            >
              <div className="grid gap-1">
                <Label htmlFor="edit-staff-name">Full name</Label>
                <Input
                  id="edit-staff-name"
                  value={editing.fullName}
                  onChange={(e) =>
                    setEditing({ ...editing, fullName: e.target.value })
                  }
                  required
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="edit-staff-role">Role</Label>
                <NativeSelect
                  id="edit-staff-role"
                  value={editing.role}
                  disabled={editing.id === currentUserId}
                  onChange={(e) =>
                    setEditing({ ...editing, role: e.target.value })
                  }
                >
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                  <option value="trial">Trial (external lead)</option>
                </NativeSelect>
                {/* Compare against originalRole, never the in-progress pick —
                    otherwise choosing "Trial" instantly claims the account is
                    already one. */}
                {editing.id === currentUserId ? (
                  <p className="text-xs text-muted-foreground">
                    You cannot change your own role.
                  </p>
                ) : editing.originalRole !== "trial" && editing.role === "trial" ? (
                  <p className="text-xs text-muted-foreground">
                    Saving gives them their own private copy of the rate card.
                    They&apos;ll only see clients, estimates and quotes they
                    created themselves.
                  </p>
                ) : editing.originalRole === "trial" && editing.role !== "trial" ? (
                  <p className="text-xs text-amber-700 dark:text-amber-500">
                    Saving deletes their private rate card, and the clients,
                    estimates and quotes they made become visible to all staff
                    and admins.
                  </p>
                ) : null}
              </div>
              <div className="grid gap-1">
                <Label htmlFor="edit-staff-password">New password</Label>
                <Input
                  id="edit-staff-password"
                  type="text"
                  autoComplete="off"
                  placeholder="Leave blank to keep current"
                  value={editing.password}
                  onChange={(e) =>
                    setEditing({ ...editing, password: e.target.value })
                  }
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={saving} className="w-full">
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
