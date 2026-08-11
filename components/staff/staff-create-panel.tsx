"use client";

// Dedicated "Add staff" page body (avama-style create page). On success it
// navigates back to the staff list instead of closing a sheet.

import { useRouter } from "next/navigation";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StaffForm } from "@/components/staff/staff-form";

export function StaffCreatePanel() {
  const router = useRouter();
  return (
    <Card className="max-w-2xl">
      <CardContent className="flex flex-col gap-4">
        <StaffForm onSuccess={() => router.push("/staff")} />
        <Link
          href="/staff"
          className={buttonVariants({ variant: "ghost", size: "sm" }) + " self-start"}
        >
          Cancel
        </Link>
      </CardContent>
    </Card>
  );
}
