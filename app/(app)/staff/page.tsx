// Staff management (admin only). Admins provision Staff/Admin logins directly
// (email + password) and can edit/delete them (PATCH/DELETE /api/staff/[id]).
// Guarded by requireAdmin() here AND re-checked in the API routes (defense in
// depth). Staff who reach this URL are redirected away.

import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";

import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import { loadStaff } from "@/lib/db/staff";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { StaffDirectory } from "@/components/staff/staff-directory";

export default async function StaffPage() {
  const session = await requireAdmin();
  if (!session) {
    redirect("/dashboard");
  }

  const users = await loadStaff(createAdminClient());

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 lg:p-8">
      <PageHeader
        title="Staff"
        description="Create and review the people who can sign in to the estimator."
      >
        <Link href="/staff/new" className={buttonVariants({ size: "lg" })}>
          <Plus data-icon="inline-start" />
          Add staff
        </Link>
      </PageHeader>

      <StaffDirectory users={users} currentUserId={session.userId} />
    </div>
  );
}
