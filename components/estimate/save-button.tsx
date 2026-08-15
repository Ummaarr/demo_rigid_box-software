"use client";

// The Save button owns the confirmation moment.
//
// Before, saving changed nothing about the button and printed a line of small
// green text underneath — the one control the user was actually looking at gave
// no feedback at all, so a save on a slow connection was indistinguishable from
// a click that missed.
//
// Now the label swaps in place through the three real states (transitions-dev
// "text states swap": the old label leaves upward with a blur, the new one
// arrives from below), and the finished state draws the same tick the rest of
// the app uses for success. The tint holds for a beat, then the button returns
// to "Save estimate" so it is immediately usable again — the persistent record
// of the save lives in the notice below it, not here.

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SuccessCheck } from "@/components/ui/success-check";
import { cn } from "@/lib/utils";

export type SaveState = "idle" | "saving" | "saved";

/**
 * Ordering IS the animation direction: a state before the active one has
 * already left (exits upward), one after it has not arrived yet (waits below).
 * Reverting saved -> idle therefore plays the motion backwards, which is what
 * an undo should look like.
 */
const ORDER: SaveState[] = ["idle", "saving", "saved"];

function posOf(item: SaveState, active: SaveState): "above" | "active" | "below" {
  const i = ORDER.indexOf(item);
  const a = ORDER.indexOf(active);
  return i === a ? "active" : i < a ? "above" : "below";
}

export function SaveButton({
  state,
  savedId,
  onClick,
  disabled,
  className,
}: {
  state: SaveState;
  /** Changes per save, so a second save replays the tick instead of holding it. */
  savedId?: string | null;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const item = (s: SaveState) => {
    const pos = posOf(s, state);
    return {
      "data-pos": pos,
      // Only the visible label should reach a screen reader; the other two are
      // laid out purely to hold the cell's size.
      "aria-hidden": pos !== "active" ? true : undefined,
      className: "inline-flex items-center gap-1.5 whitespace-nowrap",
    };
  };

  return (
    <Button
      size="lg"
      variant="outline"
      className={cn(
        state === "saved" &&
          "border-success/30 bg-success/10 text-success hover:bg-success/10 hover:text-success",
        className,
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="t-text-swap">
        <span {...item("idle")}>Save estimate</span>
        <span {...item("saving")}>
          <Loader2 className={cn("size-3.5", state === "saving" && "animate-spin")} />
          Saving…
        </span>
        <span {...item("saved")}>
          <SuccessCheck play={state === "saved"} replayKey={savedId} size={15} />
          Saved
        </span>
      </span>
    </Button>
  );
}
