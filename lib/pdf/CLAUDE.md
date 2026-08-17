# Quotation, branding and PDF output

Moved out of the repo-root `CLAUDE.md` so it loads only when working under `lib/pdf/`.

## GST (quotation stage)
- 5% on rigid boxes / monocartons / carry bags (the box price)
- 18% on additional costs, stickers, paper printing

NOTE: these are hardcoded constants (`BOX_GST_PCT`, `ADDL_GST_PCT` in
`lib/pdf/quotation-data.ts`, duplicated in `components/quotes/quote-preview.tsx`)
with the rates written into label strings. See "Known gaps" below.

## Quotation + Branding
Every generated quote is SAVED to the `quotes` table with a running number
`<PREFIX>/26-27/001` (Indian FY Apr–Mar; atomic counter via `quote_counters` +
`next_quote_no()` RPC; prefix = `BRAND.quotePrefix`). Both PDF paths (POST
`/api/quote` multi + GET `/api/estimate/[id]/quote` single) go through
`lib/pdf/generate-quote.ts` `issueQuote()` — number, save (items/terms/totals/
bill-to snapshot), stream. `/quotes` lists them; "PDF" re-renders from the SAVED
snapshot (GET `/api/quote/[id]/pdf` — never recomputed).

The box subtotal is `cost.subtotalAfterMargin` (fallback `total_price −
additional.total`). PDF item specs are structured multi-line (`specsLines()`).

REVISIONS: re-quoting an already-quoted estimate keeps the ORIGINAL number and
appends -R1, -R2 (`nextRevisionNo`) instead of burning a new FY sequence number.
`baseQuoteNo` strips the suffix. Custom quotes save with `estimate_ids: []` and a
real FY number — `nextRevisionNo` returns null for an empty list, so they are
never treated as a revision.

QUOTE PREVIEW: `/quotes/new` is two steps — pick a source (saved estimates or a
blank custom quote), then REVIEW AND EDIT the whole document (bill-to, per-item
description/specs/qty/unit price, one-time charge lines, free-text notes, terms)
with GST and totals recomputing live. Nothing is numbered, saved or rendered
until "Generate PDF". EVERY derived number is recomputed server-side by
`finalizeQuoteDraft`, so a browser cannot post a quote whose totals disagree with
its items or that skips GST; negative/NaN input clamps to 0.

BRAND: all identity lives in `lib/brand.ts` (name, monogram, tagline, address,
GSTIN, bank block, quote prefix, currency dressing, logo intrinsics). It is PURE —
no `server-only`, no React — so client components, PDF builders and offline
scripts all import it. `COMPANY` (`quote-shared.ts`) and `BANK`/`QUOTE_PREFIX`
(`quotation-data.ts`) are built FROM it; `COMPANY`'s object SHAPE is load-bearing
(`QuotationData.company: typeof COMPANY`).

Rebranding = replace `lib/brand.ts` + `public/brand/logo.png` + `app/icon.png` +
`app/apple-icon.png` + `app/favicon.ico`, plus the brand hexes in FOUR places —
`app/globals.css` (`--primary`/`--clay`), both PDF documents (`INK`/`SOFT`), and
`lib/pdf/materials-data.ts` (`INK`/`SOFT`/`COMBO_PALETTE`). The last one is easy
to miss: it is data, not a document, so a grep of `components/pdf/` alone will
not find it. The palette is warm espresso (`#33261C`) + clay (`#B4552D`), and
that pair is LOAD-BEARING in the nesting diagrams — `INK` draws normal pieces,
`SOFT` the rotated ones — so any replacement must stay clearly separable, which
in practice means two hues rather than two shades of one.

CURRENCY: `lib/currency.ts` `formatMoney()` is the single formatter, reading
`BRAND.currencySymbol` / `currencyLocale` / `currencyDivisor`. The divisor scales
COMPUTED amounts at render time only (1 = no scaling); it deliberately does NOT
reach rate-card cells (editable — a scaled display would be saved back scaled) or
live echoes of numbers just typed into the form.

## Raw-material PDF (cost-free)
GET `/api/estimate/[id]/materials` — any authenticated role. Recomputes from the
frozen snapshots (legacy snapshot → 422). The data builder
`lib/pdf/materials-data.ts` is PURE (meta + `specs_snapshot` + materials only —
structurally cannot leak a cost; validated by a no-currency-bytes check). Layout:
header (SS number, dims, box type, qty, client, date), kappa board block then
keylines, wrapping organised per component (identically-wrapped parts note their
shared sheet/plate so counts don't double), foam (+cover) / reverse board (+top
paper) / accessory counts / consumables / one-time investment. Handle/lock/misc
rows embed their rate-card photo.
