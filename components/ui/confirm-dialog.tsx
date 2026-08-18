"use client";

// In-app replacement for window.confirm().
//
// The native dialog was wrong for this app on three counts: it is painted by
// the browser (Chrome shows "localhost:3124 says", which looks like a bug in a
// tool people are meant to trust), it cannot say anything in the app's own
// voice or typography, and it blocks the JS thread outright so nothing can
// animate around it.
//
// Motion is the transitions-dev "modal open / close" — scale up from 0.96 on
// open, a quicker dip back down on close, backdrop cross-fading with it. The
// CSS lives in globals.css (.t-modal / .t-modal-backdrop); see the comment
// there for how the skill's .is-open / .is-closing hooks map onto Base UI's
// data attributes.
//
// Usage — a drop-in for the `if (!window.confirm(...)) return;` line it
// replaces, so call sites keep their existing control flow:
//
//   const { confirm, confirmDialog } = useConfirm();
//   async function remove() {
//     if (!(await confirm({ title: "Delete X?", body: "…" }))) return;
//     …
//   }
//   return (<>{confirmDialog}…</>);

import { useCallback, useRef, useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface ConfirmOptions {
  /** The question, asked as one — "Delete estimate?". Answered by the buttons. */
  title: string;
  /**
   * WHICH record — the estimate's name, the client, the rate row. Quoted and
   * emphasised inside the sentence, so the one thing that can prevent a
   * mistake is named without breaking the dialog's conversational tone.
   */
  subject?: string;
  /** Consequences. Keep it to the part the user can't already see. */
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

function ConfirmDialog({
  open,
  options,
  onResolve,
}: {
  open: boolean;
  options: ConfirmOptions | null;
  onResolve: (confirmed: boolean) => void;
}) {
  // Focus starts on the decline button: a destructive action should never be
  // one stray Enter away, and Base UI would otherwise focus the first tabbable
  // element — which here is the same button, but say it explicitly so a later
  // reorder of the footer can't silently arm the delete.
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        // Esc / any Base UI-initiated close is a decline.
        if (!next) onResolve(false);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="t-modal-backdrop fixed inset-0 z-50 bg-foreground/15 supports-backdrop-filter:backdrop-blur-[2px]" />
        {/* Centred optically, not geometrically: the extra bottom padding lifts
            the dialog ~6vh above true centre, which is where the eye expects it.
            A dialog on the exact midline always reads as sitting low.
            pointer-events-none keeps this wrapper from swallowing backdrop
            events; the popup itself takes them back. */}
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4 pb-[12vh]">
          <AlertDialog.Popup
            initialFocus={cancelRef}
            className="t-modal pointer-events-auto w-full max-w-[24.5rem] rounded-2xl border bg-popover p-6 text-center text-popover-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-6px_rgba(0,0,0,0.10),0_24px_48px_-16px_rgba(0,0,0,0.16)] outline-none"
          >
            <span
              aria-hidden="true"
              className="mx-auto flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger"
            >
              <TriangleAlert className="size-5" />
            </span>

            <AlertDialog.Title className="mt-4 text-lg leading-snug font-semibold tracking-[-0.015em] text-balance text-primary">
              {options?.title}
            </AlertDialog.Title>

            {/* No max-width clamp: at this dialog size a ch-based clamp forces
                the quoted record name to break mid-way ("Telescopic × / 500"),
                which is the one string here that must stay readable. */}
            <AlertDialog.Description className="mt-2 text-[0.8125rem] leading-relaxed text-pretty text-muted-foreground">
              {/* Naming the record inside the sentence keeps the one detail that
                  prevents a mistake without breaking the conversational tone —
                  the emphasis does the work a separate headline used to. */}
              {options?.subject && (
                <>
                  You&rsquo;re about to delete{" "}
                  <span className="font-medium text-foreground">
                    &ldquo;{options.subject}&rdquo;
                  </span>
                  .{" "}
                </>
              )}
              {options?.body}
            </AlertDialog.Description>

            {/* Both buttons answer the title as a question, so neither can be
                hit without reading it — "Cancel / Delete" makes you work out
                which one is which. Equal width, because the choice is equal;
                only the colour says which way is destructive. */}
            <div className="mt-6 flex gap-2.5">
              <Button
                ref={cancelRef}
                size="lg"
                variant="secondary"
                className="h-10 flex-1 rounded-xl"
                onClick={() => onResolve(false)}
              >
                {options?.cancelLabel ?? "No, keep it"}
              </Button>
              <Button
                size="lg"
                className="h-10 flex-1 rounded-xl bg-danger-solid text-danger-foreground hover:bg-danger-solid/90 focus-visible:border-danger-solid/40 focus-visible:ring-danger-solid/20"
                onClick={() => onResolve(true)}
              >
                {options?.confirmLabel ?? "Yes, delete"}
              </Button>
            </div>
          </AlertDialog.Popup>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function useConfirm() {
  const [open, setOpen] = useState(false);
  // Held past close so the text doesn't blank out mid-exit — Base UI keeps the
  // popup mounted for the whole closing transition.
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmOptions) => {
    // A second ask while one is pending declines the first, so no caller is
    // left awaiting a promise that can never settle.
    resolveRef.current?.(false);
    setOptions(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const onResolve = useCallback((confirmed: boolean) => {
    setOpen(false);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(confirmed);
  }, []);

  return {
    confirm,
    confirmDialog: <ConfirmDialog open={open} options={options} onResolve={onResolve} />,
  };
}
