"use client";

// Controlled numeric input that behaves the way people expect while typing.
//
// Binding a native number input's `value` directly to a number
// (`value={someNumber}`) has two long-standing problems: clearing the field
// snaps it back to "0", and a leading zero can get stuck ("0213") because React
// keeps re-imposing the numeric value mid-edit. NumberField keeps the *typed
// text* as local state while focused, so the field is fully editable (empty
// allowed, leading zeros removable), and reflects the canonical number again on
// blur / when the external value changes. State stays a real number via
// `onValueChange` — empty parses to 0.

import * as React from "react";

import { Input } from "@/components/ui/input";

type NumberFieldProps = Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "type"
> & {
  value: number;
  onValueChange: (n: number) => void;
  /**
   * When `value` equals this (typically 0, the "not entered" sentinel used
   * throughout this form), the settled field renders empty instead of the
   * literal digit — so an optional field you haven't touched reads as
   * missing (and shows its placeholder) rather than a misleading "0" that
   * looks deliberately entered. The field is never required to be filled;
   * this only affects how "untouched" displays. Typing is unaffected either
   * way — you can always type 0 explicitly while focused.
   */
  emptyValue?: number;
};

function fmt(n: number, emptyValue?: number): string {
  if (emptyValue != null && n === emptyValue) return "";
  return Number.isFinite(n) ? String(n) : "";
}

export function NumberField({
  value,
  onValueChange,
  emptyValue,
  onFocus,
  onBlur,
  ...rest
}: NumberFieldProps) {
  const [text, setText] = React.useState(() => fmt(value, emptyValue));
  const focused = React.useRef(false);

  // Reflect external numeric changes (unit switch, hydrate from a snapshot,
  // reset) — but never while the user is mid-edit, so typing is never fought.
  React.useEffect(() => {
    if (!focused.current) setText(fmt(value, emptyValue));
  }, [value, emptyValue]);

  return (
    <Input
      {...rest}
      type="number"
      inputMode="decimal"
      value={text}
      onFocus={(e) => {
        focused.current = true;
        // Select all so typing replaces the value instead of appending to it
        // (no more stuck leading "0").
        e.target.select();
        onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        setText(fmt(value, emptyValue)); // normalize the display to the canonical number
        onBlur?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw === "" || raw === "-" || raw === "." || raw === "-.") {
          onValueChange(0);
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n)) onValueChange(n);
      }}
    />
  );
}
