"use client";

// Type-to-search client picker. A plain <select> gets unusable once the client
// list grows, so this is a text input that filters as you type and shows a
// dropdown of matches — click (or Enter) to select. Lightweight, no portal/
// popover dependency, matching the rest of the kit's custom controls.

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ClientRow } from "@/lib/db/clients-db";

export function ClientCombobox({
  clients,
  value,
  onChange,
  placeholder = "Search clients…",
  noneLabel = "— none —",
  className,
}: {
  clients: ClientRow[];
  /** Selected client id, or "" for none/unset. */
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  /** Label for the "clear selection" option shown at the top of the list. */
  noneLabel?: string;
  className?: string;
}) {
  const selected = clients.find((c) => c.id === value) ?? null;
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the displayed text in sync when the selection changes externally
  // (e.g. hydrating from a saved snapshot) and the dropdown isn't open.
  useEffect(() => {
    if (!open) setQuery(selected?.name ?? "");
  }, [selected, open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(selected?.name ?? "");
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, selected]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? clients.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.contact_person ?? "").toLowerCase().includes(q) ||
          (c.phone ?? "").toLowerCase().includes(q) ||
          (c.email ?? "").toLowerCase().includes(q),
      )
    : clients;

  function select(id: string) {
    onChange(id);
    const c = clients.find((x) => x.id === id);
    setQuery(c?.name ?? "");
    setOpen(false);
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          className="pl-8 pr-8"
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              setQuery(selected?.name ?? "");
              e.currentTarget.blur();
            } else if (e.key === "Enter" && filtered.length > 0) {
              e.preventDefault();
              select(filtered[0].id);
            }
          }}
        />
        {value && (
          <button
            type="button"
            aria-label="Clear client"
            onClick={() => select("")}
            className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover shadow-md">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => select("")}
            className={cn(
              "flex w-full items-center px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted",
              value === "" && "bg-muted/60 font-medium text-foreground",
            )}
          >
            {noneLabel}
          </button>
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No clients match.</p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(c.id)}
                className={cn(
                  "flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted",
                  c.id === value && "bg-muted/60 font-medium",
                )}
              >
                <span>{c.name}</span>
                {(c.contact_person || c.phone) && (
                  <span className="text-xs text-muted-foreground">
                    {[c.contact_person, c.phone].filter(Boolean).join(" · ")}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
