"use client";

// Shared shell for the two blocking TRIAL first-login steps (country picker,
// then rate review). Both are the same shape — centred column, staggered
// headline, one row of choices — so the layout, the entrance motion and the
// error strip live here rather than being kept in sync by hand in two files.
//
// Motion comes from the transitions-dev skill:
//   - texts reveal (18) for the headline/subline entrance. These are onboarding
//     steps, which is the transition's documented use.
//   - error state shake (12) for a failed submit. Only the shake + message
//     reveal are wired; the snippet's auto-revert timer is deliberately left
//     out, because React owns when the message is present (it clears on the
//     next submit, not on a hold timer).

import { useEffect, useRef, useState } from "react";

/**
 * Adds `.is-shown` on the frame after mount so the staggered reveal actually
 * transitions instead of painting straight into its resting state.
 */
export function useRevealOnMount() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return shown;
}

export function OnboardingScreen({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-xl">{children}</div>
    </main>
  );
}

export function OnboardingHeading({
  shown,
  title,
  children,
}: {
  shown: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <header className={`t-stagger mb-8 text-center ${shown ? "is-shown" : ""}`}>
      <h1 className="t-stagger-line t-stagger-line--1 text-3xl font-semibold tracking-tight text-balance">
        {title}
      </h1>
      <p className="t-stagger-line t-stagger-line--2 mt-3 text-muted-foreground text-pretty">
        {children}
      </p>
    </header>
  );
}

/**
 * Error strip wired to the shake. Replays whenever a NEW error arrives —
 * including the same message twice — via the remove → reflow → re-add dance
 * the snippet documents.
 */
export function OnboardingError({ error }: { error: string | null }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLParagraphElement>(null);

  // The `.is-error` / `.is-shaking` classes are driven imperatively rather
  // than through React state, matching the skill's own orchestration: the
  // shake has to replay on a repeat failure (remove → reflow → re-add), and
  // that sequence has to happen within one frame, which a state round-trip
  // can't guarantee.
  useEffect(() => {
    const wrap = wrapRef.current;
    const el = stripRef.current;
    if (!wrap || !el || !error) return;

    // Start from the hidden resting state so the reveal actually transitions
    // in, then arm both on the next frame.
    wrap.classList.remove("is-error");
    el.classList.remove("is-error", "is-shaking");
    void el.offsetWidth; // force reflow so the animation replays

    const raf = requestAnimationFrame(() => {
      wrap.classList.add("is-error");
      el.classList.add("is-error", "is-shaking");
    });

    const cs = getComputedStyle(document.documentElement);
    const ms = (name: string, fallback: number) => {
      const v = parseFloat(cs.getPropertyValue(name));
      return Number.isFinite(v) ? v : fallback;
    };
    const shakeMs = ms("--shake-dur-a", 80) * 2 + ms("--shake-dur-b", 60) * 2;
    const timer = setTimeout(() => el.classList.remove("is-shaking"), shakeMs + 40);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [error]);

  // Absent entirely until something fails: `.t-error-msg` hides with
  // opacity/visibility, so keeping it mounted would reserve a blank band under
  // the heading on every render. The trade is that clearing an error cuts
  // rather than fades — which is invisible in practice, since it clears at the
  // moment the next submit starts.
  if (!error) return null;

  return (
    <div ref={wrapRef} className="t-input-wrap">
      <p
        ref={stripRef}
        role="alert"
        className="t-input t-error-msg mb-6 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-center text-sm text-destructive"
      >
        {error}
      </p>
    </div>
  );
}
