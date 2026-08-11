"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { BrandWordmark } from "@/components/brand-wordmark";
import { NavUserRow } from "@/components/nav-user";
import { navGroups } from "@/components/app-shared";
import { BRAND } from "@/lib/brand";
import type { UserRole } from "@/types";

export function AppSidebar({
  role,
  name = null,
  email = null,
  pendingRates = 0,
}: {
  role: UserRole | null;
  name?: string | null;
  email?: string | null;
  /** Pending rate-change proposals — badge next to Rates for admins. */
  pendingRates?: number;
}) {
  const pathname = usePathname();

  const groups = navGroups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.adminOnly || role === "admin"),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="h-14 justify-center">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 px-1 group-data-[collapsible=icon]:px-0"
        >
          <BrandWordmark
            width={150}
            className="group-data-[collapsible=icon]:hidden"
          />
          <span className="hidden size-8 shrink-0 items-center justify-center rounded-md bg-primary font-heading text-sm font-semibold text-primary-foreground group-data-[collapsible=icon]:flex">
            {BRAND.monogram}
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group, i) => (
          <SidebarGroup key={group.label ?? `group-${i}`}>
            {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarMenu>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active =
                  pathname === item.path ||
                  pathname.startsWith(`${item.path}/`);
                const badge =
                  item.path === "/rates" && role === "admin" && pendingRates > 0
                    ? pendingRates
                    : 0;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={badge ? `${item.title} — ${badge} pending` : item.title}
                      render={<Link href={item.path} />}
                    >
                      <Icon />
                      <span>{item.title}</span>
                      {badge > 0 && (
                        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground group-data-[collapsible=icon]:hidden">
                          {badge}
                        </span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* Account lives here (avama-style) — the top bar only shows on the
          dashboard, so sign-out must always be reachable from the sidebar. */}
      <SidebarFooter className="border-t border-sidebar-border">
        <NavUserRow name={name} email={email} role={role} />
      </SidebarFooter>
    </Sidebar>
  );
}
