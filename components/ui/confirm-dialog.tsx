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
import { TriangleAlert, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface ConfirmOptions {
  /** The question, as a question — "Delete estimate?" */
  title: string;
  /** What is being acted on; rendered prominently under the title. */
  subject?: string;
  /** Consequences. Keep it to the part the user can't already see. */
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  icon?: LucideIcon;
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
  // Focus starts on Cancel: a destructive action should never be one stray
  // Enter away, and Base UI would otherwise focus the first tabbable element.
  const cancelRef = useRef<HTMLButtonElement>(null);
  const Icon = options?.icon ?? TriangleAlert;

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
        <AlertDialog.Popup
          initialFocus={cancelRef}
          className="t-modal fixed inset-0 z-50 m-auto h-fit w-[calc(100%-2rem)] max-w-[25rem] rounded-xl border bg-popover p-4 text-popover-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-6px_rgba(0,0,0,0.10),0_24px_48px_-16px_rgba(0,0,0,0.16)] outline-none"
        >
          <div className="flex gap-3">
            {/* Concentric: rounded-lg badge inside the rounded-xl popup. */}
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive"
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <AlertDialog.Title className="font-heading text-sm font-medium text-balance">
                {options?.title}
              </AlertDialog.Title>
              {options?.subject && (
                <p className="mt-0.5 truncate text-sm text-foreground/80">{options.subject}</p>
              )}
              {options?.body && (
                <AlertDialog.Description className="mt-1.5 text-xs text-pretty text-muted-foreground">
                  {options.body}
                </AlertDialog.Description>
              )}
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button
              ref={cancelRef}
              size="lg"
              variant="outline"
              onClick={() => onResolve(false)}
            >
              {options?.cancelLabel ?? "Cancel"}
            </Button>
            <Button size="lg" variant="destructive" onClick={() => onResolve(true)}>
              {options?.confirmLabel ?? "Delete"}
            </Button>
          </div>
        </AlertDialog.Popup>
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
