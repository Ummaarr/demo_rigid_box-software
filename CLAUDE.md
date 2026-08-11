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

## Tech Stack
- Framework: Next.js (React) with TypeScript
- Database: Supabase (PostgreSQL)
- Auth: Supabase Auth
- UI components: shadcn/ui (install components as needed, not all at once)
- PDF: React-PDF
- Hosting: Vercel
- Styling: Tailwind CSS

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
  `seed.sql` → create the first admin user (see the bootstrap comment at the end
  of `schema.sql`) → set the 3 env vars → deploy. No code changes.
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
- Enforce permissions on BOTH frontend (hide UI) and backend (API route checks).
- There is no public signup. Admins provision users at `/staff`, which creates
  the auth user with `email_confirm: true` and inserts the `profiles` row,
  rolling back the auth user if the profile insert fails. Password reset is an
  admin action, not a user-initiated email flow.

## Units
All dimensions are in INCHES. This is the storage contract, not a display
choice: `_in` is in every type field, in 11 database column names, and on the
customer-facing PDFs. `lib/units.ts` converts at the input boundary only
(mm/cm entry), and stock SHEET sizes always stay in inches because they mirror
the rate card's inch-labelled sizes.

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
All dimensions in inches. L = length, W = width, H = height (internal dims).
Each box type lists its own variables (the inputs its formula needs).

- **Telescopic**: tray (H+L+H) x (H+W+H); lid (Depth+L+Depth) x (Depth+W+Depth)
    Variables: Lid depth (default 1.5 in)
- **Magnetic**: tray (H+L+H) x (H+W+H);
    Regular (4-panel) case (Flap+W+H+W) x L; 3-panel case (Flap+W+H) x L;
    5-panel case (Flap+W+H+W+FlapHeight) x L
    Variables: Flap length, number of panels (3/4/5), Flap height (5-panel only),
    closure (magnet/ribbon)
- **Shoulder**: tray (BH+L+BH) x (BH+W+BH); neck (NH+L+NH) x (NH+W+NH);
    lid (Depth+L+Depth) x (Depth+W+Depth)
    Variables: Lid depth, Neck height (NH), Bottom height (BH)
- **Drawer sliding**: tray (H+L+H) x (H+W+H); sleeve (W+H) x (L+H+L+H)
    Variables: Sleeve material (kappa board / duplex board / CyberXL / custom)
- **Match-box sliding**: tray (H+L+H) x (H+W+H); sleeve (W+H+W+H) x L
    Variables: Sleeve material
- **Hinge lid**: tray (BH+L+BH) x (BH+W+BH); neck (NH+L+NH) x (NH+W+NH);
    lid (Depth+L+Depth) x (Depth+W+Depth)
    ("base" = "tray", used interchangeably, so the tray component auto-includes
    tape. "inner box" = the neck formula.)
    Variables: Bottom height, Neck height, Lid depth, ribbon support
- **Collapsible rigid**: case (Flap+W+H+W+H) x L;
    2 tray pieces, each (H+W+H) x (H+H)
    Variables: adhesive tape (with/without), closure (magnet/ribbon)
- **Double decker**: case (Flap+W+[H1+H2]+W) x L;
    tray 1 (H1+L+H1) x (H1+W+H1); tray 2 (H2+L+H2) x (H2+W+H2);
    drawer sleeve (W+H1) x (L+H+L+H1)
    Variables: Flap length, number of panels, H1 (tray 1 height), H2 (tray 2)

### Lid / sleeve fit allowance
A lid's inner dimension must clear the base's outer dimension. `vars.fitAllowance_in`
is derived by `lib/formulas/fit.ts`: **2t + 1mm as the TOTAL added to EACH of L
and W** (note the units contract — formulas read `L + f`, never `L + 2*f`).

`FIT_ALLOWANCE_TYPES` covers telescopic, shoulder, drawer_sliding and
matchbox_sliding. Substitutions: telescopic + shoulder lid `(D+(L+f)+D) x
(D+(W+f)+D)`; shoulder tray likewise; drawer sleeve `((W+f)+H) x ((L+f)+H+(L+f)+H)`.
The neck is untouched.

INJECTION: `buildEstimate` rebuilds the request (validate → inject → applySections
→ snapshot) so `specs_snapshot` CARRIES the var. `recomputeMaterials` /
`buildMaterialInput` NEVER derive it, so old snapshots without the var compute
byte-identically. The four keyline components apply the same substitutions —
`creasesForBlank` matches panels to blanks by dimension, so skipping one silently
drops its fold lines. Wrap paper grows automatically since it derives from board
blanks. The sleeve INSERT gets no allowance (free dims).

## Engine Structure
**Engine 1 — Raw Material Estimator** (`/lib/engines/material.ts`)
  Input: box specs (L, W, H, variables, qty, board thickness, paper GSM etc.)
  Output: quantities (board sheets, paper sheets, foam sheets, accessories)
  1. Calculate blank dimensions per component using the box type formula
  2. Run orientation comparison (A vs B) for each material
  3. Select the better orientation (or use the user override)
  4. Calculate sheets needed per material
  5. Return full material quantities

**Engine 2 — Cost Estimator** (`/lib/engines/cost.ts`)
  Input: material quantities from Engine 1 + rates from DB
  Output: itemised cost breakdown
  - Step 1 — Raw materials (level-1): board; wrapping paper; lining paper;
    printing (offset tiered OR digital OR special paper — no print); finishing
    (lamination/foil/UV/relief x area formula); inserts (foam / reverse board +
    top paper / card / ribbon tag); accessories (magnets, washers); fixed RM
    costs (tape computed; glue + metlock manual open inputs)
  - Step 2 — Labour (level-1): sum of lines, each role x (per-hour OR per-day
    rate) x quantity. Multiple lines per estimate.
  - Step 3 — Overhead: +% of level-1 (raw materials + labour). Editable.
  - Step 4 — Margin: +% of level-2 (RM + labour + overhead). Editable input.
  - Step 5 — Additional costs (manual, added AFTER margin, no margin on them):
    one-time charges, block charges (auto-prompt when foiling/emboss/deboss
    selected), designer charges.
  - Final: price per box and total (pre-GST; GST applied at quotation stage).

### Partial / sectional estimates
`sections` on the request (`{board, wrapping, inserts}`, missing = all on) plus an
"Estimate covers" checkbox strip on the form. Excluded wrapping/inserts
selections are dropped SERVER-SIDE (`applySections` in `build-estimate.ts` — the
API is authoritative). Board off = board still NESTED (paper blanks need the
keyline) but board cost, auto tape and ribbon-tag are not charged. At least one
section is required (400 otherwise). The snapshot stores the RAW request so
re-editing restores everything.

### Ordered vs production quantity
`EstimateRequest.quantity` is what was ORDERED. `productionQuantity?` is the
optional larger wastage run. `productionQuantity(req)` (in `auto-printing-core`,
pure — `build-estimate` and the auto evaluator must agree) resolves it, falling
back to the order when absent or smaller. Engine 1 nests the production run;
Engine 2 divides by `CostRates.orderedQuantity` for `pricePerBox`.
`estimates.quantity` stores the ORDER.

## Nesting
**Board nesting — combination layouts.** The real process checks combinations
across components on one sheet to cut waste, not just each component on its own
sheets. Implemented as guillotine combination nesting (`computeCombination` in
`lib/engines/material.ts`): it evaluates every split of components into
cut-together groups and cut-alone singles (set partitions); each group is packed
via both guillotine directions (horizontal shelves / vertical strips) x every
per-component orientation to maximise complete boxes per sheet. The all-separate
plan is always a candidate, so the result is GUARANTEED never worse than the
per-component baseline. `MaterialEstimate.combination` carries the result;
`totalSheets` already reflects it.

EXTENDED to outer wrap and inner lining paper: within ONE wrap layer every
component's blank already shares the same paper stock/GSM/print job, so
`estimatePaperMaterial` takes the same `combine` flag as board. Combination is
NEVER applied ACROSS layers (outer vs inner vs foam-cover), since those carry
independent paper stock, GSM and print settings. Foam-cover combination is
explicitly NOT done — each insert's cover is configured independently.

Printing wastage (+10%/+15%) is applied AFTER the combination search picks a
plan, inflating each shared group's sheet count once (not once per member) — see
`applyWastage` for the rounding proof that never-worse still holds.

LIMITATION: shelves are a conservative model of true 2D nesting — a planner may
still beat it by pocketing a small part in a big part's leftover corner. True
non-guillotine pocketing is out of scope (factory cutters cut straight lines).

**Mixed-orientation nesting.** `packPiecesOnSheet` also upgrades per-component
nesting: main grid + rotated pieces in the leftover strips, used only when
STRICTLY better than both pure grids. GATED on `EstimateRequest.nestingVersion >= 2`
(the form always sends 2; absent = pure grids, byte-identical for old snapshots).
A user orientation override always forces the pure grid.
`BlankMaterialResult.mixed?` carries `{perSheet, layout}`. Applies to board, wrap
layers, reverse board and card-stock inserts; foam pieces/covers and window film
keep pure grids.

**Orientation comparison.** For every material and component, calculate both:
  A: floor(sheet_W / blank_W) x floor(sheet_H / blank_H)
  B: floor(sheet_W / blank_H) x floor(sheet_H / blank_W)
Show both on the result screen, pre-select the higher count, let the user
override — the engine recalculates instantly.

## Paper Wrapping Rules
**Option 1 (Printed paper)**
  Outer paper blank = board keyline + folding allowance (default 20mm) each side,
  editable per estimate. Inner lining blank = board keyline EXACTLY.

  INNER LINING MODES: None / White paper / Printed paper / Special paper. The
  inner carries its OWN finishing selections (`InnerWrap.finishing`, resolved,
  costed and shown as "Finishing (inner)"). Outer finishing lives under the outer
  wrap block (`EstimateRequest.finishing`). White paper is priced from its own
  `white_paper_rates` table. Special inner mirrors the outer special branch.
  Legacy snapshots without a mode resolve via `paper_rates` exactly as before.

  PRINT SIZE DRIVES PAPER SIZE: the form picks the printing size FIRST; paper
  sizes are filtered to sheets the print can be cut from (either orientation),
  auto-picking the smallest. Blanks nest on the PRINT area, not the full paper
  sheet; paper purchase is derived by nesting the print size onto the paper sheet
  (`PaperPurchase`, `derivePaperPurchase`). Paper cost = purchased sheets;
  printing + whole-sheet finishing = printed sheets. When print size == paper
  size this reduces exactly to the old behaviour.

  PRINTING WASTAGE OVERRIDE: per-estimate "Printing wastage %" field (empty =
  auto 10/15 from `app_config`; a number overrides — heavy solid-colour jobs
  waste more). `wastagePctOverride` on the printed `OuterWrap`.

**Option 2 (Special paper)**
  Outer blank = same as Option 1 outer. Inner blank = board keyline exactly.
  No printing cost — paper cost only. Sheet size comes from the rate card, with
  an input override on the form.

### Magnetic inner lining
The case's inner lining is `(Flap + W + spine H) × L` for ALL panel variants —
the tray is glued over the other W panel, so that face is never seen. 3-panel is
already that; 4-panel drops its second W; 5-panel drops its second W AND its
flap-height panel. Tray lining, board and outer wrap are UNCHANGED.

Implemented as a per-box-type blank-list mapper (`lib/formulas/inner-lining.ts`,
`innerLiningBlanksFor` — identity for every unregistered type) applied at the
INNER-layer boundary in `estimateMaterials`, gated on
`EstimateRequest.liningVersion >= 2`. WHY NOT emit a smaller blank from
`magneticBlanks`: formulas re-run at recompute time from a saved
`specs_snapshot`, so an ungated emit would retroactively re-price every magnetic
estimate ever saved. The mapper also keeps `MaterialQuantities.blanks` as the
BOARD keylines, which the keylines, materials PDF and result panel all read.

### Per-component wrapping
`wrapping.perComponent?: Record<component, ComponentWrap>` — each part's own
outer/inner/finishing. Engine 1 groups components by RESOLVED CONFIG IDENTITY
(`wrapLayerGroups`), so identically-wrapped parts still nest together and share
ONE plate; only genuinely different wraps split. With no overrides there is
exactly one group and output is byte-identical. `outerPaperGroups` /
`innerPaperGroups` + `wrapGroupsOf(mat, layer)` (with the legacy fallback) is what
display and Engine 2 read. Engine 2 sums per group via `CostRates.outerGroups` /
`innerGroups`, mapping rates to groups BY READING EACH GROUP'S COMPONENTS, never
by assuming order. Auto printing stays estimate-level and is rejected in
`validate()` for per-part wraps.

## Printing
User chooses offset OR digital per estimate. All printing rates live in the DB.

**Auto-economical printing.** Print-size selects (outer + inner) offer "Auto —
cheapest option" (`PrintingSelection.auto`). `resolveAutoPrinting`
(`lib/estimate/auto-printing.ts`; pure evaluator in `auto-printing-core.ts`) runs
BEFORE `loadEstimateRates` and concretizes the request: every size of the chosen
TYPE × every fitting paper row at the chosen GSM, each nested through the REAL
engine path (same wastage tier, same combine/mixed flags), cheapest
printing+purchased-paper total wins; ties → smaller print, then paper.
`specs_snapshot` keeps `auto` (re-runs re-optimize); `rates_snapshot` freezes the
winner + `autoPicks`. Auto stays WITHIN the chosen type. Foam covers / card
stocks keep explicit sizes.

**Combined vs separate printing.** `EstimateRequest.printingMode?` ("combined"
default). Separate ⇒ wrap layers never combine across components (each part is
its own plate) AND Engine 2 charges the offset tier minimum PER COMPONENT.

**Per-job offset charging + tie consolidation.** `computeCombination` takes
`consolidateTies` — lexicographic (totalSheets, blockCount): a partition that TIES
on sheets but needs fewer blocks (plates) wins ON WRAP LAYERS ONLY. Board and all
insert estimators stay strict-win. `layerPrintJobs(layer)` (in `material.ts`,
re-exported from `cost.ts`) resolves jobs = combination groups + still-alone
components BY NAME, and `layerPrintingCost` charges one offset tier PER JOB. ONE
GATE for both halves: `printingMode != null`.

**Printing cost split.** `PrintingDetailLine {label, amount, sheets, tier}` +
`CostBreakdown.printingDetail` / `innerPrintingDetail`, emitted with a conditional
spread so the key is ABSENT when there is no printing and on older snapshots.
`layerPrintingLines` mirrors `layerPrintingCost`'s branching EXACTLY and is
deliberately NOT refactored into a shared "compute lines then sum" — float
addition is not associative and `printing` must stay bit-identical.

**Printing vendor.** `PrintingSelection.vendor?` (omitted = "any"). The unique
keys are `(size_label, colour, vendor)` / `(size_label, vendor)` PLUS a partial
unique index `where vendor is null` on each — load-bearing, because UNIQUE treats
NULLs as DISTINCT and the widened key alone would permit two un-named rows per
size. `printRow()` in `lib/db/rates.ts` filters `.eq("vendor", v)` when named,
else does NOT filter (PostgREST cannot express `vendor is null` via `.match`) and
orders `nullsFirst` with `.limit(1)`. Auto printing loads/filters vendor and
WRITES THE WINNER'S VENDOR BACK into the concretized request.

## Finishing
Area basis: per-sq-inch finishes (foiling, spot UV, relief/emboss) are charged on
the actual finished DESIGN area (an L x W input on the form, per box x qty) — NOT
the whole sheet. Whole-sheet finishes (lamination, full UV, drip-off, aquas — all
per-100-sq-inch) stay on printed-sheet area. Design area defaults to the box
footprint (L x W) when not entered.

Relief (embossing/debossing) triggers a block charge (manual, under Additional
Costs).

**Itemised finishing.** `resolveFinishing` copies `key`/`finish` onto each
`FinishingRate`; `finishingDetailLines` itemises per pass —
`CostBreakdown.finishingDetail` / `innerFinishingDetail` `{label, amount}[]`
alongside the kept totals (the sum reproduces them exactly). Scope is outer +
inner wrap only; insert finishing stays folded into insert lines.

## Wastage Calculation
Board / non-printed material: no wastage percentage. Wastage = sheet area not
used after nesting, from the nesting math:
  boxes_per_sheet = floor(sheet_W / blank_W) x floor(sheet_H / blank_H)
  sheets_needed = ceil(quantity / boxes_per_sheet)

PRINTED paper: always run extra sheets for setup/spoilage — +10% if printing
only, +15% if printing + foiling/UV. Applied to the printed paper sheet count per
component (ceil), flowing into paper + printing + whole-sheet finishing cost.
Engine 1 `wastagePct`; `build-estimate` decides 0/10/15 from the selections.
Applies to the outer wrap AND the PRINTED inner lining — the inner tier keys off
the INNER's own foil/UV finishing. White / special / unprinted inner get none.
Only the outer has the per-estimate override field.

Wastage is applied PER PLATE, independently: `applyWastage` inflates each
combination group's and each lone component's `sheetsNeeded` separately and
`Math.ceil`s each, then sums — so two separately-printed components get the %
applied to each with two independent round-ups.

## Keyline Visual
Rendered as SVG in React, no external library. One component per box type in
`/components/keylines/`. Draws the flat blank shape + fold lines (dashed) +
dimension labels, parametrically from blank dimensions passed as props — never
hardcoded. Geometry helpers are extracted to `lib/nesting/geometry.ts` (pure,
type-only engine imports) and shared with the PDF renderer; any new renderer must
consume it too.

## Costing Layers (in order)
Level 1 — Raw materials: board · wrapping paper · lining paper · printing ·
finishing · inserts · accessories · fixed RM costs (tape computed; glue + metlock
manual)
Level 1 — Labour: multi-role; per-hour or per-day x quantity
Level 2 — Overhead: +% of level 1, editable
Level 3 — Margin: +% of level 2, editable, admin-only
After margin (no margin applied): additional costs (one-time, block, designer)
GST: applied at quotation stage, not in Engine 2

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
- **Foam**: type (XLPE / EPE / PU) + thickness. Pieces per sheet = better of
  (L_foam/L x B_foam/W) vs (L_foam/W x B_foam/L). MULTIPLE foam inserts per
  estimate (`inserts.foams[]`; old snapshots' single `foam` honoured). PER-MM
  PRICE: `foam_rates.rate_per_mm` — when set (>0) sheet price = rate x thickness;
  `cost_per_sheet` is the flat fallback. BOARD COVERING per insert: top/bottom
  toggles; pieces cut to the foam footprint from art paper / art card / special
  paper; optional PRINTING follows the outer/inner formula exactly (+10% wastage,
  never 15 — no foil/UV on covers). `FoamInsertSelection.punchingMargin_mm` adds
  mm per side when NESTING (`FoamEstimate.nestedBlank`); covers still cut to the
  raw footprint.
- **Reverse board**: keyline = tray formula using insert height Hi:
  (Hi+L+Hi) x (Hi+W+Hi). Top paper: same as paper calc on the board keyline, NO
  folding allowance.
- **Card insert**: open dimension. Cost is a manual open input; optional
  descriptive size / materialType / gsm document what the floor buys.
- **Ribbon tag**: auto for drawer / double decker; standard price or custom.
- **Sleeve**: `InsertsSelection.sleeve` = `{dims, stock: SleeveStock}` where
  `SleeveStock` = `CardStockSelection` minus lamination plus FULL finishing.
  Runs `estimateCardInsert` (keyline exact, no folding allowance) with the 10/15
  wastage tier off its OWN foil/UV. Only paper and art card — not kappa board.
- **Beading / Card partition / Custom card partition**: shared `CardStockSelection`.
  Blanks (L+4BH+2BT)×(W+4BH+2BT) ×1 · (H+H)×L ×nL + (H+H)×W ×nW (may share
  sheets) · L×W ×count. Material = art paper / board+type / special. Printing
  follows the print-drives-purchase model (+10% wastage). Lamination is a single
  dropdown, not the full `FinishingPicker` — deliberate: one pass is the spec.
- **Handles / Locks**: type + number + size; cost = number x price-by-type.
  Manual, not auto.
- **Window**: size L x W; nests the window film like foam. `punchingMargin_mm` is
  FORCE-SET by `buildEstimate` to `WINDOW_PUNCHING_MARGIN_MM` (=10), overriding
  whatever the client sends, so it lands in `specs_snapshot` and can't be skipped.
  The form shows a static "10mm added automatically" note.

## Miscellaneous Add-ons
`AddonsSelection.misc[]` — dynamic list on the form (label / optional L×W / units
/ manual price per unit). Cost = units × price, a Level-1 RM line (`addonsMisc`)
so overhead + margin apply; dropped with the inserts section.
`MiscAddonSelection.perBox` multiplies by the production quantity like
handles/locks/magnets; ABSENT on old snapshots keeps the flat total.
`misc_rates` is also a rate-card section.

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
`app/apple-icon.png` + `app/favicon.ico`, plus the navy/gold hexes in
`app/globals.css` and the two PDF documents.

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

## Rate data integrity
Engine 1 nests on a rate row's `width_in`/`height_in` — NEVER on its `size_label`.
A row whose label disagrees with its own dimensions costs the wrong sheet and only
surfaces later as a confusing "print doesn't fit the paper" error. Guards: the
Rates page shows a warning icon beside any mismatched size label, and the fit
error quotes the paper's NAME alongside its stored size plus an explicit note
(`labelMatchesSheet` in `build-estimate.ts`).

## Config surface
`app_config` (numeric only): `folding_allowance_mm`, `inner_lining_reduction_mm`,
`lid_depth_default_in`, `moq`, `overhead_pct`, `print_wastage_pct`,
`print_foil_wastage_pct`. `margin_config`: `default_margin_pct` (admin-only via
RLS, excluded from staff proposals).

**THREE OF THESE ARE DEAD** — editable on the rate card but read by nothing:
- `moq` — not enforced anywhere; the form hardcodes the sentence "MOQ is 500."
- `lid_depth_default_in` — the real default is three separate
  `DEFAULT_LID_DEPTH_IN = 1.5` constants (`telescopic.ts`, `shoulder.ts`,
  `hinge_lid.ts`) plus `defaultVars()` in the form
- `inner_lining_reduction_mm` — label only

Wiring these to the code that currently hardcodes them is a known TODO; until
then, changing them on the rate card changes nothing, which is a trap.

## Validation
`/scripts` holds offline validators, all runnable without a database:
`validate-engines`, `validate-print-paper`, `validate-combination-nesting`,
`keylines-check`, and `validate-round3`, `-round5` through `-round10`. They assert
invariants (never-worse nesting, auto == brute force, byte-identity for ungated
paths, cost reconciliation) rather than golden rupee amounts wherever possible.

Run notes: `validate-round3`, `-round9` and `-round10` import server-only modules
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
- **Quote numbering assumes the Indian financial year.** `fyLabel()` hardcodes the
  April cutover and `quote_counters` is keyed on the FY string. A Jan–Dec company
  gets silently wrong years, not an error.
- **Units.** Inches are the storage contract (see ## Units). A metric-native
  customer can type mm, but every rate card, keyline diagram, quotation spec line
  and raw-material sheet still says inches.
- **Currency.** No currency column exists on any table, so historical rows have no
  migration path if the currency changes. The PDF uses a text prefix because the
  built-in Helvetica has no rupee glyph.
- **Default terms.** `DEFAULT_TERMS` is a code array containing one company's
  payment, lead-time, delivery-city and return policy. Editable per quote and
  snapshotted into `quotes.terms`, but the defaults are wrong until edited.
- **Multi-tenancy.** There is none: no `org_id` on any table, every RLS policy is
  `using (true)`, and `quote_counters` is one global sequence per database.
  Isolation comes entirely from one Supabase project per customer.
- **No migration runner.** `supabase/migration-*.sql` are hand-applied one-offs
  with no version table. `schema.sql` is idempotent and complete, so "re-run
  schema.sql" works as a crude upgrade path.
