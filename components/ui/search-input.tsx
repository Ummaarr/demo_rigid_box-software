"use client";

// Controlled search box with a clear "×" and an input-clear "dissolve": on
// clear, the current text flies up + blurs + fades (a ghost overlay) while the
// value resets — the transitions.dev input-clear effect, adapted to work with
// our live-filtering controlled inputs (the shipped snippet is uncontrolled +
// per-frame, which fights controlled state). Styles auto-inject once, SSR-safe.

import { useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

const STYLE_ID = "transitions-p13-clear";
const STYLES = `
:root {
  --clear-out-dur: 400ms;
  --clear-out-fly: 12px;
  --clear-blur: 2px;
  --clear-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes t-clear-fly {
  0%   { transform: translateY(0);                              opacity: 1; filter: blur(0); }
  100% { transform: translateY(calc(var(--clear-out-fly) * -1)); opacity: 0; filter: blur(var(--clear-blur)); }
}
.t-clear-ghost { animation: t-clear-fly var(--clear-out-dur) var(--clear-ease) both; }
@media (prefers-reduced-motion: reduce) {
  .t-clear-ghost { animation: none !important; opacity: 0 !important; }
}
`;
function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLES;
  document.head.appendChild(el);
}
function readMs(name: string, fallback: number) {
  if (typeof document === "undefined") return fallback;
  const n = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name),
  );
  return Number.isFinite(n) ? n : fallback;
}

// Size variants. "lg" is the prominent, softly-rounded search bar used where
// search is the primary action on the page (rate card); "default" is the
// compact inline one. Height, radius, padding, icon offset and the clear-ghost
// position all move together — changing only the input's padding would leave
// the icon and the dissolve ghost misaligned.
const SIZES = {
  default: {
    input: "h-9 rounded-lg pl-8 pr-8",
    icon: "left-2.5 size-4",
    ghost: "left-8 max-w-[calc(100%-2.75rem)]",
    clear: "right-2",
  },
  lg: {
    input: "h-9 rounded-xl pl-9 pr-9 text-sm",
    icon: "left-3 size-4",
    ghost: "left-9 max-w-[calc(100%-3rem)]",
    clear: "right-2.5",
  },
} as const;

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  wrapperClassName,
  size = "default",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Extra classes on the input. */
  className?: string;
  /** Extra classes on the relative wrapper (e.g. width / t-resize). */
  wrapperClassName?: string;
  size?: keyof typeof SIZES;
}) {
  const s = SIZES[size];
  const inputRef = useRef<HTMLInputElement>(null);
  const [ghost, setGhost] = useState<string | null>(null);

  function clear() {
    const current = value;
    onChange("");
    if (current) {
      ensureStyles();
      setGhost(current);
      window.setTimeout(() => setGhost(null), readMs("--clear-out-dur", 400));
    }
    inputRef.current?.focus();
  }

  return (
    <div className={cn("relative", wrapperClassName)}>
      <Search
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground",
          s.icon,
        )}
      />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(s.input, className)}
      />
      {ghost && (
        <span
          aria-hidden
          className={cn(
            "t-clear-ghost pointer-events-none absolute top-1/2 -translate-y-1/2 truncate text-sm text-foreground",
            s.ghost,
          )}
        >
          {ghost}
        </span>
      )}
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          className={cn(
            "absolute top-1/2 -translate-y-1/2 rounded text-muted-foreground transition-colors hover:text-foreground",
            s.clear,
          )}
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
