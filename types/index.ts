// Shared TypeScript types for the Rigid Box Estimator.
// This file grows as later phases add estimate/rate structures.

// Manual line edits are defined next to the cost lines they edit (Engine 2) and
// re-exported here, since they ride on the estimate REQUEST. Type-only, so this
// adds no runtime dependency on the engine.
import type { CostAdjustment } from "@/lib/engines/cost";
export type { CostAdjustment, AdjustableLine } from "@/lib/engines/cost";

// "trial" = a short-lived lead-evaluation account (see
// supabase/migration-trial-role.sql): isolated to its own clients/estimates/
// quotes/rate-card clone, never visible to another trial user, and never
// visible to real staff/admin's own work (though admin can still see trial
// accounts' data for support).
export type UserRole = "admin" | "staff" | "trial";

// The four markets a trial lead can evaluate from (see
// supabase/migration-multi-currency.sql). Every SHARED rate row is tagged with
// one of these, so a trial's private clone is copied from the template set
// matching the market they picked at first login — real per-market prices, not
// an FX conversion of one base card. Admin/staff are always INR.
export type CurrencyCode = "INR" | "USD" | "GBP" | "AED";

/**
 * The 8 standard box types + tray_only (client 8-Jul: "one more option under
 * box type — only tray"). Each has its own formula in /lib/formulas/.
 */
export type BoxType =
  | "telescopic"
  | "magnetic"
  | "shoulder"
  | "drawer_sliding"
  | "matchbox_sliding"
  | "hinge_lid"
  | "collapsible_rigid"
  | "double_decker"
  | "tray_only";

/** Resolved session info returned by the server-side auth DAL (lib/auth.ts). */
export interface SessionInfo {
  userId: string;
  role: UserRole | null;
  fullName: string | null;
  email: string | null;
  /** role === "trial" only — has this lead dismissed the "review your rates" banner? */
  trialRatesAck: boolean;
  /**
   * role === "trial" only — which market this lead picked at first login.
   * null means they have not picked yet, and therefore have NO rate card at
   * all (cloning is deferred until the choice), so app/(app)/layout.tsx shows
   * them the blocking country picker instead of the app. Always null for
   * admin/staff, whose card is the INR master.
   */
  trialCurrency: CurrencyCode | null;
}

// ===========================================================================
// Geometry & formula contract (Phase 3 engines)
// All dimensions are in INCHES. Internal unit conversions (e.g. mm folding
// allowance -> inches) happen inside functions, never exposed to the user.
// ===========================================================================

/** Internal box dimensions the customer specifies. L x W x H, in inches. */
export interface BoxDimensions {
  length_in: number; // L
  width_in: number; // W
  height_in: number; // H
}

/**
 * Optional per-box-type variables. Each formula reads only the fields it needs
 * and falls back to a default (e.g. lid depth 1.5 in) when a field is absent.
 */
export interface BoxVariables {
  lidDepth_in?: number; // telescopic / shoulder / hinge lid — default 1.5
  neckHeight_in?: number; // shoulder / hinge lid (NH)
  bottomHeight_in?: number; // shoulder / hinge lid (BH)
  flapLength_in?: number; // magnetic / collapsible / double decker
  panels?: 3 | 4 | 5; // magnetic case variant
  flapHeight_in?: number; // magnetic 5-panel
  trayHeight1_in?: number; // double decker (H1)
  trayHeight2_in?: number; // double decker (H2)
  /**
   * Fit allowance (round 6, refined round 7): TOTAL inches added to EACH of L
   * and W on the over-sliding piece — telescopic lid, shoulder lid AND tray,
   * drawer sleeve, matchbox sleeve — so it clears the base's OUTER dims plus
   * slip clearance. = 2 x board thickness + 1 mm, derived by
   * lib/formulas/fit.ts; never typed by the user. Formulas read `L + f`, not
   * `L + 2*f`. Absent = 0 = pre-round-6 behaviour; other box types ignore it.
   */
  fitAllowance_in?: number;
}

/**
 * A single flat board blank (keyline) for one component of a box.
 * width_in x height_in is the unfolded rectangle the formula produces;
 * count_per_box is how many of this piece each finished box needs
 * (usually 1, but e.g. collapsible rigid needs 2 identical tray pieces).
 */
export interface Blank {
  component: string; // e.g. "base", "lid", "neck", "case", "tray"
  width_in: number;
  height_in: number;
  count_per_box: number;
}

/** A box-type formula: dimensions + variables -> the board blanks it needs. */
export type BlankFormula = (dims: BoxDimensions, vars: BoxVariables) => Blank[];

// ===========================================================================
// Estimate request (Phase 4)
// The payload an estimate is computed from — the box specs plus the material,
// finishing, insert, labour and cost selections the form will later submit.
// It carries SELECTIONS (which rate rows to use), never the rate values; the
// server resolves the actual numbers from the DB. This whole object is frozen
// into specs_snapshot on each saved estimate.
// ===========================================================================

/**
 * Printing selection shared by outer/inner wrap and the foam cover. `colour`
 * (client 6-Jul) picks the multicolour vs single-colour offset rate row —
 * OFFSET ONLY (digital has no colour tier). Omitted on legacy snapshots and
 * for digital; the resolver defaults it to "multi".
 *
 * `auto` (client 13-Jul: "engine automatically selects the printing option
 * that is most economical, and subsequently the paper size best suited"):
 * when true, `sizeLabel` may be omitted — the server enumerates every size of
 * the chosen TYPE (offset × colour, or digital) with every fitting paper row
 * at the chosen GSM and picks the cheapest (printing + purchased paper incl.
 * wastage). specs_snapshot keeps `auto` so a re-run re-optimizes; the winning
 * row is frozen in rates_snapshot like any explicit pick. Outer + inner wraps
 * only — foam covers / card-stock inserts use explicit sizes.
 */
export interface PrintingSelection {
  type: "offset" | "digital";
  /** Required unless `auto` is true (enforced server-side). */
  sizeLabel?: string;
  colour?: "multi" | "single";
  auto?: boolean;
  /**
   * Printing vendor (round 10, client 5-Aug). Part of the rate identity since
   * migration-printing-vendor.sql, so two printers can quote the same sheet
   * size at different prices. Omitted = "any vendor": the resolver does not
   * filter and takes the un-named (NULL-vendor) row first, which is exactly
   * how every pre-round-10 snapshot resolved.
   */
  vendor?: string;
}

/** Outer wrap: printed paper (Option 1) or special paper (Option 2). */
export type OuterWrap =
  | {
      mode: "printed";
      /** Required unless printing.auto (the server then picks the paper too). */
      paperSizeLabel?: string; // -> paper_rates(size_label, gsm)
      gsm: number;
      foldingAllowance_mm?: number; // default from app_config (20)
      printing: PrintingSelection;
      /**
       * Per-estimate printing wastage % override (client 2-Jul: heavy solid-colour
       * jobs waste more). Omit for the app_config auto value (10% print-only /
       * 15% with foiling-UV).
       */
      wastagePctOverride?: number;
    }
  | {
      mode: "special";
      specialPaperName: string; // -> special_paper_rates(name, size_label)
      specialSizeLabel: string;
      foldingAllowance_mm?: number;
      /** Override the sheet size from the rate card (editable per estimate if batch size differs). */
      sheetOverride?: { width_in: number; height_in: number };
    };

/**
 * Inner lining (blank = board keyline exactly). Client 2026-07: four modes on
 * the form — none (omit) / white paper / printed paper / special paper — each
 * with its own finishing. "White paper" is plain lining stock priced from its
 * OWN rate table (white_paper_rates), separate from the printed-paper list.
 * `mode` is optional on the printed arm so pre-2026-07 snapshots (no mode,
 * printing optional) keep resolving exactly as before (paper_rates).
 */
export type InnerWrap =
  | {
      mode: "white";
      paperSizeLabel: string; // -> white_paper_rates(size_label, gsm)
      gsm: number;
      finishing?: FinishingSelection[];
    }
  | {
      mode?: "printed";
      /** Required unless printing.auto (the server then picks the paper too). */
      paperSizeLabel?: string; // -> paper_rates(size_label, gsm)
      gsm: number;
      /** Optional for legacy snapshots; the new form always sets it in printed mode. */
      printing?: PrintingSelection;
      finishing?: FinishingSelection[];
    }
  | {
      mode: "special";
      specialPaperName: string; // -> special_paper_rates(name, size_label)
      specialSizeLabel: string;
      /** Override the sheet size from the rate card (editable per estimate if batch size differs). */
      sheetOverride?: { width_in: number; height_in: number };
      finishing?: FinishingSelection[];
    };

/**
 * Per-component wrapping override (client final doc item 2: "allow wrapping
 * options — printing + paper + finish — to be set separately for each part of
 * the box; e.g. Tray inner+outer, Case inner+outer").
 *
 * Keyed by the box formula's component name ("tray", "lid", "case", "neck",
 * "sleeve", …). A component with an entry uses THAT wrap instead of the
 * estimate-level one; components without an entry keep the shared wrap.
 * Components whose resolved wrap is identical still nest together and share
 * one print job — differing wraps are genuinely separate plates and purchases.
 */
export interface ComponentWrap {
  outer?: OuterWrap;
  inner?: InnerWrap;
  /** Outer finishing for this component (falls back to the estimate's). */
  finishing?: FinishingSelection[];
}

/** One finishing pass; `key` is the chosen row's type/color in its rate table. */
export interface FinishingSelection {
  kind: "lamination" | "foiling" | "uv" | "relief";
  key: string; // lamination.type | foiling.color | uv_coating.type | relief.type
  /**
   * Foiling only (client 4-Jul): matte vs glossy foil. Picks the (color, finish)
   * rate row; the resolver falls back to the colour's other row when the exact
   * finish is missing (prices are identical today). Omitted on legacy snapshots.
   */
  finish?: "matte" | "glossy";
  /**
   * For per-sq-inch finishes (foiling, spot UV, relief/emboss): the actual design
   * area in inches for THIS item. Defaults to box footprint when omitted.
   * Whole-sheet finishes (lamination, full UV, drip-off, aquas) ignore this.
   */
  designArea?: { length_in: number; width_in: number };
  /**
   * Extra mm added to each side of the design area to cover foil/plate overlap and
   * setup waste (client 27-Jun: default +10 mm each side). The effective charged area
   * is (L + 2×mm/25.4) × (W + 2×mm/25.4). Ignored for whole-sheet finishes.
   */
  wastageAllowance_mm?: number;
}

/**
 * The board type every art_card_rates row carried before the "Board" section
 * gained its Type column (client 18-Jul) — the migration's column default, and
 * the fallback for cover selections saved without an explicit `boardType`.
 */
export const DEFAULT_BOARD_TYPE = "Art card";

/**
 * Optional cover glued on the foam (client 2-Jul: "sometimes comes with a
 * cover on top and bottom"). Pieces per box = top + bottom (1–2), each cut to
 * the foam footprint. Material: art paper (paper_rates) / board
 * (art_card_rates) / special paper (special_paper_rates). Optional printing
 * follows the same layout/formula as the outer/inner wrap printing (print
 * size drives the paper purchase; wastage sheets added).
 */
export interface FoamCoverSelection {
  top: boolean;
  bottom: boolean;
  material: "art_paper" | "art_card" | "special";
  /** art_paper -> paper_rates(size_label, gsm); art_card -> art_card_rates(type, size_label, gsm). */
  paperSizeLabel?: string;
  gsm?: number;
  /**
   * Board type (client 18-Jul: the "Board" rate section holds several board
   * stocks). art_card only. Absent on snapshots saved before the Board section
   * gained its Type column — those resolve to DEFAULT_BOARD_TYPE, which is what
   * every pre-existing row was migrated to.
   */
  boardType?: string;
  /** special -> special_paper_rates(name, size_label). */
  specialPaperName?: string;
  specialSizeLabel?: string;
  /** Override the special sheet size from the rate card (parity with the wraps). */
  sheetOverride?: { width_in: number; height_in: number };
  printing?: PrintingSelection;
  /**
   * Finishing on the cover (client 7-Jul: "same as wrapping, with all
   * customisation options"). Same shape/costing as the outer/inner wrap; one
   * shared config drives both top and bottom covers.
   */
  finishing?: FinishingSelection[];
}

/**
 * One foam insert (client 2-Jul: an estimate can carry SEVERAL foam inserts,
 * each with its own type/thickness/size and optional cover).
 */
export interface FoamInsertSelection {
  type: "XLPE" | "EPE" | "PU";
  thickness_mm: number;
  insert: { length_in: number; width_in: number };
  /**
   * Punching margin (client 7-Jul: "punching margin allowance for foam — empty
   * input box"): extra mm added to EACH side of the foam piece when nesting on
   * the sheet, so the die-punch has clearance. 0 / omitted = nest the raw
   * footprint (legacy behaviour). Covers stay at the raw footprint (they wrap
   * the finished foam, not the punched blank).
   */
  punchingMargin_mm?: number;
  cover?: FoamCoverSelection;
}

/**
 * Card/paper stock for the round-5 inserts (beading, card partitions): the
 * same material trio as the foam cover (art paper / board / special paper),
 * optional printing (explicit size only — Auto is an outer/inner-wrap feature)
 * and lamination-only finishing. Deliberately its OWN type (not
 * FoamCoverSelection): no top/bottom flags, and finishing is constrained to
 * lamination per the client's "Material, Printing, Lamination" spec.
 */
export interface CardStockSelection {
  material: "art_paper" | "art_card" | "special";
  /** art_paper -> paper_rates(size_label, gsm); art_card -> art_card_rates(type, size_label, gsm). */
  paperSizeLabel?: string;
  gsm?: number;
  /** Board type (art_card only) — see FoamCoverSelection.boardType. */
  boardType?: string;
  /** special -> special_paper_rates(name, size_label). */
  specialPaperName?: string;
  specialSizeLabel?: string;
  sheetOverride?: { width_in: number; height_in: number };
  printing?: PrintingSelection;
  /** Lamination selections only (kind "lamination"); enforced server-side. */
  lamination?: FinishingSelection[];
}

/**
 * Sleeve stock (round 6, client 15-Jul meeting: the sleeve is "not kappa
 * board — only paper and art card"): the card-stock trio with FULL finishing
 * instead of lamination-only ("same printing options with finishes"). The
 * sleeve blank is cut directly from this stock — keyline exact, no folding
 * allowance and no board component.
 */
export type SleeveStock = Omit<CardStockSelection, "lamination"> & {
  finishing?: FinishingSelection[];
};

export interface InsertsSelection {
  /** @deprecated pre-2026-07 snapshots stored a single foam insert here. New code uses `foams`. */
  foam?: FoamInsertSelection;
  foams?: FoamInsertSelection[];
  reverseBoard?: {
    thickness_mm: number;
    insertHeight_in: number;
    topPaper?: { paperSizeLabel: string; gsm: number };
  };
  /**
   * Custom card insert — a one-off die-cut the engine can't nest, so the COST
   * stays a manual open input. Client 22-Jul asked for detail fields underneath
   * it ("size, material type, GSM") so the raw-material sheet still says what
   * to buy. All descriptive: they document the insert, they don't price it.
   * Every pre-22-Jul snapshot has `total` alone and is unaffected.
   */
  card?: {
    total: number;
    size?: { length_in: number; width_in: number };
    materialType?: string;
    gsm?: number;
  };
  ribbonTagSizeLabel?: string; // -> ribbon_tag_rates(size_label); auto box types
  /**
   * Sleeve insert (round 5, reworked round 6): the box type's own sleeve
   * formula (drawer/matchbox; matchbox default otherwise —
   * lib/formulas/sleeve.ts), dims prefilled from the box but editable, cut
   * from paper / board stock / special paper (SleeveStock — no kappa board).
   */
  sleeve?: {
    dims: BoxDimensions;
    stock: SleeveStock;
  };
  /**
   * Beading insert (round 5, client 13-Jul). Blank =
   * [BH+BT+BH + L + BH+BT+BH] × [BH+BT+BH + W + BH+BT+BH], one per box.
   */
  beading?: {
    height_in: number; // BH
    thickness_in: number; // BT
    stock: CardStockSelection;
  };
  /**
   * Card partitions (round 5, client 13-Jul). L-partitions: blank (H+H) × L,
   * × countL; W-partitions: blank (H+H) × W, × countW. H = box height.
   */
  cardPartitions?: {
    countL: number;
    countW: number;
    stock: CardStockSelection;
  };
  /** Custom card partition (round 5): explicit blank L × W, × count per box. */
  customPartition?: {
    size: { length_in: number; width_in: number };
    count: number;
    stock: CardStockSelection;
  };
}

export interface AccessoriesSelection {
  magnetsPerBox?: number;
  magnetDiameter_mm?: number; // -> magnet_rates(diameter_mm, thickness_mm)
  magnetThickness_mm?: number;
  washerName?: string; // -> washer_rates(name)
}

/**
 * Manual customisation add-ons (doc 2026-06-19). Handles + locks are priced by
 * type (count x price-per-each); the window film is nested on a sheet like foam.
 * All optional; each is only included when the staff member selects it.
 */
/**
 * One miscellaneous add-on line (client 8-Jul: "Sleeve" + "Miscellaneous —
 * enter type, L x W / units and price manually"). `label` is either "Sleeve",
 * a misc_rates row name (which pre-fills the price), or free text. The price
 * is ALWAYS a manual open input (frozen in the snapshot); misc_rates only
 * provides defaults. Cost = units × pricePerUnit, a level-1 RM line — and
 * (round 10, staff-reported: "units" read as per-box but was charged as a
 * flat total) when `perBox` is true that's multiplied by the production
 * quantity too, same as handles/locks. Absent = flat total, so pre-round-10
 * snapshots recompute byte-identically.
 */
export interface MiscAddonSelection {
  label: string;
  size?: { length_in: number; width_in: number };
  units: number;
  pricePerUnit: number;
  perBox?: boolean;
}

export interface AddonsSelection {
  handles?: { type: string; count: number }; // -> handle_rates(type)
  locks?: { type: string; count: number }; // -> lock_rates(type)
  window?: {
    name: string; // -> window_rates(name) (film type)
    size: { length_in: number; width_in: number }; // one window per box
    /**
     * Punching allowance per SIDE in mm. Client final doc item 4C: "sizes are
     * entered as the actual window size, but the formula should always add
     * +10mm on each side automatically" — NOT staff-editable. build-estimate
     * forces this to WINDOW_PUNCHING_MARGIN_MM (10) server-side for every
     * estimate with a window, overriding whatever the client sends, so it can
     * never be silently skipped. The field stays optional only because old
     * snapshots (pre-fix, or pre-round-5 with no field at all) recorded 0 or a
     * staff-chosen value — recompute reads their frozen specs_snapshot as-is.
     */
    punchingMargin_mm?: number;
  };
  misc?: MiscAddonSelection[];
}

/**
 * A consumable entered BY QUANTITY (client 21-Jul). The rate is typed per
 * estimate — glue/metlock prices vary too much to hold on the rate card.
 * cost = qty × rate.
 */
export interface ManualQty {
  qty: number;
  unit: string; // "bottles" | "litres" | "kg" | …
  rate: number; // ₹ per unit
}

export interface LabourSelection {
  role: string; // -> labour_rates(name)
  unit: "hour" | "day";
  quantity: number; // hours or days
}

/**
 * Partial / sectional estimate (client asked 17-Jun and again 2-Jul): which
 * parts of the job this estimate covers. Missing (or a missing flag) = included,
 * so old snapshots behave as full estimates. `board: false` keeps the board
 * NESTING (paper blanks derive from the keyline) but charges no board or tape.
 * `wrapping` / `inserts` false make the server ignore those selections entirely.
 */
export interface SectionsSelection {
  board?: boolean;
  wrapping?: boolean;
  inserts?: boolean;
}

/**
 * One additional charge (die / mould / block). Legacy snapshots stored a bare
 * number (the pre-multiplied qty × price total); new snapshots keep qty + rate
 * so the PDF can itemize "Die (2 × ₹1,500)". Use `chargeTotal`/`chargeDetail`
 * (lib/estimate/charges.ts) to read either shape.
 */
export type ChargeLine = number | { qty: number; rate: number };

/** Full estimate request (the future form payload). */
export interface EstimateRequest {
  boxType: BoxType;
  dims: BoxDimensions;
  vars?: BoxVariables;
  /**
   * ORDERED quantity — what the customer asked for, and what the final
   * per-box rate is quoted against. Unchanged meaning: every pre-round-7
   * snapshot's `quantity` is its ordered quantity.
   */
  quantity: number;
  /**
   * PRODUCTION quantity (client final doc item 3): boxes actually made,
   * including production wastage — e.g. order 100, produce 105. ALL material
   * and cost maths run on this; the per-box rate then divides by the ORDERED
   * quantity (₹15,000 for 105 boxes on an order of 100 = ₹150/box).
   * Absent / <= ordered means "no wastage allowance" and the engine behaves
   * exactly as before.
   */
  productionQuantity?: number;
  clientId?: string | null;
  sections?: SectionsSelection;
  /** Optional user-entered estimate name (client 8-Jul), also stored on the row. */
  name?: string;
  /**
   * When this estimate was created by re-running a saved one (/estimate?from=id),
   * the source estimate's id — the API marks that estimate status='revised'.
   * Provenance only; the engines never read it.
   */
  sourceEstimateId?: string;

  boardThickness_mm: number; // -> board_rates(thickness_mm)
  wrapping?: {
    outer?: OuterWrap;
    inner?: InnerWrap;
    /**
     * Per-component overrides (client final doc item 2). Keyed by component
     * name; a listed component uses its own wrap instead of the shared one
     * above. Absent = one wrap for the whole box (every pre-round-7 snapshot).
     */
    perComponent?: Record<string, ComponentWrap>;
  };
  finishing?: FinishingSelection[];
  // Each FinishingSelection now carries its own designArea for per-sq-inch
  // finishes — the old top-level finishingDesignArea field is removed.
  inserts?: InsertsSelection;
  accessories?: AccessoriesSelection;
  addons?: AddonsSelection;
  labour?: LabourSelection[];
  // tapeTotal: open-input override for tape (e.g. collapsible box — rate varies);
  // when set it replaces the auto per-tray/lid tape cost.
  manual?: {
    glueTotal?: number;
    metlockTotal?: number;
    tapeTotal?: number;
    /**
     * Whether this box uses tape at all.
     *
     * ABSENT = true. Every box type has at least one component whose name
     * matches "tray"/"lid" (see trayLidComponentCount in lib/engines/
     * material.ts), so before this flag existed tape was ALWAYS charged and
     * there was no way to say a job uses none. Defaulting the absent case to
     * "used" is what keeps every saved specs_snapshot recomputing
     * byte-identically; only an explicit `false` zeroes the line.
     *
     * false  -> tape cost is 0, and tapeTotal is ignored.
     * true   -> tapeTotal when given, else the auto per-tray/lid computation.
     */
    tapeUsed?: boolean;
    /**
     * Quantity mode (client 21-Jul: "either select bottles or cost itself").
     * Glue/metlock consumption varies too much to derive, so the user either
     * types the cost directly (glueTotal alone — the original behaviour) or
     * enters a real count here, which RESOLVES into glueTotal/metlockTotal.
     * Present only in quantity mode; the engines always read the totals, so
     * every pre-existing snapshot costs identically.
     */
    glueQty?: ManualQty;
    metlockQty?: ManualQty;
  };
  /**
   * Additional charges (no margin applied; shown itemized on the PDF).
   * Die/mould/block: qty + rate (or a legacy pre-multiplied number — see
   * ChargeLine). Designer stays a flat total.
   */
  additional?: { die?: ChargeLine; mould?: ChargeLine; block?: ChargeLine; designer?: number };
  /**
   * How the additional charges above are priced (client 28-Jul: "the engine
   * accounts for one-time charges in the total price of each box — I need them
   * separate, not divided into each box cost; let's make this a toggle").
   *   "separate" — pricePerBox covers the BOXES ONLY; the charges are quoted as
   *                their own line and taxed at 18% (a distinct supply).
   *   "included" — amortised into pricePerBox and billed as part of the box
   *                supply: one unit price, 5% GST, no separate quote block.
   * `cost.total` is the whole pre-GST figure under BOTH modes — only the
   * numerator of the per-box divide moves.
   * Absent = saved before this existed: amortised into pricePerBox but still
   * split out on the quote (the pre-28-Jul hybrid). Never re-priced.
   */
  additionalMode?: "included" | "separate";

  /**
   * Manual edits to computed raw-material lines (client final doc item 9,
   * confirmed 22-Jul: "I would want to mend, say, the total foam price to
   * account for their transport costs — right now none of the raw material
   * prices take that into account").
   *
   * Each entry replaces one Level-1 line total; overhead and margin then
   * recalculate on the edited base. Stored HERE (specs_snapshot) rather than by
   * bending a rate, so rates_snapshot stays a truthful record of the rate card,
   * re-editing an estimate restores the edits, and the original computed figure
   * is always recoverable. Absent = nothing edited (every prior estimate).
   */
  adjustments?: CostAdjustment[];

  /** Orientation overrides per component (Engine 1), keyed by component name. */
  overrides?: Record<string, "A" | "B">;
  /**
   * Board-cutting method (client 7-Jul). "auto" (default / legacy) lets the
   * engine combine different parts onto shared sheets when that needs fewer
   * sheets; "single" forces every component onto its own sheets.
   */
  nestingMode?: "auto" | "single";
  /**
   * Nesting model version (round 5). Absent / 1 = pure per-component grids
   * (legacy — every saved snapshot recomputes exactly as costed). >= 2 enables
   * MIXED-ORIENTATION nesting (client 13-Jul: main grid + rotated pieces in
   * the leftover strips; never worse than the pure grid). The form always
   * sends the current version for new estimates.
   */
  nestingVersion?: number;
  /**
   * Inner-lining model version (round 10, client 5-Aug: "inner printing for
   * magnetic case should only take into account inner case, flap and spine").
   * Absent / 1 = every component is lined across its FULL board keyline
   * (legacy — every saved snapshot recomputes exactly as costed). >= 2 runs
   * the box type's own lining formula, which for a magnetic case drops the
   * panel the tray is glued over. The form always sends the current version.
   */
  liningVersion?: number;
  /**
   * Print-job layout (client 13-Jul "combined printing — separate T + B =
   * double printing costs"). "combined" (default / legacy) = one print job per
   * wrap layer, components may share sheets. "separate" = every component its
   * own plate: wrap layers never combine across components AND offset tier
   * minimums are charged per component.
   */
  printingMode?: "combined" | "separate";
  /** Optional overrides of the app_config / margin_config defaults. */
  overheadPct?: number;
  marginPct?: number;
}
