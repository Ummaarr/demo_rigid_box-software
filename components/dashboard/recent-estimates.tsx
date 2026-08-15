"use client";

// Dashboard "Recent estimates" — the polished table (efferd dashboard-7 look):
// soft status pills, a right-aligned "…" actions menu, generous rows, concentric
// radii. Client component because it owns the actions dropdown + delete.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal,
  Eye,
  ReceiptText,
  Trash2,
  FilePlus2,
  CheckCircle2,
  Send,
  History,
  Pencil,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { boxLabel } from "@/lib/box-types";
import { Button, buttonVariants } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SearchInput } from "@/components/ui/search-input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RecentEstimate } from "@/lib/db/dashboard";
import type { UserRole } from "@/types";
import { formatMoney } from "@/lib/currency";

const inr = { format: (n: number) => formatMoney(n, 0) };
const inr2 = { format: (n: number) => formatMoney(n, 2) };

// Soft-tinted status pills (label + icon + colour), one per estimate status.
const STATUS_META: Record<
  string,
  { label: string; className: string; icon: LucideIcon }
> = {
  draft: {
    label: "Draft",
    className:
      "bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
    icon: Pencil,
  },
  sent: {
    label: "Sent",
    className:
      "bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
    icon: Send,
  },
  accepted: {
    label: "Accepted",
    className:
      "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
    icon: CheckCircle2,
  },
  revised: {
    label: "Revised",
    className:
      "bg-violet-500/10 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400",
    icon: History,
  },
};

function StatusBadge({ status }: { status?: string | null }) {
  const meta = status ? STATUS_META[status] : undefined;
  if (!meta) return <span className="text-muted-foreground">—</span>;
  const Icon = meta.icon;
  return (
    <Badge className={cn("gap-1", meta.className)}>
      <Icon data-icon="inline-start" />
      {meta.label}
    </Badge>
  );
}

export function RecentEstimatesTable({
  recent,
  role,
}: {
  recent: RecentEstimate[];
  role: UserRole | null;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const isAdmin = role === "admin";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  const q = search.trim().toLowerCase();
  const filtered = q
    ? recent.filter(
        (e) =>
          (e.clientName ?? "").toLowerCase().includes(q) ||
          boxLabel(e.boxType).toLowerCase().includes(q) ||
          (e.status ?? "").toLowerCase().includes(q),
      )
    : recent;

  async function deleteEstimate(e: RecentEstimate) {
    const label = `${boxLabel(e.boxType)} × ${e.quantity.toLocaleString("en-IN")}`;
    const ok = await confirm({
      title: "Delete estimate?",
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
    <Card className="gap-0">
      {confirmDialog}
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b">
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="size-4 text-muted-foreground" />
          Recent estimates
        </CardTitle>
        <div className="flex items-center gap-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search estimates…"
            className="w-full"
            wrapperClassName="t-resize w-40 focus-within:w-56 md:w-56 md:focus-within:w-72"
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Recent estimates options"
                  className="size-9 shrink-0"
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem render={<Link href="/estimates" />}>
                <ReceiptText />
                View all estimates
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/estimates?new=1" />}>
                <FilePlus2 />
                New estimate
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {error && (
          <p className="px-6 pt-3 text-sm text-destructive">{error}</p>
        )}
        {recent.length === 0 ? (
          <div className="flex flex-col items-start gap-3 p-6">
            <p className="text-sm text-muted-foreground">
              No estimates yet. Create your first one to see it here.
            </p>
            <Link href="/estimates?new=1">
              <Button variant="outline" size="sm">
                <FilePlus2 data-icon="inline-start" />
                New estimate
              </Button>
            </Link>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-6">Client</TableHead>
                  <TableHead>Box type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price/box</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-0 pr-6" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={7}
                      className="h-24 pl-6 text-sm text-muted-foreground"
                    >
                      No estimates match &ldquo;{search}&rdquo;.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((e) => (
                  <TableRow
                    key={e.id}
                    className="h-14 transition-colors hover:bg-muted/50"
                  >
                    <TableCell className="pl-6 font-medium">
                      {e.clientName ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {boxLabel(e.boxType)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={e.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.quantity.toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {e.pricePerBox != null ? inr2.format(e.pricePerBox) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {e.totalPrice != null ? inr.format(e.totalPrice) : "—"}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="Estimate actions"
                              className="size-8 rounded-md text-muted-foreground hover:text-foreground"
                            />
                          }
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem
                            render={<Link href={`/estimates/${e.id}`} />}
                          >
                            <Eye />
                            View details
                          </DropdownMenuItem>
                          <DropdownMenuItem render={<Link href="/quotes/new" />}>
                            <ReceiptText />
                            Create quote
                          </DropdownMenuItem>
                          {isAdmin && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={busy}
                                onClick={() => void deleteEstimate(e)}
                              >
                                <Trash2 />
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <div className="flex justify-center border-t py-3">
              <Link
                href="/estimates"
                className={buttonVariants({ size: "sm", variant: "ghost" })}
              >
                View all estimates
              </Link>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
