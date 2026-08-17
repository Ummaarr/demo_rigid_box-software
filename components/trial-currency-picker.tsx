"use client";

// First-login step for a TRIAL account: pick the market you're evaluating
// from. Unlike the rates banner this is a BLOCKING screen, not a dismissible
// strip — until it is answered the account has no rate card at all (see
// app/api/trial/set-currency), so there is nothing for the app's pages to
// price against.
//
// The choice is one-way, and the footnote says so: re-homing an edited card
// and every estimate priced against it isn't supported, so a lead who picks
// wrong needs a fresh account.
//
// COPY IS DELIBERATELY THIN. This is the first screen a prospect ever sees,
// and the currency detail it used to spell out ("priced in $ USD", what a rate
// card is, who can see it) is either obvious from the country or repeated on
// the very next step. The tiles therefore carry the country name alone.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { CURRENCY_CODES, CURRENCY_META } from "@/lib/currency-meta";
import {
  OnboardingError,
  OnboardingHeading,
  OnboardingScreen,
  useRevealOnMount,
} from "@/components/trial-onboarding";
import type { CurrencyCode } from "@/types";

export function TrialCurrencyPicker() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<CurrencyCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = useRevealOnMount();

  async function choose(currency: CurrencyCode) {
    setSubmitting(currency);
    setError(null);
    try {
      const res = await fetch("/api/trial/set-currency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Something went wrong. Please try again.");
        setSubmitting(null);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
      setSubmitting(null);
    }
  }

  return (
    <OnboardingScreen>
      <OnboardingHeading shown={shown} title="Where are you quoting from?">
        We&apos;ll set up your rate card with local starting figures.
      </OnboardingHeading>

      <OnboardingError error={error} />

      <div
        className={`t-stagger grid gap-3 sm:grid-cols-2 ${shown ? "is-shown" : ""}`}
      >
        {CURRENCY_CODES.map((code, i) => {
          const meta = CURRENCY_META[code];
          const busy = submitting === code;
          // The stagger class owns `display: block`, so it goes on a wrapper
          // rather than on the flex button itself.
          return (
            <div
              key={code}
              // Tiles pick up at line 3 so they land after the heading pair
              // rather than racing it.
              className={`t-stagger-line t-stagger-line--${Math.min(i + 3, 6)}`}
            >
              <button
                type="button"
                disabled={submitting !== null}
                aria-busy={busy}
                onClick={() => void choose(code)}
                // The chosen tile stays lit while the others fade back, so the
                // wait reads as "this one is working" rather than "everything
                // went dead".
                className={`flex w-full items-center gap-4 rounded-lg bg-card p-4 text-left font-medium shadow-[var(--shadow-border)] transition-[box-shadow,scale,opacity] duration-200 hover:shadow-[var(--shadow-border-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.96] disabled:pointer-events-none ${
                  submitting !== null && !busy ? "opacity-40" : "opacity-100"
                }`}
              >
                <span aria-hidden="true" className="text-2xl leading-none">
                  {meta.flag}
                </span>
                <span className="min-w-0 flex-1 truncate">{meta.country}</span>
                {busy && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* The footnote doubles as the busy line: building the card is real work
          (23 tables copied), so say what is happening rather than leaving a
          spinner to explain itself. */}
      <p
        aria-live="polite"
        className="mt-8 text-center text-xs text-muted-foreground text-pretty"
      >
        {submitting
          ? `Setting up your ${CURRENCY_META[submitting].country} rate card…`
          : "This can’t be changed later."}
      </p>
    </OnboardingScreen>
  );
}
