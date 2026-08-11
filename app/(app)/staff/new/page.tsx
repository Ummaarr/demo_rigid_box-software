// Dedicated "Add staff" create page (avama-style). Admin-only, re-checked in
// the POST /api/staff route too.

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireAdmin } from "@/lib/auth";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { StaffCreatePanel } from "@/components/staff/staff-create-panel";

export default async function NewStaffPage() {
  const session = await requireAdmin();
  if (!session) redirect("/dashboard");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 lg:p-8">
      <div className="flex flex-col gap-4">
        <Link
          href="/staff"
          className={buttonVariants({ variant: "ghost", size: "sm" }) + " self-start"}
        >
          <ArrowLeft data-icon="inline-start" />
          Back to staff
        </Link>
        <PageHeader
          title="Add new staff member"
          description="The account works immediately. Share the email and temporary password with them; they can change it later."
        />
      </div>

      <StaffCreatePanel />
    </div>
  );
}
