import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton, TableSkeleton } from "@/components/skeletons";

// Step 1 of the quote builder is "pick a source" — a list of saved estimates.
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 lg:p-8">
      <PageHeaderSkeleton action={false} />
      <div className="flex gap-3">
        <Skeleton className="h-11 w-48 rounded-lg" />
        <Skeleton className="h-11 w-48 rounded-lg" />
      </div>
      <TableSkeleton rows={6} cols={5} />
    </div>
  );
}
