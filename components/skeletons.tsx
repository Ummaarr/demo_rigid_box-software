// Shared loading skeletons for the route-level loading.tsx files.
//
// WHY THESE EXIST: without a loading.tsx, clicking a sidebar item leaves the
// PREVIOUS page on screen, frozen, until the next one has fully rendered on the
// server. Measured at ~350-650 ms in production and 1-3.5 s in `next dev`, that
// reads as an unresponsive app even though nothing is wrong. A skeleton shows
// instantly, so navigation feels immediate and the wait becomes legible.
//
// Server components by design — no state, no effects. Keep the shapes roughly
// matching the real page (same wrapper padding, same number of blocks) so the
// swap to real content doesn't jump.

import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors <PageHeader>: bold title, muted subtitle, optional right-side action. */
export function PageHeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-5 w-72" />
      </div>
      {action && <Skeleton className="h-11 w-36 shrink-0 rounded-lg" />}
    </div>
  );
}

/** The search bar + Filter button that the estimates / rates / quotes lists share. */
export function FilterBarSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Skeleton className="h-11 flex-1 min-w-[16rem] rounded-lg" />
      <Skeleton className="h-11 w-28 rounded-lg" />
    </div>
  );
}

export function TableSkeleton({
  rows = 6,
  cols = 5,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex gap-4 border-b bg-muted/40 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b px-4 py-4 last:border-b-0">
          {Array.from({ length: cols }).map((_, c) => (
            // First column reads as a name — make it wider so the row has rhythm.
            <Skeleton key={c} className={c === 0 ? "h-4 flex-[1.6]" : "h-4 flex-1"} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-xl border p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

/** A titled block of form rows — the estimate form and the small create forms. */
export function FormSkeleton({
  sections = 3,
  rowsPerSection = 3,
}: {
  sections?: number;
  rowsPerSection?: number;
}) {
  return (
    <div className="space-y-6">
      {Array.from({ length: sections }).map((_, s) => (
        <div key={s} className="space-y-4 rounded-xl border p-5">
          <Skeleton className="h-5 w-40" />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: rowsPerSection }).map((_, r) => (
              <div key={r} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Rate card / keylines: a run of titled panels. */
export function PanelsSkeleton({
  panels = 4,
  rows = 3,
}: {
  panels?: number;
  rows?: number;
}) {
  return (
    <div className="space-y-4">
      {Array.from({ length: panels }).map((_, p) => (
        <div key={p} className="space-y-3 rounded-xl border p-5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
          {Array.from({ length: rows }).map((_, r) => (
            <Skeleton key={r} className="h-9 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}
