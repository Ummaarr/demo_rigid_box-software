# Estimation engines

Moved out of the repo-root `CLAUDE.md` so it loads only when working under `lib/engines/`.
Security, database and rate-integrity rules stay in the root file.

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
