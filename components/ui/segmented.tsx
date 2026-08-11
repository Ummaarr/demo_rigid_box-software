"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

// Segmented control — a row of mutually-exclusive pills (generalizes the
// estimate form's in/cm/mm toggle). Used for small mode choices (Offset /
// Digital, outer & inner wrap modes) where a dropdown hides the options.
function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  className,
  size = "default",
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  className?: string;
  size?: "default" | "sm";
}) {
  return (
    <div
      role="radiogroup"
      data-slot="segmented"
      className={cn(
        "inline-flex w-fit items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onValueChange(o.value)}
            className={cn(
              "rounded-md font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40",
              size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export { Segmented };
