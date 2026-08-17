"use client";

// Second first-login step for a TRIAL account, straight after the country
// picker: point them at their rate card before they start estimating.
//
// This replaces the dismissible banner that used to sit above the dashboard.
// A strip is too easy to miss, and the failure it guards against is silent — a
// lead who never opens the rate card produces confident-looking quotes priced
// entirely off OUR seeded figures, with nothing on screen saying so. A
// full-screen step in the same shape as the country picker is much harder to
// walk past.
//
// Both buttons acknowledge the prompt, so it is shown exactly once either way:
// "Review my rates" drops them on the real /rates page, "Skip" goes to the
// dashboard. Skipping is deliberately allowed — a lead who is happy with the
// starting figures shouldn't be trapped here.
//
// The two actions are styled here rather than with <Button>: this screen wants
// the large high-contrast pair (filled primary + plain card) at a size the
// shared button scale doesn't carry, and the shared base sets `transition-all`,
// which would drag unrelated properties into the press animation.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { CURRENCY_META } from "@/lib/currency-meta";
import {
  OnboardingError,
  OnboardingHeading,
  OnboardingScreen,
  useRevealOnMount,
} from "@/components/trial-onboarding";
import type { CurrencyCode } from "@/types";

// Sizing matches the shared <Button size="lg"> scale (h-9, rounded-lg) — the
// oversized pair this screen briefly used read as too heavy next to the rest
// of the app. Only the fill/shadow treatment is local; see the note below on
// why these aren't <Button> elements.
const ACTION_BASE =
  "inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium transition-[box-shadow,scale,background-color] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.96] disabled:pointer-events-none disabled:opacity-60 sm:w-auto";

export function TrialRateReview({ currency }: { currency: CurrencyCode }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<"review" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const meta = CURRENCY_META[currency];
  const shown = useRevealOnMount();

  // Warm both destinations while the lead is still reading this screen. /rates
  // is the heaviest page in the app (it loads the entire rate card), and the
  // wait for it was the bulk of what felt slow after clicking through.
  useEffect(() => {
    router.prefetch("/rates");
    router.prefetch("/dashboard");
  }, [router]);

  async function acknowledge(next: "review" | "skip") {
    setSubmitting(next);
    setError(null);
    try {
      const res = await fetch("/api/trial/ack-rates", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not save. Please try again.");
        setSubmitting(null);
        return;
      }
      // The layout re-reads trial_rates_ack on the server, so refresh() has to
      // run for the gate to actually lift behind us.
      router.push(next === "review" ? "/rates" : "/dashboard");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
      setSubmitting(null);
    }
  }

  return (
    <OnboardingScreen>
      <OnboardingHeading shown={shown} title="Check your rates before you start">
        Your card starts on our standard {meta.country} figures — your estimates
        are only as accurate as these numbers.
      </OnboardingHeading>

      <OnboardingError error={error} />

      <div
        className={`t-stagger flex flex-col gap-3 sm:flex-row sm:justify-center ${
          shown ? "is-shown" : ""
        }`}
      >
        <div className="t-stagger-line t-stagger-line--3">
          <button
            type="button"
            disabled={submitting !== null}
            onClick={() => void acknowledge("review")}
            className={`${ACTION_BASE} bg-primary text-primary-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.12)] hover:bg-primary/90`}
          >
            {submitting === "review" && <Loader2 className="h-4 w-4 animate-spin" />}
            Review my rates
          </button>
        </div>
        <div className="t-stagger-line t-stagger-line--4">
          <button
            type="button"
            disabled={submitting !== null}
            onClick={() => void acknowledge("skip")}
            className={`${ACTION_BASE} bg-card text-foreground shadow-[var(--shadow-border)] hover:shadow-[var(--shadow-border-hover)]`}
          >
            {submitting === "skip" && <Loader2 className="h-4 w-4 animate-spin" />}
            Skip for now
          </button>
        </div>
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground text-pretty">
        You can edit your rates any time from the Rates page.
      </p>
    </OnboardingScreen>
  );
}
