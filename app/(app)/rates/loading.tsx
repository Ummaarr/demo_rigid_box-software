import {
  FilterBarSkeleton,
  PageHeaderSkeleton,
  PanelsSkeleton,
} from "@/components/skeletons";

// The rate card is the heaviest page to render (24 sections, ~118 rows), so it
// benefits most from showing something immediately.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeaderSkeleton />
      <FilterBarSkeleton />
      <PanelsSkeleton panels={5} rows={4} />
    </div>
  );
}
