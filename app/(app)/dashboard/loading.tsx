import { Skeleton } from "@/components/ui/skeleton";
import { StatCardsSkeleton, TableSkeleton } from "@/components/skeletons";

// Wrapper matches app/(app)/dashboard/page.tsx so nothing shifts on swap.
export default function Loading() {
  return (
    <div className="flex w-full flex-col gap-4 p-4 md:p-6">
      <div className="space-y-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-80" />
      </div>
      <StatCardsSkeleton count={4} />
      {/* Quote pipeline tiles (admin) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-xl border p-4">
            <Skeleton className="h-7 w-12" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      <TableSkeleton rows={6} cols={6} />
    </div>
  );
}
