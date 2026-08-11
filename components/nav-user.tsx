"use client";

import { LogOutIcon, MoreVertical } from "lucide-react";

import { signOut } from "@/app/actions/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type UserInfo = {
  name: string | null;
  email: string | null;
  role: string | null;
};

/** Shared dropdown body: profile label + log out. */
function UserMenuContent({ name, email, role }: UserInfo) {
  const display = name ?? email ?? "User";
  const initial = display.charAt(0).toUpperCase();
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel className="flex items-center gap-3">
          <Avatar className="size-10">
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{display}</p>
            {email && (
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            )}
            {role && (
              <p className="text-xs text-muted-foreground capitalize">{role}</p>
            )}
          </div>
        </DropdownMenuLabel>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        className="w-full cursor-pointer"
        onClick={() => {
          void signOut();
        }}
      >
        <LogOutIcon />
        Log out
      </DropdownMenuItem>
    </>
  );
}

export function NavUser({ name, email, role }: UserInfo) {
  const display = name ?? email ?? "User";
  const initial = display.charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // The trigger is an Avatar (<span>), not a native <button>, so tell Base
        // UI to apply button ARIA semantics instead of expecting a real button.
        nativeButton={false}
        render={<Avatar className="size-8 cursor-pointer" />}
      >
        <AvatarFallback>{initial}</AvatarFallback>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <UserMenuContent name={name} email={email} role={role} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Sidebar-footer account row (avatar + name + email + ⋮), avama-style. In
 * icon-collapsed mode only the avatar stays visible.
 */
export function NavUserRow({ name, email, role }: UserInfo) {
  const display = name ?? email ?? "User";
  const initial = display.charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full cursor-pointer items-center gap-2 rounded-md p-2 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-1"
      >
        <Avatar className="size-8 shrink-0">
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
          <p className="truncate text-sm font-medium leading-tight">{display}</p>
          {email && (
            <p className="truncate text-xs text-muted-foreground leading-tight">
              {email}
            </p>
          )}
        </div>
        <MoreVertical className="size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-60">
        <UserMenuContent name={name} email={email} role={role} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
