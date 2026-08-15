import { PageHeaderSkeleton, TableSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 lg:p-8">
      <PageHeaderSkeleton />
      <TableSkeleton rows={5} cols={4} />
    </div>
  );
}
