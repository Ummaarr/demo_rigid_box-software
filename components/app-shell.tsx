import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { CurrencyProvider, type CurrencyContextValue } from "@/lib/currency-context";
import type { UserRole } from "@/types";

export function AppShell({
  role,
  fullName,
  email,
  pendingRates = 0,
  currency,
  children,
}: {
  role: UserRole | null;
  fullName: string | null;
  email: string | null;
  /** Pending rate-change proposals (admin badge on the Rates nav item). */
  pendingRates?: number;
  /**
   * A trial account's own market dressing. Omitted for admin/staff, who keep
   * the deployment-wide BRAND currency display.
   */
  currency?: CurrencyContextValue;
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider>
      <CurrencyProvider value={currency}>
        <div className="overflow-hidden">
          <SidebarProvider className="relative h-svh">
            <AppSidebar
              role={role}
              name={fullName}
              email={email}
              pendingRates={pendingRates}
            />
            <SidebarInset className="md:peer-data-[variant=inset]:ml-0">
              <AppHeader />
              <div className="flex flex-1 flex-col overflow-y-auto">
                {children}
              </div>
            </SidebarInset>
          </SidebarProvider>
        </div>
      </CurrencyProvider>
    </TooltipProvider>
  );
}
