"use client";

// Dedicated "Add client" page body (avama-style create page). On success it
// navigates back to the clients list instead of closing a sheet.

import { useRouter } from "next/navigation";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ClientForm } from "@/components/clients/client-form";

export function ClientCreatePanel() {
  const router = useRouter();
  return (
    <Card className="max-w-2xl">
      <CardContent className="flex flex-col gap-4">
        <ClientForm onSuccess={() => router.push("/clients")} />
        <Link
          href="/clients"
          className={buttonVariants({ variant: "ghost", size: "sm" }) + " self-start"}
        >
          Cancel
        </Link>
      </CardContent>
    </Card>
  );
}
