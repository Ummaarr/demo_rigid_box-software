@AGENTS.md

# Rigid Box Cost Estimator — Project Context

## Project Overview
A web-based cost estimation platform for rigid box manufacturing. Internal tool
used by Admin and Staff only — end customers never access the app, they receive
only the final PDF quotation.

The app takes box specs (type, dimensions, quantity, materials, finishing,
inserts) and produces: raw-material quantities with nesting layouts, an itemised
cost breakdown, a keyline diagram, a cost-free raw-material sheet for the floor,
and a branded quotation PDF.

## Critical Architecture Rule
ALL Supabase calls must go through Next.js API routes (`/app/api/`).
Never call Supabase directly from the browser/client components.
This is non-negotiable — it also protects against ISP-level blocks in some
regions, which is why `proxy.ts` exists.

## Security Rules
- service_role Supabase key: server-side only, never in client code, never in Git
- `.env.local` must be in `.gitignore` — verify before first commit
- Enforce roles on the BACKEND: API routes strip margin/cost data for Staff
  before responding
- Hiding data in the UI is NOT enough — never send role-restricted data to the
  browser
- Row Level Security is enabled on all tables, but it is defence-in-depth only:
  every real access path uses the service-role client (`lib/db/admin.ts`), which
  bypasses RLS. Enforcement lives in the API routes and `lib/auth.ts`.
- Validate all inputs on the backend (reject negative/zero/missing values)
- Use Supabase Auth for login — never roll custom auth

## Database Rules
1. Every estimate stores TWO snapshots:
   - `specs_snapshot` (JSON) — full input specs at time of estimate
   - `rates_snapshot` (JSON) — ALL rates used at time of estimate
   Old estimates therefore never change when rates are updated.

2. Never hardcode any rate or cost value in formula logic.
   All rates come from the database. Formulas contain only math.

3. Every rate field must exist as a real database row — never skip a field
   because a real value is unknown. Use a placeholder number instead, flagged
   with `is_dummy = true`.

## Schema & Deployment
- DB schema and seed data live as plain SQL in `/supabase/` (`schema.sql`,
  `seed.sql`), checked into the repo. They are the source of truth — never
  hand-type schema only in the dashboard.
- Standing up a new instance: create a Supabase project → run `schema.sql` +
  `seed.sql` + `seed-currency-templates.sql` → create the first admin user (see
  the bootstrap comment at the end of `schema.sql`) → set the 3 env vars →
  deploy. No code changes. (`seed.sql` seeds the INR master card;
  `seed-currency-templates.sql` adds the USD/GBP/AED template sets a trial
  account can be provisioned from. Skip it and those three picker options
  produce an empty rate card.)
- All Supabase config is via env vars only (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
- `schema.sql` is idempotent and complete. The `migration-*.sql` files are
  historical deltas for upgrading an already-deployed database; a fresh install
  needs only `schema.sql` + `seed.sql`.
- ORDERING TRAP: the `do $$` block that adds `vendor`/`updated_by` alters tables
  by name and MUST stay after the last `create table`. It sat earlier once and
  aborted the whole script on an empty database.

## User Roles
- **Admin**: full access — estimates, rates, all data, users, margins visible
- **Staff**: create estimates and quotations; cannot see profit margin. Staff can
  VIEW the rate card (margin + app-config sections stripped SERVER-SIDE in
  `loadAllRates`) and PROPOSE rate changes; an admin approves/rejects in-app
  (`rate_change_requests`, POST/PATCH `/api/rates/propose`, sidebar badge with
  the pending count). Approving applies the change through the same validated
  path as a direct edit (`lib/db/rate-whitelist.ts` `applyRateUpdate`, shared
  with PATCH `/api/rates`).
- **Trial**: a short-lived EXTERNAL lead evaluating the app (see "Trial
  accounts" below). Isolated to its own data + its own private rate card.
- Enforce permissions on BOTH frontend (hide UI) and backend (API route checks).
- There is no public signup. Admins provision users at `/staff`, which creates
  the auth user with `email_confirm: true` and inserts the `profiles` row,
  rolling back the auth user if the profile insert fails. Password reset is an
  admin action, not a user-initiated email flow.

### Trial accounts (external leads, one shared deployment)
Added so a handful of prospective manufacturers can evaluate the engine on
ONE deployment without seeing each other. Deliberately NOT a general
multi-tenant system — no org/tenant table, just row ownership.

- **Scoping.** `ownerScopeFor(session)` (`lib/auth.ts`) is the single source of
  truth: `null` for admin/staff (unrestricted, byte-identical to before), the
  user's own id for trial. It scopes BOTH `owner_id` (their private rate-card
  clone) and `created_by` (their clients/estimates/quotes/dashboard). Never
  derive it from a client-sent value.
- **Private rate card.** Every rate table + `margin_config` has a nullable
  `owner_id`: NULL = the shared master card, a uuid = one trial user's clone,
  copied at account creation by `cloneRateCardForUser`
  (`lib/db/clone-rate-card.ts`). `app_config` is NOT cloned — global formula
  config, admin-only.
- **FOUR rate-read call sites must all be card-aware** or the card silently
  half-applies: `lib/db/rates.ts` (`row`/`printRow`), `lib/estimate/
  auto-printing.ts`, `lib/db/rate-admin.ts`, `lib/db/rate-options.ts`. Miss the
  last one and the estimate FORM offers the master card's sizes while costing
  resolves the clone's.
- **A card is identified by TWO columns, `owner_id` AND `currency`** —
  `lib/db/card-scope.ts` is the one place that pairs them (`scopeToCard` for
  PostgREST queries, `matchRows` in `lib/db/rate-cache.ts` for the cached
  in-memory path). Owner alone is enough for a trial, whose clone is one
  market; it is NOT enough for the SHARED card, which holds four template sets
  once `seed-currency-templates.sql` has been run. Reading it owner-only
  matched four rows per key and took every admin/staff estimate down with a
  500 ("N rows matched a lookup that must return one"), and would have had
  auto-printing shop for the cheapest plate across markets. `margin_config`
  and `app_config` are market-independent and carry no `currency` column —
  `CURRENCY_AGNOSTIC_TABLES`, shared with `cloneRateCardForUser`.
- **Writes** go through `applyRateUpdate`, which checks row ownership: admin
  may only touch `owner_id is null`, trial only its own. Trial edits DIRECTLY
  (no propose/approve — that gate exists to protect the SHARED card from staff
  edits; nothing else reads a trial's clone). POST `/api/rates` stamps
  `owner_id` server-side.
- **Margin is visible to trial** (their own markup on their own private
  estimate, from their own cloned `margin_config` row) — `costForRole`, both
  estimate routes' override stripping, and the form input all treat
  admin+trial alike. Staff still never see it.
- **Deleting a trial user deletes their work** (quotes → estimates → clients,
  in `DELETE /api/staff/[id]`, before `deleteUser`; the rate clone cascades via
  the `owner_id` FK). Staff/admin deletion is UNCHANGED — their rows are real
  company history and stay with a nulled `created_by`.
- A trial account's ROLE CANNOT BE CHANGED (API + UI both refuse): converting
  either way would need the private rate card and data cloned or re-homed.
  Delete and re-create instead.
- **First-login banner** (`components/trial-rate-banner.tsx`) prompts them to
  review rates; dismissal is EXPLICIT (`profiles.trial_rates_ack`, POST
  `/api/trial/ack-rates`), not "clears on first edit" — a lead may keep the
  seeded values and would otherwise be nagged forever.
- **Market / currency (v8).** A trial picks their country on FIRST LOGIN and
  their whole card is priced for that market — real per-market figures, not an
  FX conversion or a symbol swap. `profiles.trial_currency` (null = not yet
  picked) drives it; `app/(app)/layout.tsx` renders a BLOCKING
  `TrialCurrencyPicker` instead of the shell while it is null, because until
  then the account has NO rate card at all. Cloning therefore does NOT happen
  at account creation any more — `POST /api/trial/set-currency` is what calls
  `cloneRateCardForUser(admin, uid, currency)`, and both `POST /api/staff` and
  the ->trial branch of `PATCH /api/staff/[id]` deliberately skip it. The
  choice is one-way (delete and re-create to change market), same rule as role.
  Every SHARED rate row carries `currency`, so the master card is four template
  sets; `margin_config`/`app_config` do NOT (percentages and formula constants
  are market-independent). `POST /api/rates` stamps `currency` server-side
  beside `owner_id` — miss it and a trial's added row lands in the INR card,
  invisible to their own estimates.
- **Currency display.** `formatMoney(n, decimals, fmt?)` takes an optional
  per-market override; omitted = the deployment's BRAND dressing, so
  admin/staff render byte-identically to before v8. Client components read it
  from `CurrencyProvider` via `useMoneyFormatter()` / `useCurrencyCode()`
  (seeded once server-side in the app layout); server components call
  `currencyMetaFor(session)` directly. `loadAllRates` takes the symbol for its
  unit labels; `buildCostView` takes the format for its inline rate strings.
- **GST is gated on currency.** `buildGstLines(box, addl, currency)` returns []
  for anything but INR, so a UK/US/UAE trial's quote carries no tax line rather
  than a fabricated Indian one. `components/quotes/quote-preview.tsx` mirrors
  that gate (it is display-only; the server figure is authoritative). Real VAT
  / sales tax remains an open gap — see "Known gaps".
- **Quotes snapshot their currency** (`quotes.currency`, null = pre-v8 or
  admin/staff) so re-rendering a saved PDF prints what it was issued in, not
  the re-generator's market.
- **SQL TRAP:** the natural-key `unique` constraints on the rate tables are now
  PAIRS OF PARTIAL INDEXES (`where owner_id is null` / `... is not null`), the
  same pattern `vendor` already used, because a plain composite unique would
  let two MASTER rows share a key (`NULL <> NULL`). Consequences: every
  `on conflict` in `seed.sql` must restate `where owner_id is null`, and the
  pre-v7 blocks in `schema.sql` that re-add the old bare keys are guarded on
  `owner_id` not existing — without that guard, re-running `schema.sql` on a DB
  with trial clones aborts.
  v8 EXTENDS this: `currency` is now the FIRST column of every `_key_shared`
  index (the `owner_id is null` half only — a user holds one currency, so the
  `_key_owned` half is untouched), which is why every `on conflict` in both
  seed files leads with `currency`. `app_config`/`margin_config` keep their
  original targets.

## Units
All dimensions are STORED in INCHES. This is the storage contract, not a
display choice: `_in` is in every type field, in 11 database column names, and
on the customer-facing PDFs. `lib/units.ts` converts at the boundaries only.

STOCK SHEETS ARE THE ONE PLACE THE UNIT IS REMEMBERED (v9). Every sheet-bearing
rate table carries `size_unit` ('in' | 'cm' | 'mm'), defaulting to 'in'. It
changes DISPLAY only — the `_in` columns are still what the engines nest on, and
scripts/validate-sheet-sizes.ts pins that a 70x100 cm sheet produces the same
sheet count as the identical inches. Two consequences worth knowing:

- `size_label` numbers are written in the row's OWN unit, so a metric row reads
  "70x100" against 27.559 x 39.370 in. Never compare a label to a sheet without
  the unit — use `labelAgreesWithSheet` (lib/units.ts), which both the server
  guard and the rate-card warning icon now share.
- Do NOT put the unit inside `size_label`. Three parsers expect a bare WxH pair
  and every one of them fails OPEN on "70x100 cm", silently disabling the
  mismatch guard, the paper-fits-print filter and the live nesting preview.

Internal conversions (e.g. to sqm for GSM calculations) happen inside functions
only, never exposed to the user.

## Box Types (8 standard types + tray-only)
1. Telescopic box — 2 components (lid, tray)
2. Magnetic box — 2 components (case, tray) — 3/4/5 panel variants
3. Shoulder box — 3 components (lid, neck, tray)
4. Drawer sliding box — 2 components (tray, sleeve)
5. Match-box sliding box — 2 components (tray, sleeve)
6. Hinge lid box — 3 components (tray [a.k.a. base], inner box, lid)
7. Collapsible rigid box — 3 components (case, 2 tray pieces)
8. Double decker box — 4 components (drawer tray, drawer sleeve, top tray, case)
9. Only tray (`tray_only`) — 1 component: tray (H+L+H) x (H+W+H); no variables;
   no magnets/metlock/ribbon; tape auto-applies (component named "tray")

Each box type has its own formula. Formulas live in `/lib/formulas/`, one file
per box type. Never mix formula logic across files.

### Registering a NEW box type — full checklist
The first nine are compile errors if missed. **The last five fail SILENTLY with
wrong numbers**, so they are the dangerous ones:

1. `types/index.ts` — `BoxType` union
2. `lib/box-types.ts` — `BOX_LABELS`
3. `lib/formulas/<type>.ts` — the formula file
4. `lib/formulas/index.ts` — `blankFormulas` registry
5. `components/keylines/<type>-keyline.tsx` — the keyline component
6. `components/keylines/index.ts` — `keylineComponents` registry
7. `components/keylines/index.ts` — `keylinePanelBuilders` registry
8. `lib/estimate/build-estimate.ts` — `BOX_TYPES` validator set
9. `supabase/schema.sql` — the `estimates_box_type_check` CHECK constraint
10. `lib/engines/material.ts` — `AUTO_TRIGGER` (magnets/metlock/ribbon tag)
11. **`lib/formulas/fit.ts`** — `FIT_ALLOWANCE_TYPES`. Miss it and a new sliding
    box gets no lid/sleeve clearance: the boxes physically do not fit, with no
    error anywhere.
12. **`lib/formulas/inner-lining.ts`** — `liningFormulas` is a `Partial` record;
    an unregistered type silently falls back to the board keyline.
13. **`lib/formulas/sleeve.ts`** — an if/else, not a registry; unregistered types
    silently use the matchbox formula.
14. **`lib/engines/material.ts`** — `trayLidComponentCount()` decides tape cost by
    string-matching component names for `"tray"`/`"lid"`. A type whose components
    are named differently silently gets zero tape cost.
15. `components/estimate/estimate-form.tsx` — `VAR_KEYS`, `defaultVars()`, and
    `VAR_BASE_LABELS`; plus any new field on `BoxVariables` in `types/index.ts`.

## Blank Dimension Formulas
Blank formulas per box type, and the lid/sleeve fit allowance, are in `lib/formulas/CLAUDE.md`.

## Engine Structure
Engine 1 / Engine 2 internals, partial estimates and ordered-vs-production quantity are in `lib/engines/CLAUDE.md`.

## Nesting
Combination nesting, mixed-orientation nesting and orientation comparison are in `lib/engines/CLAUDE.md`.

## Paper Wrapping Rules
Outer/inner wrap modes, print-drives-paper sizing and per-component wrapping are in `lib/engines/CLAUDE.md`.

## Printing
Auto-economical printing, combined-vs-separate mode, per-job offset charging and vendor keys are in `lib/engines/CLAUDE.md`.

## Finishing
Area basis and itemised finishing are in `lib/engines/CLAUDE.md`.

## Wastage Calculation
Wastage tiers and per-plate application are in `lib/engines/CLAUDE.md`.

## Keyline Visual
Keyline rendering rules are in `components/keylines/CLAUDE.md`.

## Auto-triggered Costs by Box Type
Magnets + Washers + Metlock auto-include for: magnetic, double decker,
collapsible rigid; hinge lid and shoulder get metlock only.
Tape auto-includes per tray AND lid component.
Washers auto-include whenever magnets are selected (same count).
Ribbon tag auto-includes for drawer sliding + double decker.
Glue + Metlock are open input boxes (cost entered per estimate — by total cost OR
by quantity × unit rate); metlock auto-prompts for magnetic / hinge-lid /
shoulder-neck / foam / reverse-board.

## Inserts
Foam, reverse board, card, ribbon tag, sleeve, beading/partitions, handles/locks and window are in `lib/engines/CLAUDE.md`.

## Miscellaneous Add-ons
See `lib/engines/CLAUDE.md`.

## Manual line edits
`EstimateRequest.adjustments?: CostAdjustment[]` (`{line, to, note, basis}`) rides
on the REQUEST — so it lands in `specs_snapshot`, re-editing restores it, and a
re-run reproduces it. Engine 2 applies edits to a `lines` record AFTER computing
every line and BEFORE summing `materialSubtotal`, so overhead and margin
recalculate on the edited base. `CostBreakdown.adjustments` records
`{line, computed, applied, delta, note}` — the ORIGINAL engine figure survives, so
an estimate opened months later reads as deliberately edited, not miscalculated.

DELIBERATELY NOT DONE: mutating `rates_snapshot` (would need a fake back-solved
rate that lies to the audit trail and cannot express an offset TIER at all) or
editing the stored `cost_breakdown` (any recompute silently reverts it).
`ADJUSTABLE_LINES` whitelists Level-1 + labour only: never overhead/margin (own %
inputs) and never the post-margin total, which would let staff back-solve the
margin they cannot see.

STALE-EDIT GUARD: an edit is ABSOLUTE, so if the specs move underneath it the
pinned figure silently stops matching. `CostAdjustment.basis` freezes what the
engine computed when the edit was made; Engine 2 compares against the fresh
figure (>0.005 tolerance) and sets `AppliedAdjustment.stale`, surfaced as a loud
banner. The edit still APPLIES — it was deliberate — it is just never silent.

## Section-wise cost breakdown
`lib/estimate/cost-view.ts` `buildCostView` is PURE — it joins specs + recomputed
materials + the STORED `CostBreakdown`, never re-costs, so it cannot disagree with
the quote. Rows carry label + detail (quantities/sizes/types) + total + PER BOX,
dividing by the ORDERED quantity. `MaterialEstimate.preWastageSheets` lets paper
rows say "232 sheets (210 required + 22 wastage)".

Where rows SPLIT a line (itemised foam, printing tiers) the edit lives on the
SECTION total instead (`CostViewSection.line`), and that section total reports the
edited figure while sub-rows keep the computed split.

## Additional Costs (manual, after margin)
Die / Mould / Block charges — each a qty + rate pair (`ChargeLine`; legacy
snapshots stored the pre-multiplied number, so `chargeTotal`/`chargeDetail` in
`lib/estimate/charges.ts` read both shapes). Block auto-prompts when
foiling/embossing/debossing is selected. Designer charges (flat total).
No margin applied. Shown ITEMIZED on the result panel, estimate detail and the
quote PDF.

**Included or separate.** `EstimateRequest.additionalMode?: "included" | "separate"`
rides on the REQUEST → `CostRates.additionalMode` → ECHOED onto
`CostBreakdown.additionalMode`, which is what lets the quote layer follow the same
choice from the stored breakdown alone. `cost.total` is DELIBERATELY untouched —
it stays the whole pre-GST figure that `estimates.total_price` stores. Only the
NUMERATOR of the per-box divide moves:
`perBoxBase = additionalMode === "separate" ? subtotalAfterMargin : total`.
Default for new estimates is "separate"; hydrating an OLD snapshot sets
"included", because that is what it actually did. ABSENT = the historical hybrid
(amortised into `pricePerBox` but split out on the quote); the key is OMITTED when
unset so every saved snapshot recomputes byte-identically.

## GST (quotation stage)
GST rates and where they are hardcoded are in `lib/pdf/CLAUDE.md`. See also "Known gaps" below.

## Quotation + Branding
Quote numbering, revisions, the preview flow, `lib/brand.ts` and currency dressing are in `lib/pdf/CLAUDE.md`.

## Raw-material PDF (cost-free)
See `lib/pdf/CLAUDE.md`.

## Rate data integrity
Engine 1 nests on a rate row's `width_in`/`height_in` — NEVER on its `size_label`.
A row whose label disagrees with its own dimensions costs the wrong sheet and only
surfaces later as a confusing "print doesn't fit the paper" error. Guards: the
Rates page shows a warning icon beside any mismatched size label, and the fit
error quotes the paper's NAME alongside its stored size plus an explicit note
(`labelMatchesSheet` in `build-estimate.ts`).

## Config surface
`app_config` / `margin_config` field definitions live in `supabase/schema.sql`.

**THREE `app_config` FIELDS ARE DEAD** — editable on the rate card but read by
nothing:
- `moq` — not enforced anywhere; the form hardcodes the sentence "MOQ is 500."
- `lid_depth_default_in` — the real default is three separate
  `DEFAULT_LID_DEPTH_IN = 1.5` constants (`telescopic.ts`, `shoulder.ts`,
  `hinge_lid.ts`) plus `defaultVars()` in the form
- `inner_lining_reduction_mm` — label only

Wiring these to the code that currently hardcodes them is a known TODO; until
then, changing them on the rate card changes nothing, which is a trap.

## Validation
`/scripts` holds offline validators, all runnable without a database (the newer
three — `validate-tape-toggle`, `validate-rate-isolation`, `validate-sheet-sizes`
— also need `--conditions=react-server`):
`validate-engines`, `validate-print-paper`, `validate-combination-nesting`,
`keylines-check`, and `validate-round3`, `-round5` through `-round10`. They assert
invariants (never-worse nesting, auto == brute force, byte-identity for ungated
paths, cost reconciliation) rather than golden rupee amounts wherever possible.

Run notes: `validate-round3`, `-round9`, `-round10`, `validate-tape-toggle`,
`validate-rate-isolation` and `validate-sheet-sizes` import server-only modules
and need `--conditions=react-server`; `validate-round6` renders a PDF and must NOT
have that condition.

`scripts/seed-demo.ts` fabricates staff, clients, estimates and quotes into a
FRESH project, generating estimates through the real `buildEstimate()` so
snapshots and PDFs are genuine. It refuses to run unless `BRAND.isDemo` is true.

## Placeholder Data Note
Every rate shipped in `seed.sql` is an INVENTED PLACEHOLDER, flagged
`is_dummy = true` so the rate card badges it. None of it is real commercial
pricing. Replace all of it via the Admin rate screen before using the app in
anger. Every rate lives in the database — no rate is hardcoded in logic.

Glue + metlock are NOT rates: they are manual open inputs per estimate (a
total-or-per-box toggle, and a cost-or-quantity entry mode). Tape auto-computes
per tray/lid but has an open-input override.

## Known gaps / roadmap
Ordered roughly by difficulty. The estimation ENGINE is generic; the shell around
it carries assumptions from the market it was first built for.

- **Tax is India-only.** `BOX_GST_PCT = 5` / `ADDL_GST_PCT = 18` are constants in
  two files with the rates baked into label strings. There is no per-line tax
  rate, no HSN/SAC field, no CGST/SGST/IGST split, no tax-exempt path. VAT or US
  sales tax needs a different shape entirely, and `quotes.gst` is a schema column.
  v8 only made it HONEST for other markets — a non-INR quote shows no tax line
  at all rather than an Indian one. Those quotes are therefore pre-tax
  documents, which is the correct stopgap but not a tax implementation.
- **Quote numbering assumes the Indian financial year.** `fyLabel()` hardcodes the
  April cutover and `quote_counters` is keyed on the FY string. A Jan–Dec company
  gets silently wrong years, not an error.
- **Units.** Inches are the storage contract (see ## Units). A metric-native
  customer can type mm, but every rate card, keyline diagram, quotation spec line
  and raw-material sheet still says inches.
- **Currency.** PARTLY CLOSED by v8: every priced rate table and `quotes` now
  carry a `currency`, and a trial account is priced in its own market. Still
  open: admin/staff have no per-market choice (the deployment is INR, dressed
  as dollars by `BRAND` — see lib/brand.ts), there is no FX/conversion anywhere
  (each market is separately priced, by design), and a market cannot be changed
  after it is picked. The PDF still uses a text prefix because the built-in
  Helvetica has no rupee glyph.
- **Default terms.** `DEFAULT_TERMS` is a code array containing one company's
  payment, lead-time, delivery-city and return policy. Editable per quote and
  snapshotted into `quotes.terms`, but the defaults are wrong until edited.
- **Multi-tenancy.** There is none: no `org_id` on any table, every RLS policy is
  `using (true)`, and `quote_counters` is one global sequence per database.
  Isolation comes entirely from one Supabase project per customer.
- **No migration runner.** `supabase/migration-*.sql` are hand-applied one-offs
  with no version table. `schema.sql` is idempotent and complete, so "re-run
  schema.sql" works as a crude upgrade path.
