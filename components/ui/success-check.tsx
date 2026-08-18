"use client";

// The tick that marks a completed action (transitions-dev "success check"):
// fades in, rotates upright, settles with a Y-bob and draws its own stroke.
// Appear-only by design — the caller owns the exit (a collapsing InlineNotice,
// a button reverting to its idle label).
//
// Extracted from inline-notice.tsx so the save button and the notice draw the
// SAME path: the stroke-dasharray in globals.css is measured from this exact
// `d`, so a second hand-rolled copy would silently pre-reveal or over-draw.

import { useEffect, useRef } from "react";

/**
 * ceil(getTotalLength()) for this path is 21 — kept in sync with the
 * stroke-dasharray in globals.css's .t-success-check block. If you change the
 * path, re-measure: too short and the stroke pre-reveals, too long and it
 * appears to draw past its own end.
 */
const TICK_PATH = "M5 12.5 l4.5 4.5 L19 7";

export function SuccessCheck({
  play,
  replayKey,
  size = 14,
  strokeWidth = 2.5,
  className,
}: {
  /** false = parked at opacity 0, no animation (the cold-load state). */
  play: boolean;
  /**
   * Change this to replay the draw while the tick is already visible (save
   * twice in a row and the second one should animate too). Deliberately NOT
   * derived from the message node: a ReactNode is a fresh object on every
   * parent render, which would re-fire the tick on every keystroke.
   */
  replayKey?: string | number | null;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!play) {
      el.parentElement?.setAttribute("data-state", "out");
      return;
    }
    const wrap = el.parentElement;
    if (!wrap) return;
    // Reset -> reflow -> set, per the skill's orchestration note: without the
    // reflow the keyframes never restart on a replay.
    wrap.setAttribute("data-state", "out");
    void wrap.offsetWidth;
    wrap.setAttribute("data-state", "in");
  }, [play, replayKey]);

  return (
    <span className={`t-success-check ${className ?? ""}`} data-state="out" aria-hidden="true">
      <svg ref={ref} viewBox="0 0 24 24" width={size} height={size} fill="none">
        <path
          d={TICK_PATH}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
