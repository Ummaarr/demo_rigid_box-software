# Keyline components

Moved out of the repo-root `CLAUDE.md` so it loads only when working under `components/keylines/`.

## Keyline Visual
Rendered as SVG in React, no external library. One component per box type in
`/components/keylines/`. Draws the flat blank shape + fold lines (dashed) +
dimension labels, parametrically from blank dimensions passed as props — never
hardcoded. Geometry helpers are extracted to `lib/nesting/geometry.ts` (pure,
type-only engine imports) and shared with the PDF renderer; any new renderer must
consume it too.
