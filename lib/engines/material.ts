// Engine 1 — Raw Material Estimator.
//
// Pure functions only: given a box type's blanks, a quantity, and a stock sheet
// size, compute how many sheets are needed — choosing the better of the two
// nesting orientations per blank. No DB, no rates, no UI here. Rates and sheet
// sizes are passed in by the caller (Phase 4 wires them from the database).
//
// Wastage is NOT a percentage. It falls out of the nesting math: any sheet area
// not covered by whole blanks is waste. See CLAUDE.md "Wastage Calculation".

import type { Blank, BoxDimensions, BoxType, BoxVariables } from "@/types";
import { getBlanks } from "@/lib/formulas";
import { innerLiningBlanksFor } from "@/lib/formulas/inner-lining";

/** A rectangular stock sheet (board, paper, foam, …). Inches. */
export interface Sheet {
  width_in: number;
  height_in: number;
}

/** Which way a blank is laid on the sheet. "A" = as-is, "B" = rotated 90°. */
export type Orientation = "A" | "B";

/**
 * Both nesting orientations for one blank on one sheet, with the better one
 * pre-selected. The result screen shows both so the user can override.
 *   A: floor(sheetW / blankW) x floor(sheetH / blankH)
 *   B: floor(sheetW / blankH) x floor(sheetH / blankW)  (blank turned 90°)
 */
export interface OrientationResult {
  acrossA: number;
  downA: number;
  perSheetA: number;
  acrossB: number;
  downB: number;
  perSheetB: number;
  recommended: Orientation; // the higher-yield orientation
}

/** Per-component material result: nesting + how many sheets the order needs. */
export interface BlankMaterialResult {
  component: string;
  blank: Blank;
  orientation: OrientationResult;
  chosen: Orientation; // recommended, unless the caller overrode it
  perSheet: number; // blanks per sheet in the chosen orientation
  totalBlanksNeeded: number; // quantity x count_per_box
  sheetsNeeded: number; // ceil(totalBlanksNeeded / perSheet)
  /**
   * Mixed-orientation layout (client 13-Jul: "minimise the wastage by using the
   * white portion — changing the cut to landscape"). Present ONLY when the
   * request opted in (nestingVersion >= 2), the user did not override this
   * component's orientation, and a main-grid + rotated-strip layout STRICTLY
   * beats both pure grids. `perSheet` above already reflects it; `chosen` is
   * the main grid's orientation. Absent = pure grid, exactly the old model —
   * saved snapshots without the opt-in recompute byte-identically.
   */
  mixed?: { perSheet: number; layout: PrintLayoutRect[] };
}

/** One horizontal shelf (row-band) of a single component in a combined layout. */
export interface CombinedShelf {
  component: string;
  orientation: Orientation;
  rows: number; // number of shelves (row-bands) given to this component
  perRow: number; // blanks per shelf row
  blankW_in: number; // oriented blank width used in this layout
  blankH_in: number; // oriented blank height (= shelf band height)
}

/** One group of components cut TOGETHER on shared sheets in the winning plan. */
export interface CombinedGroup {
  components: string[]; // component names sharing the sheet
  // Guillotine direction of the layout: "rows" = horizontal shelves stacked up
  // the sheet height; "cols" = vertical strips across the width.
  direction: "rows" | "cols";
  boxesPerSheet: number; // complete boxes yielded by one shared sheet
  sheetsNeeded: number; // ceil(quantity / boxesPerSheet)
  shelves: CombinedShelf[]; // the repeated per-sheet layout (for transparency/UI)
}

/**
 * Result of the client-doc Step-1 combination check ("Component 1 only / 2 only
 * / 3 only / 1+2 / 1+3 / 2+3 / 1+2+3"): every way of splitting the box's
 * components into cut-together groups and cut-alone singles is evaluated, and
 * the plan needing the fewest sheets wins. The all-separate plan is always a
 * candidate, so `combinedSheets` is NEVER worse than `separateSheets`.
 * `applied` is true only when some grouping won: strictly fewer sheets, or —
 * printed layers under a per-job printingMode (round 6) — the same sheets in
 * fewer print jobs (a sheet TIE still saves a plate: `combinedSheets` can then
 * equal `separateSheets` with `applied` true).
 */
export interface CombinationResult {
  applied: boolean;
  separateSheets: number; // sum of per-component sheets if every part is cut alone
  combinedSheets: number; // total sheets under the winning plan
  groups: CombinedGroup[]; // parts cut together (empty when applied=false)
  separateComponents: string[]; // parts still cut alone in the winning plan
}

/** Full board-material estimate for one box: per component + total sheets. */
export interface MaterialEstimate {
  sheet: Sheet;
  quantity: number;
  components: BlankMaterialResult[];
  totalSheets: number;
  /**
   * Sheets before the printed-paper wastage inflation (client final doc item
   * 11 wants "sheets actually required" and "sheets for wastage accounting"
   * reported separately). Present only on layers that carry a wastage % —
   * `totalSheets - preWastageSheets` is the wastage run.
   */
  preWastageSheets?: number;
  // Present only when combination nesting was attempted (board, multi-component).
  // `totalSheets` already reflects it when `combination.applied` is true.
  combination?: CombinationResult;
}

/** Per-component orientation override, keyed by component name. */
export type OrientationOverrides = Record<string, Orientation>;

/**
 * Compare both orientations of a blank on a sheet and recommend the better.
 * A blank larger than the sheet in both orientations yields 0 (caught upstream
 * as an error — you cannot make that box from that sheet).
 */
export function nestBlank(
  blank: { width_in: number; height_in: number },
  sheet: Sheet,
): OrientationResult {
  const acrossA = Math.floor(sheet.width_in / blank.width_in);
  const downA = Math.floor(sheet.height_in / blank.height_in);
  const perSheetA = acrossA * downA;

  const acrossB = Math.floor(sheet.width_in / blank.height_in);
  const downB = Math.floor(sheet.height_in / blank.width_in);
  const perSheetB = acrossB * downB;

  return {
    acrossA,
    downA,
    perSheetA,
    acrossB,
    downB,
    perSheetB,
    recommended: perSheetA >= perSheetB ? "A" : "B",
  };
}

/**
 * How many of `blank` fit per sheet in a given orientation.
 */
function perSheetFor(orientation: OrientationResult, chosen: Orientation): number {
  return chosen === "A" ? orientation.perSheetA : orientation.perSheetB;
}

// ===========================================================================
// Combination nesting (client's real "cut different parts on one sheet" method)
// ---------------------------------------------------------------------------
// Modelled as guillotine SHELVES: the sheet height is split into horizontal
// bands, each band dedicated to one component (full-width horizontal cuts
// between bands, vertical cuts within — machine-cuttable). We search shelf
// counts and each component's orientation to maximise complete boxes per sheet,
// then compare against cutting every component separately and keep whichever
// needs fewer sheets. GUARANTEED never worse than separate nesting.
//
// This is a conservative model of true 2D nesting: a planner eyeing the sheet
// may still beat it by pocketing a small part in a big part's leftover corner.
// So it reduces, but may not fully eliminate, the gap vs. the client's manual
// layout. Honest baseline until a real past order lets us measure the rest.
// ===========================================================================

interface OrientedComp {
  component: string;
  count: number; // count_per_box
  w: number; // oriented blank width (along the strip's long axis)
  h: number; // oriented blank height (= shelf band thickness)
  perRow: number; // floor(stripLength / w) — blanks packed along one band
  orientation: Orientation;
}

/**
 * Best shelf layout for a FIXED orientation of every component: choose how many
 * shelf bands each component gets so that Σ bands·bandThickness ≤ stackDepth and
 * the number of complete boxes — min over components of floor(bands·perRow /
 * count) — is maximised (tie-break: less wasted depth). Every component needs
 * ≥ 1 band (a sheet must hold all parts to yield a whole box). Returns null if
 * infeasible. Direction-agnostic: caller sets stripLength/stackDepth for rows
 * (shelves up the height) or cols (strips across the width).
 */
function bestShelfLayout(
  comps: OrientedComp[],
  stackDepth: number,
): { boxesPerSheet: number; wasted: number; bands: number[] } | null {
  const n = comps.length;
  if (comps.some((c) => c.perRow <= 0)) return null;
  const minTail: number[] = new Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) minTail[i] = minTail[i + 1] + comps[i].h;
  if (minTail[0] > stackDepth) return null; // can't fit even one band of each

  let best: { boxesPerSheet: number; wasted: number; bands: number[] } | null = null;
  const bands = new Array(n).fill(0);

  const rec = (i: number, used: number) => {
    if (i === n) {
      let boxes = Infinity;
      for (let j = 0; j < n; j++) {
        boxes = Math.min(boxes, Math.floor((bands[j] * comps[j].perRow) / comps[j].count));
      }
      if (boxes <= 0) return;
      const wasted = stackDepth - used;
      if (
        !best ||
        boxes > best.boxesPerSheet ||
        (boxes === best.boxesPerSheet && wasted < best.wasted)
      ) {
        best = { boxesPerSheet: boxes, wasted, bands: [...bands] };
      }
      return;
    }
    const c = comps[i];
    // Leave room for ≥1 band of every remaining component.
    const maxHere = stackDepth - used - minTail[i + 1];
    const maxBands = Math.floor(maxHere / c.h);
    for (let k = 1; k <= maxBands; k++) {
      bands[i] = k;
      rec(i + 1, used + k * c.h);
    }
    bands[i] = 0;
  };

  rec(0, 0);
  return best;
}

/**
 * Best shared-sheet layout for one GROUP of blanks cut together: both guillotine
 * directions (rows = horizontal shelves, cols = vertical strips) × every
 * orientation assignment (2^k), keeping the layout that yields the most complete
 * boxes per sheet. Returns null when the group can't share a sheet at all.
 */
function bestGroupLayout(
  blanks: Blank[],
  sheet: Sheet,
  quantity: number,
): CombinedGroup | null {
  const k = blanks.length;
  let bestBoxes = 0;
  let bestWasted = Infinity;
  let bestComps: OrientedComp[] | null = null;
  let bestBands: number[] | null = null;
  let bestDir: "rows" | "cols" = "rows";

  for (const direction of ["rows", "cols"] as const) {
    // rows: bands run across the width, stacked up the height.
    // cols: bands run up the height, stacked across the width (sheet transposed).
    const stripLength = direction === "rows" ? sheet.width_in : sheet.height_in;
    const stackDepth = direction === "rows" ? sheet.height_in : sheet.width_in;

    // Enumerate orientation per component (bit j: 0 = A/as-is, 1 = B/rotated).
    for (let mask = 0; mask < 1 << k; mask++) {
      const comps: OrientedComp[] = blanks.map((b, j) => {
        const rotated = (mask >> j) & 1;
        const w = rotated ? b.height_in : b.width_in;
        const h = rotated ? b.width_in : b.height_in;
        return {
          component: b.component,
          count: b.count_per_box,
          w,
          h,
          perRow: Math.floor(stripLength / w),
          orientation: (rotated ? "B" : "A") as Orientation,
        };
      });
      const layout = bestShelfLayout(comps, stackDepth);
      if (!layout) continue;
      if (
        layout.boxesPerSheet > bestBoxes ||
        (layout.boxesPerSheet === bestBoxes && layout.wasted < bestWasted)
      ) {
        bestBoxes = layout.boxesPerSheet;
        bestWasted = layout.wasted;
        bestComps = comps;
        bestBands = layout.bands;
        bestDir = direction;
      }
    }
  }

  if (!bestComps || !bestBands || bestBoxes <= 0) return null;

  return {
    components: bestComps.map((c) => c.component),
    direction: bestDir,
    boxesPerSheet: bestBoxes,
    sheetsNeeded: Math.ceil(quantity / bestBoxes),
    shelves: bestComps.map((c, j) => ({
      component: c.component,
      orientation: c.orientation,
      rows: bestBands![j],
      perRow: c.perRow,
      blankW_in: c.w,
      blankH_in: c.h,
    })),
  };
}

/** All set partitions of [0..n) into blocks, e.g. n=3 -> {0|1|2},{01|2},{02|1},{12|0},{012}. */
function setPartitions(n: number): number[][][] {
  const result: number[][][] = [];
  const current: number[][] = [];
  const rec = (i: number) => {
    if (i === n) {
      result.push(current.map((b) => [...b]));
      return;
    }
    for (const block of current) {
      block.push(i);
      rec(i + 1);
      block.pop();
    }
    current.push([i]);
    rec(i + 1);
    current.pop();
  };
  rec(0);
  return result;
}

/**
 * The client-doc Step-1 combination check: evaluate EVERY split of the box's
 * components into cut-together groups and cut-alone singles ("Component 1 only /
 * 2 only / 3 only / 1+2 / 1+3 / 2+3 / 1+2+3") and keep the plan with the fewest
 * total sheets. Singles use their separate-nesting sheet counts (incl. user
 * orientation overrides), so the all-singles plan reproduces `separateSheets`
 * exactly — the result is NEVER worse than separate nesting.
 */
function computeCombination(
  blanks: Blank[],
  quantity: number,
  sheet: Sheet,
  separateSheetsByComponent: number[],
  separateSheets: number,
  // Round 6 (client 15-Jul "combined printing"): on a PRINTED layer a sheet
  // tie still saves a plate — one shared layout = one print job. When true, a
  // partition with EQUAL sheets but fewer blocks (print jobs) beats the
  // incumbent; board and non-printed layers keep strict-win only.
  consolidateTies = false,
): CombinationResult {
  const none: CombinationResult = {
    applied: false,
    separateSheets,
    combinedSheets: separateSheets,
    groups: [],
    separateComponents: blanks.map((b) => b.component),
  };
  // Nothing to combine with a single component (or none).
  if (blanks.length < 2) return none;

  // Cache group layouts by member bitmask — the same block recurs across partitions.
  const groupCache = new Map<number, CombinedGroup | null>();
  const groupFor = (block: number[]): CombinedGroup | null => {
    const key = block.reduce((m, i) => m | (1 << i), 0);
    if (!groupCache.has(key)) {
      groupCache.set(
        key,
        bestGroupLayout(block.map((i) => blanks[i]), sheet, quantity),
      );
    }
    return groupCache.get(key)!;
  };

  let bestTotal = separateSheets;
  // Blocks = print jobs (each group or single is one plate). The all-separate
  // baseline has one block per component.
  let bestBlocks = blanks.length;
  let bestGroups: CombinedGroup[] = [];
  let bestSingles: string[] = blanks.map((b) => b.component);

  for (const partition of setPartitions(blanks.length)) {
    let total = 0;
    const groups: CombinedGroup[] = [];
    const singles: string[] = [];
    let feasible = true;
    for (const block of partition) {
      if (block.length === 1) {
        total += separateSheetsByComponent[block[0]];
        singles.push(blanks[block[0]].component);
      } else {
        const g = groupFor(block);
        if (!g) {
          feasible = false;
          break;
        }
        total += g.sheetsNeeded;
        groups.push(g);
      }
    }
    if (!feasible) continue;
    // Lexicographic (totalSheets, blockCount), strict < on both keys: sheets
    // always win; on a sheet tie fewer blocks win only when consolidating
    // (ties-of-ties keep the first-found — setPartitions is deterministic
    // recursion, so results are stable across runs and recomputes).
    if (
      total < bestTotal ||
      (consolidateTies && total === bestTotal && partition.length < bestBlocks)
    ) {
      bestTotal = total;
      bestBlocks = partition.length;
      bestGroups = groups;
      bestSingles = singles;
    }
  }

  // No grouping won (with strict-win only, this is exactly the old
  // bestTotal >= separateSheets condition — a winner always contains a group).
  if (bestGroups.length === 0) return none;

  return {
    applied: true,
    separateSheets,
    combinedSheets: bestTotal,
    groups: bestGroups,
    separateComponents: bestSingles,
  };
}

/**
 * Estimate board sheets for a set of blanks (one box type) at a given quantity.
 *
 * @param blanks    output of a /lib/formulas box-type function
 * @param quantity  number of finished boxes (validated > 0 by the caller)
 * @param sheet     stock sheet size, e.g. kappa board 31 x 41 in (from DB rate)
 * @param overrides optional per-component orientation overrides from the user
 * @param combine   attempt combination nesting across components. Used for
 *                  board, and for paper WITHIN one wrap layer (outer wrap's
 *                  own components, or inner lining's own components) — those
 *                  share one print job already. Never combined ACROSS layers
 *                  (outer vs inner vs foam-cover), which genuinely can differ
 *                  in paper stock/GSM/print settings.
 * @param mixed     allow a mixed-orientation layout per component (main grid +
 *                  leftover strips filled with rotated pieces — client 13-Jul).
 *                  Opt-in (nestingVersion >= 2 requests only) so saved
 *                  estimates recompute exactly as they were costed. A user
 *                  orientation override always forces the pure grid.
 * @param consolidateTies  printed layers only (round 6): accept a combination
 *                  that TIES on sheets when it needs fewer print jobs (plates).
 *                  Board must stay strict-win — its combination runs ungated
 *                  for every saved snapshot.
 */
export function estimateBoardMaterial(
  blanks: Blank[],
  quantity: number,
  sheet: Sheet,
  overrides: OrientationOverrides = {},
  combine = false,
  mixed = false,
  consolidateTies = false,
): MaterialEstimate {
  const components: BlankMaterialResult[] = blanks.map((blank) => {
    const orientation = nestBlank(blank, sheet);
    const overridden = overrides[blank.component] != null;
    let chosen = overrides[blank.component] ?? orientation.recommended;
    let perSheet = perSheetFor(orientation, chosen);

    // Mixed-orientation upgrade: keep the pure grid unless the packed layout
    // is STRICTLY better (equal = stable UI, byte-identical output). Both pure
    // grids are candidates inside packPiecesOnSheet, so this is never worse.
    let mixedResult: BlankMaterialResult["mixed"];
    if (mixed && !overridden) {
      const packed = packPiecesOnSheet(
        { width_in: blank.width_in, height_in: blank.height_in },
        sheet,
      );
      if (packed.count > perSheet) {
        perSheet = packed.count;
        chosen = packed.chosen;
        mixedResult = { perSheet: packed.count, layout: packed.layout };
      }
    }

    const totalBlanksNeeded = quantity * blank.count_per_box;
    // perSheet === 0 means the blank does not fit this sheet in this orientation.
    const sheetsNeeded =
      perSheet > 0 ? Math.ceil(totalBlanksNeeded / perSheet) : Infinity;

    return {
      component: blank.component,
      blank,
      orientation,
      chosen,
      perSheet,
      totalBlanksNeeded,
      sheetsNeeded,
      ...(mixedResult ? { mixed: mixedResult } : {}),
    };
  });

  const separateSheets = components.reduce((sum, c) => sum + c.sheetsNeeded, 0);

  // Combination nesting only makes sense when every component fits the sheet;
  // if any is Infinity, keep the separate (Infinity) total so the caller errors.
  if (!combine || !Number.isFinite(separateSheets)) {
    return { sheet, quantity, components, totalSheets: separateSheets };
  }

  const combination = computeCombination(
    blanks,
    quantity,
    sheet,
    components.map((c) => c.sheetsNeeded),
    separateSheets,
    consolidateTies,
  );
  const totalSheets = combination.applied
    ? combination.combinedSheets
    : separateSheets;

  return { sheet, quantity, components, totalSheets, combination };
}

// ===========================================================================
// Paper wrapping (Option 1 = printed, Option 2 = special paper)
// Paper blanks are derived from the BOARD blanks, then nested on a paper sheet
// exactly like board. Per the client doc (v2):
//   outer = board keyline + foldingAllowance each side  (default 20 mm)
//   inner = board keyline EXACTLY                        (reduction default 0)
// ===========================================================================

const MM_PER_INCH = 25.4;
const DEFAULT_FOLDING_ALLOWANCE_MM = 20;
// Client doc v2: inner lining = board keyline EXACTLY (no reduction). Kept as a
// parameter (default 0) only so a future estimate could tweak it if needed.
const DEFAULT_LINING_REDUCTION_MM = 0;

export function mmToIn(mm: number): number {
  return mm / MM_PER_INCH;
}

/** Outer printed/special paper blank = board blank grown by `folding` each side. */
export function outerPaperBlank(
  boardBlank: Blank,
  foldingAllowance_mm: number = DEFAULT_FOLDING_ALLOWANCE_MM,
): Blank {
  const grow = 2 * mmToIn(foldingAllowance_mm); // both sides
  return {
    ...boardBlank,
    width_in: boardBlank.width_in + grow,
    height_in: boardBlank.height_in + grow,
  };
}

/** Inner lining paper blank = board blank shrunk by `reduction` each side. */
export function innerLiningBlank(
  boardBlank: Blank,
  liningReduction_mm: number = DEFAULT_LINING_REDUCTION_MM,
): Blank {
  const shrink = 2 * mmToIn(liningReduction_mm); // both sides
  return {
    ...boardBlank,
    width_in: boardBlank.width_in - shrink,
    height_in: boardBlank.height_in - shrink,
  };
}

/**
 * Inflate sheet counts by a wastage % for printed paper (client review
 * 2026-06: +10% print only, +15% print + foiling/UV). Infinity (blank
 * doesn't fit) is left untouched.
 *
 * A CombinedGroup is one shared physical sheet run for ALL its members, so
 * its sheetsNeeded is inflated once per group, not once per member — still-
 * separate components keep the old per-component inflation. When there's no
 * combination (est.combination is undefined — board's own call never wastage-
 * inflates, so this only happens for paper), this reduces to the previous
 * flat re-sum. When combination exists but didn't apply, groups=[] and
 * separateComponents=every component, so combinedSheets falls out equal to
 * separateSheets automatically — no separate branch needed.
 *
 * Never-worse-than-separate survives this rounding: the winning partition's
 * groups are each already <= their members' summed separate counts (else
 * splitting that group would have beaten the winning partition in
 * computeCombination's own exhaustive search), and ceil(sum(x*f)) <=
 * sum(ceil(x*f)) for x >= 0 — so the guarantee holds after independent
 * per-group rounding too. (The partition itself is still chosen on
 * pre-wastage counts; a different partition could in principle be marginally
 * better post-rounding, but that's not worth re-running the search over.)
 */
function applyWastage(est: MaterialEstimate, wastagePct: number): MaterialEstimate {
  if (wastagePct <= 0) return est;
  const factor = 1 + wastagePct / 100;
  const inflate = (n: number) => (Number.isFinite(n) ? Math.ceil(n * factor) : n);

  const components = est.components.map((c) => ({ ...c, sheetsNeeded: inflate(c.sheetsNeeded) }));
  const separateSheets = components.reduce((s, c) => s + c.sheetsNeeded, 0);

  if (!est.combination) {
    return {
      ...est,
      components,
      totalSheets: separateSheets,
      preWastageSheets: est.totalSheets,
    };
  }

  const byName = new Map(components.map((c) => [c.component, c.sheetsNeeded]));
  const groups = est.combination.groups.map((g) => ({ ...g, sheetsNeeded: inflate(g.sheetsNeeded) }));
  const combinedSheets =
    groups.reduce((s, g) => s + g.sheetsNeeded, 0) +
    est.combination.separateComponents.reduce((s, name) => s + (byName.get(name) ?? 0), 0);

  return {
    ...est,
    components,
    totalSheets: combinedSheets,
    preWastageSheets: est.totalSheets,
    combination: { ...est.combination, separateSheets, combinedSheets, groups },
  };
}

/**
 * The print JOBS of one wrap layer, as sheet counts — one job per shared-sheet
 * combination group plus one per component still cut alone; without an applied
 * combination, one per component. Each job is one design/plate in the real
 * process. Grouped members are read ONLY via `groups[]` (a component's own
 * `sheetsNeeded` keeps its cut-alone count); leftovers resolve strictly by
 * name through `separateComponents` — the same rule applyWastage uses, so
 * Σ layerPrintJobs === layer.totalSheets always holds.
 *
 * Lives here (not in cost.ts, which re-exports it) because it reads nothing but
 * a MaterialEstimate, and the cost-free raw-material PDF needs the job split
 * without importing the cost engine.
 */
export function layerPrintJobs(layer: MaterialEstimate): number[] {
  const combo = layer.combination;
  if (combo?.applied) {
    const byName = new Map(layer.components.map((c) => [c.component, c.sheetsNeeded]));
    return [
      ...combo.groups.map((g) => g.sheetsNeeded),
      ...combo.separateComponents.map((name) => byName.get(name) ?? 0),
    ];
  }
  return layer.components.map((c) => c.sheetsNeeded);
}

/**
 * How one print job's sheets divide into offset billing blocks: the first 1000
 * (the plate) and whatever runs of 1000 follow. Pure sheet arithmetic — no
 * rates — so the cost-free materials sheet can state the run without a price.
 */
export function printTierSheets(sheets: number): {
  first: number;
  additional: number;
  runs: number;
} {
  if (!Number.isFinite(sheets) || sheets <= 0) return { first: 0, additional: 0, runs: 0 };
  const first = Math.min(sheets, 1000);
  const additional = Math.max(0, sheets - 1000);
  return { first, additional, runs: Math.ceil(additional / 1000) };
}

/**
 * Sheets in the print job ONE component belongs to — its shared-sheet
 * combination group's total when it is cut with others, else its own count.
 * Same resolution rule as layerPrintJobs, viewed from a single component.
 */
export function printJobFor(layer: MaterialEstimate, component: string): number {
  const combo = layer.combination;
  if (combo?.applied) {
    const group = combo.groups.find((g) => g.components.includes(component));
    if (group) return group.sheetsNeeded;
  }
  return layer.components.find((c) => c.component === component)?.sheetsNeeded ?? 0;
}

/**
 * Split a wrap layer into groups of identically-wrapped components and nest
 * each group on its own stock (client final doc item 2).
 *
 * Grouping key is the resolved config itself (sheet, print sheet, allowance,
 * wastage), so two components configured the same way still share sheets and
 * one print job — only genuinely different wraps become separate plates and
 * purchases. Component ORDER is preserved, and with no per-component overrides
 * there is exactly one group holding every blank, which reproduces the
 * pre-round-7 single call byte for byte.
 *
 * Returns undefined when the layer isn't used at all.
 */
function wrapLayerGroups(
  blanks: Blank[],
  quantity: number,
  layer: "outer" | "inner",
  shared: OuterPaperInput | InnerPaperInput | undefined,
  byComponent: Record<string, OuterPaperInput | InnerPaperInput> | undefined,
  overrides: OrientationOverrides,
  combine: boolean,
  mixed: boolean,
  consolidateTies: boolean,
): WrapGroupEstimate[] | undefined {
  // Each component's effective config; a component with neither an override
  // nor a shared wrap simply isn't wrapped in this layer.
  const resolved = blanks.map((b) => ({
    blank: b,
    cfg: byComponent?.[b.component] ?? shared,
  }));
  const wrapped = resolved.filter((r) => r.cfg != null);
  if (wrapped.length === 0) return undefined;

  // Stable grouping by config identity, first-seen order.
  const order: string[] = [];
  const buckets = new Map<string, { cfg: OuterPaperInput | InnerPaperInput; blanks: Blank[] }>();
  for (const { blank, cfg } of wrapped) {
    const key = JSON.stringify(cfg);
    if (!buckets.has(key)) {
      buckets.set(key, { cfg: cfg!, blanks: [] });
      order.push(key);
    }
    buckets.get(key)!.blanks.push(blank);
  }

  return order.map((key) => {
    const { cfg, blanks: groupBlanks } = buckets.get(key)!;
    const allowance =
      layer === "outer"
        ? (cfg as OuterPaperInput).foldingAllowance_mm
        : (cfg as InnerPaperInput).liningReduction_mm;
    const material = estimatePaperMaterial(
      groupBlanks,
      quantity,
      cfg.printSheet ?? cfg.sheet,
      layer,
      allowance,
      overrides,
      cfg.wastagePct ?? 0,
      combine, // combine this group's own components on shared print/paper sheets
      mixed,
      consolidateTies,
    );
    const purchase =
      cfg.printSheet && Number.isFinite(material.totalSheets)
        ? derivePaperPurchase(cfg.printSheet, cfg.sheet, material.totalSheets)
        : undefined;
    return { components: groupBlanks.map((b) => b.component), material, purchase };
  });
}

/**
 * Estimate paper sheets for one wrap layer (outer or inner) of a box.
 * Derives the paper blanks from the board blanks, then runs the same nesting.
 * `wastagePct` (printed paper, outer or inner) inflates the sheet count for
 * wastage. `combine` attempts combination nesting across this LAYER's own
 * components (e.g. tray-wrap + lid-wrap share one outer-wrap print job
 * already) — never across layers, since outer/inner/foam-cover can each
 * carry independent paper stock/GSM/print settings.
 */
export function estimatePaperMaterial(
  boardBlanks: Blank[],
  quantity: number,
  paperSheet: Sheet,
  layer: "outer" | "inner",
  allowance_mm?: number,
  overrides: OrientationOverrides = {},
  wastagePct = 0,
  combine = false,
  mixed = false,
  consolidateTies = false,
): MaterialEstimate {
  const paperBlanks = boardBlanks.map((b) =>
    layer === "outer"
      ? outerPaperBlank(b, allowance_mm)
      : innerLiningBlank(b, allowance_mm),
  );
  const est = estimateBoardMaterial(
    paperBlanks,
    quantity,
    paperSheet,
    overrides,
    combine,
    mixed,
    consolidateTies,
  );
  return applyWastage(est, wastagePct);
}

// ===========================================================================
// Foam inserts
// Pieces of the box's foam insert (footprint L x W) cut from a foam sheet,
// taking the better of the two orientations — same nesting math as everything
// else. Doc: foamL/L x foamW/W  OR  foamL/W x foamW/L (whichever yields more).
// ===========================================================================

/**
 * Cover input for one foam insert (client 2-Jul): paper/card pieces cut to the
 * foam footprint, glued on top and/or under it (piecesPerBox = 1–2). Follows
 * the same layout/formula as the outer/inner wrap: pieces nest on the PRINT
 * area when printed (paper purchase derived by nesting the print size onto the
 * stock sheet), with wastage sheets added to the printed run.
 *
 * NOT combination-nested across multiple foam inserts (unlike outer/inner
 * wrap paper, see estimatePaperMaterial's `combine`), and deliberately so:
 * each insert's cover is configured independently (material/size/GSM/print
 * can all differ per insert, per FoamCoverSelection), so there's no single
 * shared print job to combine within like a wrap layer has. Combining would
 * need new "only group covers with matching config" logic, not a reuse of
 * computeCombination — deferred, not an oversight.
 */
export interface FoamCoverInput {
  piecesPerBox: number;
  sheet: Sheet; // stock sheet of the cover material (paper / art card / special)
  printSheet?: Sheet; // when printed: pieces nest on this; paper bought to fit it
  wastagePct?: number; // extra printed sheets (client rule; 0 when not printed)
}

/**
 * A mixed-orientation packing: the piece count plus where every piece sits.
 * Structurally the same shape `BlankMaterialResult.mixed` carries for board and
 * wrap components — free pieces (foam, foam cover, window film) use it too, so
 * every nesting surface in the app can draw the same "N rotated" layout.
 */
export interface MixedLayout {
  perSheet: number;
  layout: PrintLayoutRect[];
}

/**
 * Mixed-orientation upgrade for a FREE piece — foam, a foam cover, window film
 * (client 13-Jul, extended to these surfaces on 21-Jul: "the same logic applies
 * anywhere we do a visual nesting"). Keeps the pure grid unless the packed
 * layout is STRICTLY better; both pure grids are candidates inside
 * packPiecesOnSheet, so the count can never drop. Disabled (returns the grid
 * untouched) when the estimate didn't opt in, or the user pinned an
 * orientation — identical to the rule estimateBoardMaterial follows.
 */
function mixedPieceUpgrade(
  piece: { length_in: number; width_in: number },
  sheet: Sheet,
  chosen: Orientation,
  perSheet: number,
  enabled: boolean,
): { chosen: Orientation; perSheet: number; mixed?: MixedLayout } {
  if (!enabled) return { chosen, perSheet };
  // Piece length runs along the sheet width in orientation A — the same
  // convention nestBlank uses, so the two counts are directly comparable.
  const packed = packPiecesOnSheet(
    { width_in: piece.length_in, height_in: piece.width_in },
    sheet,
  );
  if (packed.count <= perSheet) return { chosen, perSheet };
  return {
    chosen: packed.chosen,
    perSheet: packed.count,
    mixed: { perSheet: packed.count, layout: packed.layout },
  };
}

export interface FoamCoverEstimate {
  sheet: Sheet; // the sheet pieces were nested on (print area when printed)
  piecesPerBox: number;
  piecesPerSheet: number;
  chosen: Orientation;
  /** Present when a mixed-orientation layout beat both pure grids. */
  mixed?: MixedLayout;
  sheetsNeeded: number; // sheets through nesting (incl. wastage % when printed)
  /** Present when printing drives the paper size (printSheet given). */
  purchase?: PaperPurchase;
}

export interface FoamEstimate {
  insertFootprint: { length_in: number; width_in: number };
  /**
   * The piece as actually nested on the foam sheet — the footprint grown by
   * the punching margin on every side. Equals the footprint when no margin.
   * The nesting diagram must draw THIS, not the footprint, so the grid always
   * matches piecesPerSheet.
   */
  nestedBlank: { length_in: number; width_in: number };
  foamSheet: Sheet;
  piecesPerSheet: number;
  chosen: Orientation;
  /** Present when a mixed-orientation layout beat both pure grids. */
  mixed?: MixedLayout;
  quantity: number;
  sheetsNeeded: number;
  /** Present when the foam has a top/bottom cover. */
  cover?: FoamCoverEstimate;
}

export function estimateFoam(
  insert: { length_in: number; width_in: number },
  foamSheet: Sheet,
  quantity: number,
  override?: Orientation,
  cover?: FoamCoverInput,
  punchingMargin_mm = 0,
  mixed = false,
): FoamEstimate {
  // Punching margin (client 7-Jul): the die-punch needs clearance, so each
  // piece occupies (L + 2×margin) × (W + 2×margin) on the sheet. The cover
  // below still nests the RAW footprint — it wraps the finished foam piece.
  const marginIn = punchingMargin_mm > 0 ? punchingMargin_mm / 25.4 : 0;
  const nestedBlank = {
    length_in: insert.length_in + 2 * marginIn,
    width_in: insert.width_in + 2 * marginIn,
  };
  const o = nestBlank(
    { width_in: nestedBlank.length_in, height_in: nestedBlank.width_in },
    foamSheet,
  );
  // A pinned orientation keeps the pure grid (mixedPieceUpgrade is disabled),
  // exactly as a component-level override does for board and wrap layers.
  const up = mixedPieceUpgrade(
    nestedBlank,
    foamSheet,
    override ?? o.recommended,
    (override ?? o.recommended) === "A" ? o.perSheetA : o.perSheetB,
    mixed && override == null,
  );
  const { chosen, perSheet: piecesPerSheet } = up;
  const sheetsNeeded =
    piecesPerSheet > 0 ? Math.ceil(quantity / piecesPerSheet) : Infinity;

  let coverEst: FoamCoverEstimate | undefined;
  if (cover && cover.piecesPerBox > 0) {
    const nestSheet = cover.printSheet ?? cover.sheet;
    const co = nestBlank(
      { width_in: insert.length_in, height_in: insert.width_in },
      nestSheet,
    );
    // Covers are never orientation-overridden (no per-cover control), so the
    // mixed upgrade rides purely on the estimate's opt-in.
    const coverUp = mixedPieceUpgrade(
      insert,
      nestSheet,
      co.recommended,
      co.recommended === "A" ? co.perSheetA : co.perSheetB,
      mixed,
    );
    const coverChosen = coverUp.chosen;
    const coverPerSheet = coverUp.perSheet;
    let coverSheets =
      coverPerSheet > 0
        ? Math.ceil((quantity * cover.piecesPerBox) / coverPerSheet)
        : Infinity;
    if (Number.isFinite(coverSheets) && (cover.wastagePct ?? 0) > 0) {
      coverSheets = Math.ceil(coverSheets * (1 + cover.wastagePct! / 100));
    }
    coverEst = {
      sheet: nestSheet,
      piecesPerBox: cover.piecesPerBox,
      piecesPerSheet: coverPerSheet,
      chosen: coverChosen,
      ...(coverUp.mixed ? { mixed: coverUp.mixed } : {}),
      sheetsNeeded: coverSheets,
      purchase:
        cover.printSheet && Number.isFinite(coverSheets)
          ? derivePaperPurchase(cover.printSheet, cover.sheet, coverSheets)
          : undefined,
    };
  }

  return {
    insertFootprint: insert,
    nestedBlank,
    foamSheet,
    piecesPerSheet,
    chosen,
    ...(up.mixed ? { mixed: up.mixed } : {}),
    quantity,
    sheetsNeeded,
    cover: coverEst,
  };
}

// ===========================================================================
// Window film insert (doc 2026-06-19)
// A transparent window cut into the box, backed by film (PVC/PET). One window
// per box; the film is nested on a film sheet exactly like foam — the better of
// the two orientations. Doc: sheetL/winL x sheetW/winW OR swapped.
// ===========================================================================

export interface WindowEstimate {
  windowFootprint: { length_in: number; width_in: number };
  /** The piece actually nested = footprint + punching margin each side
   *  (client 13-Jul: "+10 mm on each side"). Equals the footprint when 0. */
  nestedBlank: { length_in: number; width_in: number };
  filmSheet: Sheet;
  piecesPerSheet: number;
  chosen: Orientation;
  /** Present when a mixed-orientation layout beat both pure grids. */
  mixed?: MixedLayout;
  quantity: number;
  sheetsNeeded: number;
}

/**
 * Client final doc item 4C: the window's punching allowance is always +10mm
 * per side, automatically — not a staff-editable input. Shared by
 * build-estimate (which forces it into every request server-side) and the
 * client-side live preview (which has no server round-trip to enforce it).
 */
export const WINDOW_PUNCHING_MARGIN_MM = 10;

export function estimateWindow(
  window: { length_in: number; width_in: number },
  filmSheet: Sheet,
  quantity: number,
  override?: Orientation,
  punchingMargin_mm = 0,
  mixed = false,
): WindowEstimate {
  // Punching margin per SIDE (foam-insert pattern): the die needs clearance, so
  // the film piece cut is larger than the window itself. Legacy (0) = footprint.
  const marginIn = mmToIn(punchingMargin_mm);
  const nestedBlank = {
    length_in: window.length_in + 2 * marginIn,
    width_in: window.width_in + 2 * marginIn,
  };
  const o = nestBlank(
    { width_in: nestedBlank.length_in, height_in: nestedBlank.width_in },
    filmSheet,
  );
  const up = mixedPieceUpgrade(
    nestedBlank,
    filmSheet,
    override ?? o.recommended,
    (override ?? o.recommended) === "A" ? o.perSheetA : o.perSheetB,
    mixed && override == null,
  );
  const { chosen, perSheet: piecesPerSheet } = up;
  const sheetsNeeded =
    piecesPerSheet > 0 ? Math.ceil(quantity / piecesPerSheet) : Infinity;

  return {
    windowFootprint: window,
    nestedBlank,
    filmSheet,
    piecesPerSheet,
    chosen,
    ...(up.mixed ? { mixed: up.mixed } : {}),
    quantity,
    sheetsNeeded,
  };
}

// ===========================================================================
// Reverse-board insert
// Client doc v2: "same as rigid box tray" — the insert keyline uses the tray
// formula with the INSERT height Hi: (Hi+L+Hi) x (Hi+W+Hi), nested on reverse-
// board stock. Optional top paper uses that same keyline EXACTLY (no folding).
// ===========================================================================

export interface ReverseBoardEstimate {
  keyline: Blank;
  board: MaterialEstimate;
  topPaper?: MaterialEstimate;
}

export function estimateReverseBoard(
  dims: { length_in: number; width_in: number },
  insertHeight_in: number,
  quantity: number,
  boardSheet: Sheet,
  topPaperSheet?: Sheet,
  overrides: OrientationOverrides = {},
  mixed = false,
): ReverseBoardEstimate {
  const Hi = insertHeight_in;
  const keyline: Blank = {
    component: "reverse_board",
    width_in: Hi + dims.length_in + Hi,
    height_in: Hi + dims.width_in + Hi,
    count_per_box: 1,
  };

  const board = estimateBoardMaterial([keyline], quantity, boardSheet, overrides, false, mixed);

  // Top paper = keyline exactly (no folding) -> inner layer with 0 reduction.
  const topPaper = topPaperSheet
    ? estimatePaperMaterial(
        [keyline],
        quantity,
        topPaperSheet,
        "inner",
        0,
        overrides,
        0,
        false,
        mixed,
      )
    : undefined;

  return { keyline, board, topPaper };
}

// ===========================================================================
// Card-stock inserts (round 5, client 13-Jul): beading, card partitions,
// custom card partition — and the sleeve add-on's paper wrap. Each cuts pieces
// from a paper/card/special stock, optionally printed (pieces nest on the
// PRINT size; paper purchase derived by nesting the print onto the stock sheet
// — the outer/inner-wrap model exactly), with printed wastage % applied.
// ===========================================================================

/** Stock a card insert's pieces are cut from (print size when printed). */
export interface CardStockInput {
  sheet: Sheet;
  printSheet?: Sheet;
  wastagePct?: number;
}

/** Nesting result of one card-stock insert (or the sleeve's paper wrap). */
export interface CardInsertEstimate {
  blanks: Blank[];
  paper: MaterialEstimate;
  /** Present when printed (printSheet given) — stock sheets actually bought. */
  purchase?: PaperPurchase;
}

/**
 * Nest a card insert's blanks on its stock. Multiple piece types (the two
 * partition directions) may share sheets — they carry the same print job, the
 * same reason the wrap layers combine. Mixed follows the estimate's gate.
 */
export function estimateCardInsert(
  blanks: Blank[],
  quantity: number,
  stock: CardStockInput,
  mixed = false,
): CardInsertEstimate {
  const nestSheet = stock.printSheet ?? stock.sheet;
  const est = applyWastage(
    estimateBoardMaterial(blanks, quantity, nestSheet, {}, blanks.length > 1, mixed),
    stock.wastagePct ?? 0,
  );
  const purchase =
    stock.printSheet && Number.isFinite(est.totalSheets)
      ? derivePaperPurchase(stock.printSheet, stock.sheet, est.totalSheets)
      : undefined;
  return { blanks, paper: est, purchase };
}

// The sleeve insert (round 6, client 15-Jul meeting): "not kappa board — only
// paper and art card". The round-5 board-plus-wrap model is REPLACED by a
// single card-stock cut: the sleeve blank (box type's own sleeve formula) is
// cut directly from paper / board stock / special paper via estimateCardInsert
// — keyline exact, no folding allowance. Round 5 never shipped, so no saved
// snapshot carries the old shape.

// ===========================================================================
// Accessory counts (priced later by Engine 2)
// Auto-trigger rules by box type (CLAUDE.md "Auto-triggered Costs by Box Type"):
//   magnets + washers + metlock: magnetic, double_decker, collapsible_rigid
//   metlock only:                hinge_lid, shoulder
//   ribbon tag:                  drawer_sliding, double_decker (1 per box)
//   tape:                        per tray AND lid component (0.75 Rs each in E2)
//   washers:                     always 1:1 with magnets
// magnetsPerBox is a client-specified input. Glue + metlock are NOT counted
// here — they are manual open-input costs entered straight into Engine 2; the
// metlock auto-trigger flag is still exposed so the form knows to prompt.
// ===========================================================================

interface AutoTrigger {
  magnets: boolean;
  metlock: boolean;
  ribbonTag: boolean;
}

const AUTO_TRIGGER: Record<BoxType, AutoTrigger> = {
  telescopic: { magnets: false, metlock: false, ribbonTag: false },
  magnetic: { magnets: true, metlock: true, ribbonTag: false },
  shoulder: { magnets: false, metlock: true, ribbonTag: false },
  drawer_sliding: { magnets: false, metlock: false, ribbonTag: true },
  matchbox_sliding: { magnets: false, metlock: false, ribbonTag: false },
  hinge_lid: { magnets: false, metlock: true, ribbonTag: false },
  collapsible_rigid: { magnets: true, metlock: true, ribbonTag: false },
  double_decker: { magnets: true, metlock: true, ribbonTag: true },
  tray_only: { magnets: false, metlock: false, ribbonTag: false },
};

export interface AccessoryInput {
  magnetsPerBox?: number; // required when the box auto-includes magnets
}

export interface AccessoryCounts {
  magnets: number;
  washers: number; // always equals magnets
  tape: number; // one per tray AND lid component, per box
  ribbonTag: number; // 1 per box when the box auto-includes a ribbon tag
  /** Auto-trigger flags so the form/Engine 2 can prompt for required inputs. */
  autoTrigger: AutoTrigger;
}

/** Tape units = number of components that are a tray or a lid. */
function trayLidComponentCount(blanks: Blank[]): number {
  return blanks.filter((b) => {
    const name = b.component.toLowerCase();
    return name.includes("tray") || name.includes("lid");
  }).length;
}

export function estimateAccessories(
  boxType: BoxType,
  blanks: Blank[],
  quantity: number,
  input: AccessoryInput = {},
): AccessoryCounts {
  const autoTrigger = AUTO_TRIGGER[boxType];

  const magnetsPerBox = autoTrigger.magnets ? (input.magnetsPerBox ?? 0) : 0;
  const tapePerBox = trayLidComponentCount(blanks);
  const ribbonTagPerBox = autoTrigger.ribbonTag ? 1 : 0;

  return {
    magnets: magnetsPerBox * quantity,
    washers: magnetsPerBox * quantity, // 1:1 with magnets
    tape: tapePerBox * quantity,
    ribbonTag: ribbonTagPerBox * quantity,
    autoTrigger,
  };
}

// ===========================================================================
// Engine 1 entry point — one call, all material quantities for one box.
// Computes the blanks from the box-type formula, then board + (optional) paper
// wrapping/lining + (optional) foam + accessory counts. Pure: every sheet size,
// allowance, and per-box accessory count is passed in (Phase 4 loads them from
// the DB). Output feeds Engine 2 (cost).
// ===========================================================================

/** One wrap layer's stock + print configuration. */
export interface OuterPaperInput {
  sheet: Sheet;
  foldingAllowance_mm?: number;
  wastagePct?: number;
  printSheet?: Sheet;
}
export interface InnerPaperInput {
  sheet: Sheet;
  liningReduction_mm?: number;
  wastagePct?: number;
  printSheet?: Sheet;
}

export interface MaterialInput {
  boxType: BoxType;
  dims: BoxDimensions;
  vars?: BoxVariables;
  quantity: number;
  board: { sheet: Sheet };
  /**
   * Outer wrap (Option 1 printed or Option 2 special). Omit if no outer wrap.
   * `printSheet` (client doc: "printing size determines what paper size we use"):
   * when given, blanks are nested on the PRINT area (not the full paper sheet) and
   * paper purchase is derived by nesting the print size onto the paper sheet.
   */
  outerPaper?: OuterPaperInput;
  /** Inner lining. Omit if the box has no inner lining. `printSheet` as for outer.
   *  `wastagePct` (printed inner only — client 2026-07: same +10/15% rule as outer). */
  innerPaper?: InnerPaperInput;
  /**
   * Per-component wrap overrides (client final doc item 2), keyed by component
   * name. A listed component is wrapped with ITS config instead of the shared
   * `outerPaper` / `innerPaper` above. Components resolving to an identical
   * config still nest together and share one print job; differing configs are
   * genuinely separate sheets, purchases and plates. Absent = one wrap for the
   * whole box, which is byte-identical to the pre-round-7 engine.
   */
  outerPaperByComponent?: Record<string, OuterPaperInput>;
  innerPaperByComponent?: Record<string, InnerPaperInput>;
  /** Foam inserts (client 2-Jul: several per estimate), each with its own foam
   *  sheet and optional top/bottom cover. Omit / empty if no foam. */
  foams?: {
    insert: { length_in: number; width_in: number };
    sheet: Sheet;
    /** Punching margin (client 7-Jul): extra mm per SIDE around the foam piece when nesting. */
    punchingMargin_mm?: number;
    cover?: FoamCoverInput;
  }[];
  /** Reverse-board insert: insert height + reverse-board stock + optional top paper. */
  reverseBoard?: {
    insertHeight_in: number;
    boardSheet: Sheet;
    topPaperSheet?: Sheet;
  };
  /** Window film: window footprint + film sheet. Omit if no window.
   *  `punchingMargin_mm` (client 13-Jul: "+10 mm on each side, editable") grows
   *  the nested piece per side; the footprint itself stays the entered window
   *  size. Absent = 0 = legacy behaviour. */
  window?: {
    footprint: { length_in: number; width_in: number };
    sheet: Sheet;
    punchingMargin_mm?: number;
  };
  /** Sleeve insert (round 6): the sleeve blank cut from paper/card stock —
   *  no board component (client: "only paper and art card"). */
  sleeve?: { blank: Blank; stock: CardStockInput };
  /** Beading insert (round 5): blank pre-computed from BH/BT + box dims. */
  beading?: { blank: Blank; stock: CardStockInput };
  /** Card partitions (round 5): the L/W partition blanks (with counts). */
  cardPartitions?: { blanks: Blank[]; stock: CardStockInput };
  /** Custom card partition (round 5): explicit blank × count. */
  customPartition?: { blank: Blank; stock: CardStockInput };
  /** Manual add-on counts per box (doc 2026-06-19; priced in Engine 2). */
  handlesPerBox?: number;
  locksPerBox?: number;
  accessories?: AccessoryInput;
  overrides?: OrientationOverrides;
  /**
   * Board-cutting method (client 7-Jul asked to control it, not just auto):
   * `true`/undefined = allow combination nesting (cut different parts on one
   * sheet, kept only when it needs fewer sheets — never worse than separate);
   * `false` = force every component onto its own sheets. Applies to board and
   * each wrap layer alike.
   */
  combine?: boolean;
  /**
   * Mixed-orientation nesting (client 13-Jul): allow a per-component layout of
   * a main grid plus rotated pieces in the leftover strips. Opt-in — requests
   * at nestingVersion >= 2 pass true; absent keeps the pure-grid model so
   * saved snapshots recompute exactly as costed.
   */
  mixed?: boolean;
  /**
   * Mixed-orientation nesting for FREE PIECES — foam, foam covers, window film
   * (client 21-Jul: "the same logic applies anywhere we do a visual nesting").
   * A SEPARATE gate from `mixed` on purpose: round-5/6 estimates were costed
   * with `mixed` on but their foam/window still nested as pure grids, so
   * reusing that flag would silently re-cut an already-quoted estimate. Opt-in
   * at nestingVersion >= 3; older snapshots keep the pure grid they paid for.
   */
  mixedPieces?: boolean;
  /**
   * Inner-lining blank model (round 10, client 5-Aug). >= 2 runs each box
   * type's lining formula (lib/formulas/inner-lining.ts) instead of lining
   * every component across its full board keyline — a magnetic case is only
   * lined across flap + one panel + spine, because the tray is glued over the
   * other panel. Absent / 1 = line the full keyline, exactly the pre-round-10
   * model, so saved snapshots recompute byte-identically.
   */
  liningVersion?: number;
  /**
   * Print-job layout (client 13-Jul "combined printing"): "separate" = every
   * component is its own print job / plate, so wrap layers never share sheets
   * across components (Engine 2 also charges the offset minimum per component).
   * Absent / "combined" = today's behaviour. Board cutting is unaffected —
   * this is a printing concern and board carries no print.
   */
  printingMode?: "combined" | "separate";
}

/** Manual customisation add-ons: handle/lock totals + the window film estimate. */
export interface AddonCounts {
  handles: number; // total handles = handlesPerBox x quantity
  locks: number; // total locks = locksPerBox x quantity
  window?: WindowEstimate;
}

/**
 * Paper purchase derived from a print-size-driven wrap (client doc: "printing
 * size determines what paper size we will use"). The blanks nest on the PRINT
 * area; the print size itself nests on the stock paper sheet (e.g. two 18x25
 * prints cut from one 25x36 sheet), giving the sheets actually bought.
 */
/** One print placed on a stock paper sheet (for the purchase-layout diagram). */
export interface PrintLayoutRect {
  x_in: number;
  y_in: number;
  w_in: number; // oriented width on the sheet
  h_in: number; // oriented height on the sheet
  orientation: Orientation; // "A" = print as-is, "B" = rotated 90°
}

export interface PaperPurchase {
  printSheet: Sheet; // the printed area blanks were nested on
  paperSheet: Sheet; // the stock sheet purchased
  printsPerSheet: number; // print-size pieces cut per paper sheet (mixed orientation)
  chosen: Orientation; // main-grid orientation of the winning layout
  printedSheets: number; // sheets through the press (incl. wastage %)
  sheetsToBuy: number; // ceil(printedSheets / printsPerSheet)
  // How those prints sit on one paper sheet (main grid + any rotated extras
  // recovered from the leftover strip — client 7-Jul "1 more if flipped").
  layout: PrintLayoutRect[];
}

/**
 * One wrap group (client final doc item 2): the components sharing an
 * identical wrap config, nested together on their own stock. There is exactly
 * ONE group per layer unless the estimate carries per-component overrides —
 * and in that single-group case `outerPaper`/`outerPaperPurchase` below still
 * point at it, so every existing consumer keeps working unchanged.
 */
export interface WrapGroupEstimate {
  /** Component names in this group, in blank order. */
  components: string[];
  material: MaterialEstimate;
  /** Present when printing drives the paper size (printSheet given). */
  purchase?: PaperPurchase;
}

/**
 * A wrap layer's groups, with the pre-round-7 fallback: estimates saved before
 * per-component wrapping carry only `outerPaper`/`innerPaper`, which is one
 * implicit group covering every component. Use this everywhere a layer is
 * displayed or costed so both shapes read the same.
 */
export function wrapGroupsOf(
  mat: MaterialQuantities,
  layer: "outer" | "inner",
): WrapGroupEstimate[] {
  if (layer === "outer") {
    if (mat.outerPaperGroups) return mat.outerPaperGroups;
    return mat.outerPaper
      ? [{ components: [], material: mat.outerPaper, purchase: mat.outerPaperPurchase }]
      : [];
  }
  if (mat.innerPaperGroups) return mat.innerPaperGroups;
  return mat.innerPaper
    ? [{ components: [], material: mat.innerPaper, purchase: mat.innerPaperPurchase }]
    : [];
}

export interface MaterialQuantities {
  boxType: BoxType;
  quantity: number;
  blanks: Blank[];
  board: MaterialEstimate;
  /** The single/shared outer wrap. When per-component wraps split the layer
   *  into several groups this is the FIRST group; read `outerPaperGroups` for
   *  the full picture. */
  outerPaper?: MaterialEstimate;
  /** Present when outer printing drives the paper size (printSheet given). */
  outerPaperPurchase?: PaperPurchase;
  /** Every outer wrap group (one unless per-component wraps differ). */
  outerPaperGroups?: WrapGroupEstimate[];
  innerPaper?: MaterialEstimate;
  /** Present when inner printing drives the paper size (printSheet given). */
  innerPaperPurchase?: PaperPurchase;
  /** Every inner wrap group (one unless per-component wraps differ). */
  innerPaperGroups?: WrapGroupEstimate[];
  foams?: FoamEstimate[];
  reverseBoard?: ReverseBoardEstimate;
  /** Round-5 inserts (client 13-Jul). */
  sleeve?: CardInsertEstimate;
  beading?: CardInsertEstimate;
  cardPartitions?: CardInsertEstimate;
  customPartition?: CardInsertEstimate;
  addons: AddonCounts;
  accessories: AccessoryCounts;
}

/**
 * Uniform best-of-two-orientations grid of a `tileW x tileH` print inside a
 * `W x H` sub-rectangle, offset to (x0, y0). Returns the placed prints (empty
 * when nothing fits). Used to fill the leftover strips left by the main grid.
 */
function fillPrintGrid(
  x0: number,
  y0: number,
  W: number,
  H: number,
  tileW: number,
  tileH: number,
): PrintLayoutRect[] {
  if (W <= 0 || H <= 0) return [];
  const countA = Math.floor(W / tileW) * Math.floor(H / tileH);
  const countB = Math.floor(W / tileH) * Math.floor(H / tileW);
  const useA = countA >= countB;
  const w = useA ? tileW : tileH;
  const h = useA ? tileH : tileW;
  const cols = Math.floor(W / w);
  const rows = Math.floor(H / h);
  const rects: PrintLayoutRect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rects.push({
        x_in: x0 + c * w,
        y_in: y0 + r * h,
        w_in: w,
        h_in: h,
        orientation: useA ? "A" : "B",
      });
    }
  }
  return rects;
}

/**
 * Max pieces of `piece` (rotation allowed) cut from one `sheet` via a
 * one-level guillotine: a main uniform grid, then the leftover right-strip and
 * bottom-strip filled with pieces in their best orientation — recovering the
 * "one more fits if you flip it to landscape" the client asked for (7-Jul for
 * prints-on-paper; 13-Jul generalised to component blanks — mixed nesting).
 * Tries both main orientations and both guillotine split directions and keeps
 * the best; the pure uniform grids are always among the candidates, so this is
 * GUARANTEED never worse than nestBlank's plain best-of-two count.
 */
export function packPiecesOnSheet(
  printSheet: Sheet,
  paperSheet: Sheet,
): { count: number; chosen: Orientation; layout: PrintLayoutRect[] } {
  const BW = paperSheet.width_in;
  const BH = paperSheet.height_in;
  const pw = printSheet.width_in;
  const ph = printSheet.height_in;

  let best: { count: number; chosen: Orientation; layout: PrintLayoutRect[] } = {
    count: 0,
    chosen: "A",
    layout: [],
  };

  for (const main of ["A", "B"] as const) {
    const mw = main === "A" ? pw : ph;
    const mh = main === "A" ? ph : pw;
    const cols = Math.floor(BW / mw);
    const rows = Math.floor(BH / mh);
    if (cols <= 0 || rows <= 0) continue;

    const mainRects: PrintLayoutRect[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        mainRects.push({ x_in: c * mw, y_in: r * mh, w_in: mw, h_in: mh, orientation: main });
      }
    }
    const usedW = cols * mw;
    const usedH = rows * mh;

    // Split 1: right strip full height + bottom strip under the main block only.
    const split1 = [
      ...mainRects,
      ...fillPrintGrid(usedW, 0, BW - usedW, BH, pw, ph),
      ...fillPrintGrid(0, usedH, usedW, BH - usedH, pw, ph),
    ];
    // Split 2: bottom strip full width + right strip beside the main block only.
    const split2 = [
      ...mainRects,
      ...fillPrintGrid(0, usedH, BW, BH - usedH, pw, ph),
      ...fillPrintGrid(usedW, 0, BW - usedW, usedH, pw, ph),
    ];
    for (const layout of [split1, split2]) {
      if (layout.length > best.count) best = { count: layout.length, chosen: main, layout };
    }
  }
  return best;
}

/** Historical name (print-on-paper purchase path) — same algorithm. */
export const packPrintsOnSheet = packPiecesOnSheet;

/**
 * Nest the print size on the stock paper sheet and derive sheets to buy.
 * Throws when the print size doesn't fit the paper sheet in either orientation
 * (callers validate first with a friendlier message).
 */
export function derivePaperPurchase(
  printSheet: Sheet,
  paperSheet: Sheet,
  printedSheets: number,
): PaperPurchase {
  const packed = packPrintsOnSheet(printSheet, paperSheet);
  const printsPerSheet = packed.count;
  if (printsPerSheet <= 0) {
    throw new Error(
      `print size ${printSheet.width_in}x${printSheet.height_in} does not fit paper sheet ` +
        `${paperSheet.width_in}x${paperSheet.height_in} in either orientation.`,
    );
  }
  return {
    printSheet,
    paperSheet,
    printsPerSheet,
    chosen: packed.chosen,
    printedSheets,
    sheetsToBuy: Math.ceil(printedSheets / printsPerSheet),
    layout: packed.layout,
  };
}

export function estimateMaterials(input: MaterialInput): MaterialQuantities {
  const { boxType, dims, vars = {}, quantity, overrides = {} } = input;

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`quantity must be a positive integer (got ${quantity}).`);
  }

  const blanks = getBlanks(boxType, dims, vars); // throws on missing/invalid vars

  // Default: allow combination (client's real method, never worse than separate).
  // The form can force single-component cutting by passing combine: false.
  const combine = input.combine ?? true;
  const mixed = input.mixed ?? false;
  // Free pieces (foam / cover / window) carry their own gate — see MaterialInput.
  const mixedPieces = input.mixedPieces ?? false;
  // Separate printing (client 13-Jul): each component is its own plate, so the
  // WRAP layers must not share sheets across components. Board still combines.
  const combineWraps = combine && input.printingMode !== "separate";
  // Plate-aware nesting (round 6): when the request carries a printingMode
  // (every new form estimate; no pre-round-5 snapshot does), a printed layer
  // accepts a sheet-TIE combination because one shared layout = one plate.
  // Board and insert estimators never consolidate — strict-win only.
  const consolidateTies = input.printingMode != null;

  const board = estimateBoardMaterial(
    blanks,
    quantity,
    input.board.sheet,
    overrides,
    combine, // combine components on shared board sheets (client's real method)
    mixed,
  );

  // Print-size-driven wraps nest blanks on the PRINT area, then buy paper by
  // nesting the print size onto the stock sheet. Otherwise nest on the paper
  // sheet directly (special paper / no printing) — purchase stays undefined.
  //
  // Per-component wraps (client item 2) split a layer into GROUPS of
  // identically-wrapped components; with no overrides there is exactly one
  // group holding every blank, which reproduces the pre-round-7 call exactly.
  const outerGroups = wrapLayerGroups(
    blanks,
    quantity,
    "outer",
    input.outerPaper,
    input.outerPaperByComponent,
    overrides,
    combineWraps,
    mixed,
    consolidateTies,
  );
  // Inner lining nests the LINING blanks, which for most box types are the
  // board keylines unchanged (identity — same array reference). A magnetic
  // case is the exception: the panel the tray glues over is never seen, so it
  // is not lined (round 10). Gated so pre-round-10 snapshots, which carry no
  // liningVersion, pass `blanks` through untouched.
  const liningBlanks =
    (input.liningVersion ?? 1) >= 2
      ? innerLiningBlanksFor(input.boxType, blanks, input.dims, input.vars ?? {})
      : blanks;
  const innerGroups = wrapLayerGroups(
    liningBlanks,
    quantity,
    "inner",
    input.innerPaper,
    input.innerPaperByComponent,
    overrides,
    combineWraps,
    mixed,
    consolidateTies,
  );
  const outerPaper = outerGroups?.[0]?.material;
  const outerPaperPurchase = outerGroups?.[0]?.purchase;
  const innerPaper = innerGroups?.[0]?.material;
  const innerPaperPurchase = innerGroups?.[0]?.purchase;

  const foams =
    input.foams && input.foams.length > 0
      ? input.foams.map((f) =>
          estimateFoam(f.insert, f.sheet, quantity, undefined, f.cover, f.punchingMargin_mm, mixedPieces),
        )
      : undefined;

  const reverseBoard = input.reverseBoard
    ? estimateReverseBoard(
        dims,
        input.reverseBoard.insertHeight_in,
        quantity,
        input.reverseBoard.boardSheet,
        input.reverseBoard.topPaperSheet,
        overrides,
        mixed,
      )
    : undefined;

  // Round-5 inserts (client 13-Jul): sleeve / beading / card partitions.
  const sleeve = input.sleeve
    ? estimateCardInsert([input.sleeve.blank], quantity, input.sleeve.stock, mixed)
    : undefined;
  const beading = input.beading
    ? estimateCardInsert([input.beading.blank], quantity, input.beading.stock, mixed)
    : undefined;
  const cardPartitions = input.cardPartitions
    ? estimateCardInsert(input.cardPartitions.blanks, quantity, input.cardPartitions.stock, mixed)
    : undefined;
  const customPartition = input.customPartition
    ? estimateCardInsert([input.customPartition.blank], quantity, input.customPartition.stock, mixed)
    : undefined;

  const accessories = estimateAccessories(
    boxType,
    blanks,
    quantity,
    input.accessories,
  );

  // Manual customisation add-ons (handles + locks = counts; window = nested film).
  const addons: AddonCounts = {
    handles: (input.handlesPerBox ?? 0) * quantity,
    locks: (input.locksPerBox ?? 0) * quantity,
    window: input.window
      ? estimateWindow(
          input.window.footprint,
          input.window.sheet,
          quantity,
          undefined,
          input.window.punchingMargin_mm ?? 0,
          mixedPieces,
        )
      : undefined,
  };

  return {
    boxType,
    quantity,
    blanks,
    board,
    outerPaper,
    outerPaperPurchase,
    ...(outerGroups ? { outerPaperGroups: outerGroups } : {}),
    innerPaper,
    innerPaperPurchase,
    ...(innerGroups ? { innerPaperGroups: innerGroups } : {}),
    foams,
    reverseBoard,
    sleeve,
    beading,
    cardPartitions,
    customPartition,
    addons,
    accessories,
  };
}
