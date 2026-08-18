import { FormSkeleton, PageHeaderSkeleton } from "@/components/skeletons";

// The estimate form is the largest client component in the app, so this is the
// skeleton users see most often — it stands in for the two-column form grid.
export default function Loading() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 lg:p-8">
      <PageHeaderSkeleton action={false} />
      <FormSkeleton sections={4} rowsPerSection={4} />
    </div>
  );
}
