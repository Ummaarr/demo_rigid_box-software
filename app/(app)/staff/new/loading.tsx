import { FormSkeleton, PageHeaderSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 lg:p-8">
      <PageHeaderSkeleton action={false} />
      <FormSkeleton sections={1} rowsPerSection={4} />
    </div>
  );
}
