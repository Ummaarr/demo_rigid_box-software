"use client";

// Top bar (section title, and on mobile the drawer trigger). Desktop shows it
// ONLY on the dashboard; every other page opens with its own big PageHeader.
// The sidebar collapse toggle is intentionally gone on desktop — the sidebar
// stays put. On mobile the trigger remains: it's the only way to open the
// drawer. Account moved to the sidebar footer.

import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { CustomSidebarTrigger } from "@/components/custom-sidebar-trigger";
import { titleForPath } from "@/components/app-shared";

export function AppHeader() {
  const pathname = usePathname();
  const title = titleForPath(pathname);
  const isDashboard = pathname === "/dashboard";

  return (
    <header
      className={cn(
        "sticky top-0 z-50 flex h-16 shrink-0 items-center justify-between gap-2 border-b-2 bg-card px-4 md:px-6",
        !isDashboard && "md:hidden",
      )}
    >
      <div className="flex items-center gap-3">
        {/* Drawer trigger — mobile only (desktop sidebar has no collapse). */}
        <div className="flex items-center gap-3 md:hidden">
          <CustomSidebarTrigger />
          <Separator
            className="h-5 data-[orientation=vertical]:self-center"
            orientation="vertical"
          />
        </div>
        <span className="font-heading text-lg font-semibold">{title}</span>
      </div>
    </header>
  );
}
