"use client";

// Transitions.dev — Error state shake (mechanics only). Our forms already show
// their own error messages + border states, so this hook owns just the shake:
// attach `ref` + the `t-shake` class to the element you want to shake, then call
// `shake()` when validation/submission fails. Styles auto-inject once, SSR-safe.

import { useCallback, useRef } from "react";

const STYLE_ID = "transitions-p12-shake";
const STYLES = `
:root {
  --shake-distance: 6px;
  --shake-overshoot: 4px;
  --shake-dur-a: 80ms;
  --shake-dur-b: 60ms;
  --shake-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
.t-shake { will-change: transform; }
.t-shake.is-shaking {
  animation: t-shake calc(var(--shake-dur-a) * 2 + var(--shake-dur-b) * 2) linear;
}
@keyframes t-shake {
  0%      { transform: translateX(0);                                animation-timing-function: var(--shake-ease); }
  28.57%  { transform: translateX(var(--shake-distance));            animation-timing-function: var(--shake-ease); }
  57.14%  { transform: translateX(calc(var(--shake-distance) * -1)); animation-timing-function: var(--shake-ease); }
  78.57%  { transform: translateX(var(--shake-overshoot));           animation-timing-function: var(--shake-ease); }
  100%    { transform: translateX(0); }
}
@media (prefers-reduced-motion: reduce) {
  .t-shake { animation: none !important; transform: none !important; }
}
`;

function ensureStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLES;
  document.head.appendChild(el);
}

export function useShake<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T>(null);
  const shake = useCallback(() => {
    ensureStyles();
    const el = ref.current;
    if (!el) return;
    // Drop → reflow → re-add so the animation replays every time.
    el.classList.remove("is-shaking");
    void el.offsetWidth;
    el.classList.add("is-shaking");
  }, []);
  return { ref, shake };
}
