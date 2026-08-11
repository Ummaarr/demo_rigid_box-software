"use client";

// Inline success / error confirmation shown next to the control that produced
// it. The app has no toast system on purpose — every confirmation here is
// in-place, beside the thing it is about — but before this component each one
// was a bare conditionally-mounted <p> that popped in, shoved the layout down,
// picked its own shade of green, and never went away.
//
// Three things this fixes:
//   1. Height is tweened via .t-reveal (globals.css), so surrounding content
//      slides instead of jumping. Closed, it contributes exactly zero height.
//   2. A success notice draws a tick (transitions-dev "success check") so a
//      completed action reads as a moment rather than a line of text appearing.
//   3. Colour comes from the --success / --destructive tokens, so success looks
//      the same everywhere instead of three different greens.
//
// Exit is the reveal collapsing; the tick has no hide animation of its own
// (the skill's snippet is appear-only by design).

import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * ceil(getTotalLength()) for this path is 21 — kept in sync with the
 * stroke-dasharray in globals.css's .t-success-check block. If you change the
 * path, re-measure: too short and the stroke pre-reveals, too long and it
 * appears to draw past its own end.
 */
const TICK_PATH = "M5 12.5 l4.5 4.5 L19 7";

export function InlineNotice({
  kind,
  children,
  autoDismissMs,
  onDismiss,
  className,
}: {
  kind: "success" | "error";
  /** Falsy = the notice is closed; the reveal collapses to zero height. */
  children?: React.ReactNode;
  /**
   * Auto-hide a SUCCESS notice after this long (default 6s). Errors never
   * auto-dismiss — they describe something the user still has to deal with.
   * Pass 0 to keep a success message up until it is replaced.
   */
  autoDismissMs?: number;
  onDismiss?: () => void;
  className?: string;
}) {
  const open = Boolean(children);
  // Hold the last non-empty content so the text doesn't vanish mid-collapse.
  const [held, setHeld] = useState<React.ReactNode>(children);
  const checkRef = useRef<HTMLSpanElement>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (children) setHeld(children);
  }, [children]);

  // Replay the tick every time a NEW success message appears (propose twice in
  // a row and the second one should animate too). Reset → reflow → set, per the
  // skill's orchestration note.
  useEffect(() => {
    if (!open || kind !== "success") return;
    const el = checkRef.current;
    if (!el) return;
    el.setAttribute("data-state", "out");
    void el.offsetWidth; // force reflow so the keyframes restart
    el.setAttribute("data-state", "in");
  }, [open, kind, held]);

  useEffect(() => {
    if (!open || kind !== "success" || !onDismissRef.current) return;
    const ms = autoDismissMs ?? 6000;
    if (ms <= 0) return;
    const t = setTimeout(() => onDismissRef.current?.(), ms);
    return () => clearTimeout(t);
  }, [open, kind, held, autoDismissMs]);

  return (
    <div className="t-reveal" data-open={open || undefined}>
      <div>
        <div
          role="status"
          aria-live="polite"
          className={cn(
            // The margin lives on the inner element so it collapses with the
            // reveal — a margin on .t-reveal itself would leave a gap when closed.
            "mb-2 flex items-start gap-1.5 text-xs",
            kind === "success" ? "text-success" : "text-destructive",
            // Content itself fades/slides in; tw-animate-css is already imported.
            open && "animate-in fade-in-0 slide-in-from-top-1 duration-200",
            className,
          )}
        >
          {kind === "success" ? (
            <span
              ref={checkRef}
              className="t-success-check mt-px shrink-0"
              data-state="out"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
                <path
                  d={TICK_PATH}
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          ) : (
            <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>{held}</span>
        </div>
      </div>
    </div>
  );
}
