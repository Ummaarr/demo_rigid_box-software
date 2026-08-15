import { Skeleton } from "@/components/ui/skeleton";

// The detail page recomputes materials from the frozen snapshots before it can
// render, so it is one of the slower navigations.
export default function Loading() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-start gap-3">
        <Skeleton className="mt-1 h-4 w-4 rounded" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-3 w-80" />
        </div>
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-xl border p-5">
          <Skeleton className="h-5 w-40" />
          {Array.from({ length: 4 }).map((_, r) => (
            <div key={r} className="flex justify-between gap-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
