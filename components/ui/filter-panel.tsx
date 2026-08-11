"use client";

// Filter-bar primitives (client 18-Jul reference design): a search box beside a
// "Filter" toggle, revealing a panel of labelled controls with a Clear reset.
// Shared by the rate card and the estimates list so both read identically.

import { ChevronDown, Filter as FilterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The toolbar row: a width-capped search box on the LEFT, actions pushed to the
 * far RIGHT. Slots rather than free children so every filtered list lands on the
 * same layout — the search must not stretch to fill the row.
 */
export function FilterBar({
  search,
  actions,
}: {
  search: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="w-full min-w-0 sm:w-96 sm:max-w-full">{search}</div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Filter toggle. The active count matters: a collapsed panel quietly narrowing
 * the page would otherwise read as missing data.
 */
export function FilterToggle({
  open,
  onToggle,
  count,
}: {
  open: boolean;
  onToggle: () => void;
  count: number;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onToggle}
      aria-expanded={open}
      className="h-9 gap-2 rounded-xl"
    >
      <FilterIcon className="size-4" />
      Filters
      {count > 0 && (
        <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none font-semibold text-primary-foreground tabular-nums">
          {count}
        </span>
      )}
      <ChevronDown
        className={cn("size-4 transition-transform duration-200", open && "rotate-180")}
      />
    </Button>
  );
}

/**
 * Height-tweened reveal (see .t-reveal in globals.css). The inner element owns
 * the overflow clip, so the panel's own top margin collapses with it — closed,
 * this contributes exactly zero height, which is why the toolbar and panel must
 * sit in one un-gapped group.
 */
export function FilterReveal({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="t-reveal" data-open={open}>
      <div>{children}</div>
    </div>
  );
}

/** The panel surface — a responsive grid of labelled controls. */
export function FilterGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 grid gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {children}
    </div>
  );
}

/** One labelled cell in the filter grid. */
export function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** Full-width footer row of the grid, holding the Clear action. */
export function FilterActions({
  onClear,
  disabled,
}: {
  onClear: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-end sm:col-span-2 lg:col-span-3 xl:col-span-5 xl:justify-end">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={onClear}
      >
        Clear Filters
      </Button>
    </div>
  );
}
