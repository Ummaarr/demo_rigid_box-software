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

import { SuccessCheck } from "@/components/ui/success-check";
import { cn } from "@/lib/utils";

export function InlineNotice({
  kind,
  children,
  autoDismissMs,
  onDismiss,
  messageKey,
  icon = true,
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
  /**
   * Replays the tick when a NEW message replaces one already on screen
   * (propose two rate changes in a row and the second should animate too).
   * Pass something that identifies the message — an id, a counter.
   */
  messageKey?: string | number | null;
  /**
   * false when the control that produced the notice already shows its own tick
   * — two ticks 8px apart read as a glitch, not as emphasis.
   */
  icon?: boolean;
  className?: string;
}) {
  const open = Boolean(children);
  // Hold the last non-empty content so the text doesn't vanish mid-collapse.
  const [held, setHeld] = useState<React.ReactNode>(children);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (children) setHeld(children);
  }, [children]);

  useEffect(() => {
    if (!open || kind !== "success" || !onDismissRef.current) return;
    const ms = autoDismissMs ?? 6000;
    if (ms <= 0) return;
    const t = setTimeout(() => onDismissRef.current?.(), ms);
    return () => clearTimeout(t);
  }, [open, kind, messageKey, autoDismissMs]);

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
          {icon &&
            (kind === "success" ? (
              <SuccessCheck
                play={open}
                replayKey={messageKey}
                className="mt-px shrink-0"
              />
            ) : (
              <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            ))}
          <span>{held}</span>
        </div>
      </div>
    </div>
  );
}
