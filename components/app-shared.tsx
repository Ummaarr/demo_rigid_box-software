import {
  Calculator,
  Contact,
  DollarSign,
  IndianRupee,
  LayoutDashboard,
  type LucideIcon,
  PencilRuler,
  ReceiptText,
  UserCog,
} from "lucide-react";

import { BRAND } from "@/lib/brand";

// Navigation model for the app shell. One source of truth for the sidebar links
// (and the header title lookup). `adminOnly` items are filtered out for staff in
// the sidebar (and the pages/APIs enforce the same on the server).

export type NavItem = {
  title: string;
  path: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

export type NavGroupModel = {
  label?: string;
  items: NavItem[];
};

export const navGroups: NavGroupModel[] = [
  {
    items: [{ title: "Dashboard", path: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Workspace",
    items: [
      { title: "Estimates", path: "/estimates", icon: Calculator },
      { title: "Quotes", path: "/quotes", icon: ReceiptText },
      { title: "Clients", path: "/clients", icon: Contact },
      { title: "Keylines", path: "/keylines", icon: PencilRuler },
    ],
  },
  {
    label: "Admin",
    items: [
      // Rates is visible to staff too (round 3): they see rates read-only and
      // can PROPOSE changes; the page + API strip margin and gate all writes.
      // Icon follows the brand's currency so the demo's dollar display isn't
      // undercut by a rupee glyph in the nav.
      { title: "Rates", path: "/rates", icon: BRAND.currencySymbol === "$" ? DollarSign : IndianRupee },
      { title: "Staff", path: "/staff", icon: UserCog, adminOnly: true },
    ],
  },
];

export const navItems: NavItem[] = navGroups.flatMap((g) => g.items);

// Titles for routes not shown in the sidebar (e.g. the standalone /estimate
// re-run/edit page, reached via /estimate?from=<id> from an estimate detail).
const EXTRA_TITLES: { path: string; title: string }[] = [
  { path: "/estimate", title: "New estimate" },
];

/** Best-match title for the current path (longest matching path wins). */
export function titleForPath(pathname: string): string {
  let best: { path: string; title: string } | undefined;
  for (const item of [...navItems, ...EXTRA_TITLES]) {
    if (pathname === item.path || pathname.startsWith(`${item.path}/`)) {
      if (!best || item.path.length > best.path.length) best = item;
    }
  }
  return best?.title ?? "";
}
