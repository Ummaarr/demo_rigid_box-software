"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

// Minimal dependency-free switch (button[role=switch]) matching the kit's
// tokens: navy track when on, neutral when off. Used for enable/disable
// toggles that used to be bare checkboxes.
function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "onChange"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-slot="switch"
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export { Switch };
