"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { HardHat, Layers, Package, PackageOpen, Plus, ReceiptText, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Switch } from "@/components/ui/switch";
import { FormSection, type SectionDef } from "@/components/estimate/form-section";
import { SaveButton } from "@/components/estimate/save-button";
import { keylineComponents, ReverseBoardKeyline } from "@/components/keylines";
import { ResultPanel, type AutoPickInfo, type ResultCost } from "@/components/estimate/result-panel";
import type { AdjustableLine, CostAdjustment } from "@/lib/engines/cost";
import { LiveNesting } from "@/components/estimate/live-nesting";
import { formatMoney } from "@/lib/currency";
import { useMoneyFormat, useMoneyFormatter } from "@/lib/currency-context";
import { BRAND } from "@/lib/brand";
import {
  FinishingPicker,
  emptyFinishing,
  fromFinishingSelections,
  toFinishingSelections,
  type FinishingValue,
} from "@/components/estimate/finishing-picker";
import type {
  ComponentWrap,
  BoxType,
  BoxVariables,
  EstimateRequest,
  InnerWrap,
  InsertsSelection,
  LabourSelection,
  OuterWrap,
  UserRole,
} from "@/types";
import { DEFAULT_BOARD_TYPE } from "@/types";
import { WINDOW_PUNCHING_MARGIN_MM, type MaterialInput, type MaterialQuantities } from "@/lib/engines/material";
import type { RateOptions } from "@/lib/db/rate-options";
import type { ClientRow } from "@/lib/db/clients-db";
import {
  CardStockFields,
  cardStockFromSelection,
  cardStockToSelection,
  defaultCardStock,
  type CardStockState,
} from "@/components/estimate/card-stock-fields";
import { sleeveBlank } from "@/lib/formulas/sleeve";
import { fitAllowanceIn } from "@/lib/formulas/fit";
import { getBlanks } from "@/lib/formulas";
import { buildCostView } from "@/lib/estimate/cost-view";
import type { CostBreakdown } from "@/lib/engines/cost";
import {
  ComponentWrapFields,
  componentWrapFromSelection,
  componentWrapToSelection,
  defaultComponentWrap,
  type ComponentWrapState,
} from "@/components/estimate/per-component-wrap";
import { ClientCombobox } from "@/components/clients/client-combobox";
import { BOX_LABELS } from "@/lib/box-types";
import { UNIT_LABELS, dimStep, fromDim, toDim, type Unit } from "@/lib/units";
import { useShake } from "@/hooks/use-shake";

// Fallback only, shown before rate options load — the real list comes from
// options.board (board_rates), so a new thickness added on /rates appears
// without a code change.
const BOARD_THICKNESSES = [1.2, 1.5, 1.8, 2, 2.5, 3];
// Sentinel value for the "Auto (cheapest)" print-size option (round 5): the
// server enumerates every size of the chosen type and picks the most
// economical, along with the paper sheet best suited to it.
const AUTO_SIZE = "__auto";
const MAGNET_BOXES = new Set<BoxType>(["magnetic", "double_decker", "collapsible_rigid"]);
const RIBBON_BOXES = new Set<BoxType>(["drawer_sliding", "double_decker"]);
/** How long the Save button holds its "Saved" state before reverting to idle. */
const SAVED_HOLD_MS = 2200;

// Beading is entered at a finer grain than the shared dimStep allows: BH/BT
// default to 0.5 in / 0.125 in, and dimStep's 0.1 for in/cm would coarsen the
// step the client set. Everything else on the form keeps using dimStep.
function beadStep(unit: Unit): string {
  return unit === "mm" ? "0.5" : "0.05";
}

/**
 * Printing-vendor picker (round 10). Renders NOTHING until someone has named a
 * vendor on a matching rate row — a lone "Any vendor" dropdown would just be
 * noise on a rate card that has never used the column.
 *
 * Under Auto sizing there is no chosen size yet, so the list is filtered by
 * type + colour only: picking a vendor then constrains what Auto compares.
 */
function PrintVendorField({
  options,
  type,
  colour,
  sizeLabel,
  value,
  onChange,
  idPrefix,
}: {
  options: RateOptions | null;
  type: "offset" | "digital";
  colour: "multi" | "single";
  /** The chosen print size, or AUTO_SIZE / "" when none is fixed yet. */
  sizeLabel: string;
  value: string;
  onChange: (v: string) => void;
  idPrefix: string;
}) {
  const anySize = !sizeLabel || sizeLabel === AUTO_SIZE;
  const vendors = [
    ...new Set(
      (options?.printVendors ?? [])
        .filter(
          (v) =>
            v.type === type &&
            (anySize || v.sizeLabel === sizeLabel) &&
            (type !== "offset" || (v.colour ?? "multi") === colour),
        )
        .map((v) => v.vendor),
    ),
  ].sort((a, b) => a.localeCompare(b));

  // Self-healing: if size/colour changes out from under a chosen vendor (e.g.
  // picked while size was "any", then a size that vendor never quoted was
  // selected), drop back to "Any vendor" rather than silently submitting a
  // vendor+size combo with no matching rate row.
  useEffect(() => {
    if (value && !vendors.includes(value)) onChange("");
    // Only re-check when the AVAILABLE list changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendors.join("|"), value]);

  if (vendors.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`${idPrefix}-vendor`}>Printing vendor</Label>
      <NativeSelect
        id={`${idPrefix}-vendor`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Any vendor</option>
        {vendors.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

// The form follows the order the factory costs a job — the step numbers are
// real sequence — each section shows its own numbered heading (FormSection).
const SECTIONS: SectionDef[] = [
  { id: "sec-box", step: 1, title: "Box specification", icon: Package },
  { id: "sec-wrap", step: 2, title: "Wrapping & finishing", icon: Layers },
  { id: "sec-inserts", step: 3, title: "Inserts & add-ons", icon: PackageOpen },
  { id: "sec-labour", step: 4, title: "Labour", icon: HardHat },
  { id: "sec-charges", step: 5, title: "Charges & overrides", icon: ReceiptText },
];

// Live echo of numbers the user just typed into this form (e.g. "2 × 1500 =
// 3000"). Deliberately NOT formatMoney: that applies the demo's display
// divisor, which would show a total that contradicts the figures still visible
// in the inputs beside it. Computed results — the result panel, cost view and
// PDFs — all go through formatMoney and do scale.
//
// A trial account has no divisor to dodge (their card is priced in its own
// currency), so their echo goes through formatMoney with their own dressing —
// see `echo` in ConsumableField.
const typedMoney = (n: number) =>
  BRAND.currencySymbol +
  n.toLocaleString(BRAND.currencyLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Unit conversion (display only — internal state always in inches) lives in
// lib/units.ts and applies to EVERY dimension input in the form (client
// 2026-07), not only the main L×W×H. Stock SHEET sizes stay in inches (they
// mirror the rate card's inch-labelled sizes like 23x36).

const VAR_KEYS: Record<BoxType, (keyof BoxVariables)[]> = {
  telescopic: ["lidDepth_in"],
  magnetic: ["flapLength_in"],
  shoulder: ["bottomHeight_in", "neckHeight_in", "lidDepth_in"],
  drawer_sliding: [],
  matchbox_sliding: [],
  hinge_lid: ["bottomHeight_in", "neckHeight_in", "lidDepth_in"],
  collapsible_rigid: ["flapLength_in"],
  double_decker: ["flapLength_in", "trayHeight1_in", "trayHeight2_in"],
  tray_only: [],
};

const VAR_BASE_LABELS: Partial<Record<keyof BoxVariables, string>> = {
  lidDepth_in: "Lid depth",
  bottomHeight_in: "Bottom height BH",
  neckHeight_in: "Neck height NH",
  flapLength_in: "Flap length",
  flapHeight_in: "Flap height",
  trayHeight1_in: "Tray 1 height H1",
  trayHeight2_in: "Tray 2 height H2",
};
const varLabel = (key: keyof BoxVariables, unit: Unit) =>
  `${VAR_BASE_LABELS[key] ?? key} (${UNIT_LABELS[unit]})`;

function defaultVars(bt: BoxType): BoxVariables {
  switch (bt) {
    case "telescopic":
      return { lidDepth_in: 1.5 };
    case "magnetic":
      return { flapLength_in: 1.5, panels: 4, flapHeight_in: 1 };
    case "shoulder":
    case "hinge_lid":
      return { bottomHeight_in: 3, neckHeight_in: 1.5, lidDepth_in: 1.5 };
    case "collapsible_rigid":
      return { flapLength_in: 1.5 };
    case "double_decker":
      return { flapLength_in: 1.5, trayHeight1_in: 2, trayHeight2_in: 2 };
    default:
      return {};
  }
}

type Result = {
  materials: MaterialQuantities;
  cost: ResultCost;
  /** Auto-printing picks (round 5) — present when a wrap used Auto. */
  autoPicks?: AutoPickInfo[];
};
type OuterMode = "none" | "printed" | "special";
type LabourRow = { role: string; unit: "hour" | "day"; quantity: number };

/**
 * Photo picker for add-ons (handles / locks / window film). The client identifies
 * these by picture, not name, so we show a thumbnail grid; selection is still by
 * label (type/name). Photos are served by the rate-image API route.
 */
function ImagePick({
  table,
  items,
  selected,
  onSelect,
}: {
  table: string;
  items: { id: number; label: string; hasImage: boolean }[];
  selected: string;
  onSelect: (label: string) => void;
}) {
  if (!items.length)
    return <p className="text-xs text-muted-foreground">None on the rate card yet.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const isSel = it.label === selected;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onSelect(it.label)}
            className={`flex w-28 flex-col items-center gap-1 rounded border p-1.5 text-center text-[11px] transition-colors ${
              isSel ? "border-primary ring-1 ring-primary" : "hover:border-primary/50"
            }`}
          >
            {it.hasImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/rates/image?table=${table}&id=${it.id}`}
                alt=""
                className="h-20 w-20 rounded object-cover"
              />
            ) : (
              <span className="flex h-20 w-20 items-center justify-center rounded border border-dashed text-[9px] leading-tight text-muted-foreground">
                No photo
              </span>
            )}
            <span className="line-clamp-2 leading-tight">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One selected add-on to preview (resolved from the form's current selection). */
type AddonPreviewItem = {
  table: string;
  id?: number; // undefined when the selected label has no rate-card row
  label: string;
  hasImage: boolean;
  caption: string; // e.g. "× 2 / box" or "3 × 2 in"
};

/**
 * Large, prominent preview of the currently-selected add-ons, shown beside the
 * keyline so staff can confirm the right part by picture (client review: handles
 * etc. have no names, only verifiable against the photo). Renders nothing when
 * no add-on is selected.
 */
function SelectedAddonPreview({ items }: { items: AddonPreviewItem[] }) {
  if (!items.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Selected parts</CardTitle>
        <CardDescription>Confirm the part by its rate-card photo.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-4">
          {items.map((it) => (
            <div key={`${it.table}-${it.label}`} className="flex flex-col items-center gap-1.5 text-center">
              {it.hasImage && it.id != null ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/rates/image?table=${it.table}&id=${it.id}`}
                  alt={it.label}
                  className="h-36 w-36 rounded-md border object-cover"
                />
              ) : (
                <span className="flex h-36 w-36 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                  No photo on rate card
                </span>
              )}
              <span className="max-w-36 text-sm font-medium leading-tight">{it.label}</span>
              <span className="text-xs text-muted-foreground">{it.caption}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Glue / metlock input (client 21-Jul: "either select bottles or cost itself").
 * Usage varies too much with size and customisation to derive, so the user
 * picks: By quantity (count × rate — the count also prints on the raw-material
 * sheet) or By cost (a rupee amount, optionally per box). Either way the
 * engine receives one resolved cost, so nothing downstream changes.
 */
function ConsumableField({
  id,
  label,
  mode,
  onModeChange,
  cost,
  onCostChange,
  perBox,
  onPerBoxChange,
  qty,
  onQtyChange,
  unit,
  onUnitChange,
  rate,
  onRateChange,
  units,
}: {
  id: string;
  label: string;
  mode: "cost" | "qty";
  onModeChange: (m: "cost" | "qty") => void;
  cost: number;
  onCostChange: (n: number) => void;
  perBox: boolean;
  onPerBoxChange: (b: boolean) => void;
  qty: number;
  onQtyChange: (n: number) => void;
  unit: string;
  onUnitChange: (s: string) => void;
  rate: number;
  onRateChange: (n: number) => void;
  units: string[];
}) {
  // A trial account's own market symbol; admin/staff fall back to BRAND.
  const fmt = useMoneyFormat();
  const symbol = fmt?.symbol ?? BRAND.currencySymbol;
  // AED's symbol is "AED " — a TRAILING SPACE, so that formatMoney can
  // prefix a figure as "AED 1,234.50". That space is wrong wherever the
  // symbol is followed by a word instead of a number ("AED  per litre"), so
  // label contexts use the trimmed form and only number-prefixing uses the raw.
  const symbolLabel = symbol.trim();
  const echo = (n: number) => (fmt ? formatMoney(n, 2, fmt) : typedMoney(n));
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <Segmented
        size="sm"
        value={mode}
        onValueChange={onModeChange}
        options={[
          { value: "cost", label: "By cost" },
          { value: "qty", label: "By quantity" },
        ]}
      />
      {mode === "cost" ? (
        <>
          <NumberField
            id={id}
            step="0.01"
            min="0"
            value={cost}
            emptyValue={0}
            onValueChange={onCostChange}
            placeholder={perBox ? `${symbolLabel} per box` : `${symbolLabel} total`}
          />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch id={`${id}PerBox`} className="scale-90" checked={perBox} onCheckedChange={onPerBoxChange} />
            <Label htmlFor={`${id}PerBox`} className="text-xs font-normal text-muted-foreground">per box (× qty)</Label>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <NumberField aria-label={`${label} quantity`} step="0.1" min="0" value={qty} emptyValue={0} onValueChange={onQtyChange} placeholder="Qty" />
            <NativeSelect aria-label={`${label} unit`} value={unit} onChange={(e) => onUnitChange(e.target.value)}>
              {units.map((u) => <option key={u} value={u}>{u}</option>)}
            </NativeSelect>
          </div>
          <NumberField
            aria-label={`${label} rate per unit`}
            step="0.01"
            min="0"
            value={rate}
            emptyValue={0}
            onValueChange={onRateChange}
            placeholder={`${symbolLabel} per ${unit.replace(/s$/, "")}`}
          />
          <p className="text-xs text-muted-foreground">
            {qty > 0 && rate > 0
              ? `${qty} ${unit} × ${symbol}${rate} = ${echo(qty * rate)}`
              : "Quantity also prints on the raw-material sheet."}
          </p>
        </>
      )}
    </div>
  );
}

export function EstimateForm({
  role,
  initialSpecs,
  sourceEstimateId,
  clients = [],
  initialOptions = null,
}: {
  role: UserRole | null;
  initialSpecs?: EstimateRequest;
  /** Present when pre-filled via /estimate?from=<id> — saving marks that estimate 'revised'. */
  sourceEstimateId?: string;
  clients?: ClientRow[];
  /**
   * Rate options rendered in by the server (app/(app)/estimate/page.tsx). When
   * present the form skips its own /api/rates/options round trip, which used to
   * run only after hydration and left every dropdown empty until it landed.
   * Null (the load failed) falls back to fetching.
   */
  initialOptions?: RateOptions | null;
}) {
  const inr = useMoneyFormatter();
  const moneyFormat = useMoneyFormat();
  // The signed-in session's currency SYMBOL, for labels and placeholders that
  // show the unit rather than a formatted figure ("Unit price AED", "$ each").
  // A trial account prices in its own market, so BRAND — which is the
  // DEPLOYMENT's dressing — is only the admin/staff fallback here, never the
  // value a trial should see.
  const moneySymbol = moneyFormat?.symbol ?? BRAND.currencySymbol;
  // Trimmed variant for label text — see the note in ConsumableField: the
  // AED symbol carries a trailing space for number-prefixing.
  const moneyLabel = moneySymbol.trim();
  // Core
  const [clientId, setClientId] = useState("");
  // Optional estimate name (client 8-Jul: "can I name the estimate?").
  const [estimateName, setEstimateName] = useState("");
  const [boxType, setBoxType] = useState<BoxType>("telescopic");
  const [dims, setDims] = useState({ length_in: 10, width_in: 8, height_in: 4 });
  const [quantity, setQuantity] = useState(500);
  // Production quantity (client final doc item 3): boxes actually made, incl.
  // wastage. Empty = same as ordered. All costing runs on this; the per-box
  // rate divides by the ORDERED quantity.
  const [productionQty, setProductionQty] = useState("");
  const [boardThickness, setBoardThickness] = useState(1.5);
  const [vars, setVars] = useState<BoxVariables>(defaultVars("telescopic"));
  const [unit, setUnit] = useState<Unit>("in");
  // Board cutting method (client 7-Jul): auto = allow combination nesting (kept
  // only when it needs fewer sheets); single = every component on its own sheets.
  const [nestingMode, setNestingMode] = useState<"auto" | "single">("auto");
  // Print-job layout (round 5, client 13-Jul): combined = parts share sheets +
  // one print job; separate = one plate per part (offset minimums per part).
  const [printingMode, setPrintingMode] = useState<"combined" | "separate">("combined");
  // Per-component wrapping (client final doc item 2): off = one wrap for the
  // whole box (the default and every legacy estimate).
  const [perComponentOn, setPerComponentOn] = useState(false);
  const [componentWraps, setComponentWraps] = useState<Record<string, ComponentWrapState>>({});

  // Fit allowance (round 6): mirror the server's injection (build-estimate.ts)
  // so the payload, live preview and keyline all use the blanks the engine will
  // cost. Re-derived from the CURRENT box type + thickness on every render —
  // never stored in vars state, so re-run hydration or a box-type switch can't
  // carry a stale value (non-fit types get the field stripped).
  // Parsed production quantity ("" / junk / <= ordered all mean "no wastage
  // run", which is exactly how the server reads a missing value).
  const prodQtyValue = Math.floor(Number(productionQty)) || 0;

  // The current box type's component names, for the per-component wrap editor.
  // getBlanks throws while required variables are still blank — an incomplete
  // spec just has no parts to list yet.
  const componentNames = useMemo<string[]>(() => {
    try {
      return getBlanks(boxType, dims, vars).map((b) => b.component);
    } catch {
      return [];
    }
  }, [boxType, dims, vars]);

  const varsWithFit = useMemo<BoxVariables>(() => {
    const { fitAllowance_in: _stale, ...rest } = vars;
    void _stale;
    const f = fitAllowanceIn(boxType, boardThickness);
    return f != null ? { ...rest, fitAllowance_in: f } : rest;
  }, [vars, boxType, boardThickness]);

  // Options
  // Seeded from the server render when available, so the dropdowns are
  // populated on the FIRST paint instead of after a post-hydration fetch.
  const [options, setOptions] = useState<RateOptions | null>(initialOptions);

  // Wrapping + finishing
  const [outerMode, setOuterMode] = useState<OuterMode>("none");
  const [outerPaperSize, setOuterPaperSize] = useState("");
  const [outerGsm, setOuterGsm] = useState(0);
  const [folding, setFolding] = useState(20);
  const [printingType, setPrintingType] = useState<"offset" | "digital">("offset");
  const [printingSize, setPrintingSize] = useState("");
  // Offset colour (client 6-Jul): multicolour vs single-colour — offset only.
  const [printingColour, setPrintingColour] = useState<"multi" | "single">("multi");
  // Printing vendor (round 10). "" = any vendor -> the field is omitted from
  // the payload and the resolver takes the un-named row, exactly as before.
  const [printingVendor, setPrintingVendor] = useState("");
  // Per-estimate printing wastage % override (client 2-Jul). Empty = auto
  // (app_config 10% print-only / 15% with foiling-UV).
  const [wastagePctStr, setWastagePctStr] = useState("");
  const [specialSel, setSpecialSel] = useState("");
  // Inner lining — 4 modes (client 2026-07): none / white stock / printed / special.
  type InnerMode = "none" | "white" | "printed" | "special";
  const [innerMode, setInnerMode] = useState<InnerMode>("none");
  const [innerWhiteSize, setInnerWhiteSize] = useState(""); // white_paper_rates
  const [innerWhiteGsm, setInnerWhiteGsm] = useState(0);
  const [innerPaperSize, setInnerPaperSize] = useState(""); // printed: paper_rates
  const [innerGsm, setInnerGsm] = useState(0);
  const [innerPrintingType, setInnerPrintingType] = useState<"offset" | "digital">("offset");
  const [innerPrintingSize, setInnerPrintingSize] = useState("");
  const [innerPrintingColour, setInnerPrintingColour] = useState<"multi" | "single">("multi");
  const [innerPrintingVendor, setInnerPrintingVendor] = useState("");
  const [innerSpecialSel, setInnerSpecialSel] = useState(""); // "name|size"
  const [innerSpecialSheetW, setInnerSpecialSheetW] = useState(0);
  const [innerSpecialSheetH, setInnerSpecialSheetH] = useState(0);
  // Finishing — outer wrap and inner lining EACH carry their own selections
  // (client 2026-07); the shared picker holds whole-sheet checkboxes + the
  // per-sq-inch dynamic lists in one bundle.
  const [outerFinish, setOuterFinish] = useState<FinishingValue>(emptyFinishing());
  const [innerFinish, setInnerFinish] = useState<FinishingValue>(emptyFinishing());
  // Special paper sheet-size override (defaults from rate card; editable per estimate).
  const [specialSheetW, setSpecialSheetW] = useState(0);
  const [specialSheetH, setSpecialSheetH] = useState(0);

  // Sectional/partial estimates were removed from the UI (client 2026-07-15:
  // the "Estimate covers" picker was extra space and easy to mis-tick, costing
  // the user a full-cost re-run). Every estimate now always covers all parts;
  // the request still carries all-true `sections` so the engine path is unchanged.
  const secBoard = true;
  const secWrapping = true;
  const secInserts = true;

  // Inserts
  // Per-spot display units (client 2026-07: every dimension-entry spot gets its
  // OWN visible in/cm/mm selector, like the main dims one). Values stay inches.
  const [foamUnit, setFoamUnit] = useState<Unit>("in");
  const [windowUnit, setWindowUnit] = useState<Unit>("in");
  const [revUnit, setRevUnit] = useState<Unit>("in");
  // Foam — a dynamic LIST (client 2-Jul: several inserts per estimate), each
  // row "type|thickness" + footprint + optional top/bottom cover.
  type FoamCoverState = {
    enabled: boolean;
    top: boolean;
    bottom: boolean;
    material: "art_paper" | "art_card" | "special";
    boardType: string; // art card: which board stock (Board rate section, client 18-Jul)
    paperSize: string; // art paper / art card: size label
    gsm: number;
    specialSel: string; // special: "name|size"
    specialSheetW: number; // special sheet override (parity with the wraps)
    specialSheetH: number;
    printingEnabled: boolean;
    printingType: "offset" | "digital";
    printingSize: string;
    printingColour: "multi" | "single"; // offset only (client 6-Jul)
    finish: FinishingValue; // cover finishing (client 7-Jul: full wrap parity)
  };
  type FoamRow = { sel: string; L: number; W: number; punchingMargin_mm: number; cover: FoamCoverState };
  // Foam + card get Switch toggles like the other inserts (client 8-Jul:
  // "toggle for card and foam inserts — more consistent"). The row/value state
  // is kept while toggled off; it's just excluded from the request.
  const [foamEnabled, setFoamEnabled] = useState(false);
  const [foamItems, setFoamItems] = useState<FoamRow[]>([]);
  const [cardEnabled, setCardEnabled] = useState(false);
  const [revEnabled, setRevEnabled] = useState(false);
  const [revThickness, setRevThickness] = useState(0);
  const [revInsertHeight, setRevInsertHeight] = useState(1);
  const [revTopEnabled, setRevTopEnabled] = useState(false);
  const [revTopSize, setRevTopSize] = useState("");
  const [revTopGsm, setRevTopGsm] = useState(0);
  const [cardTotal, setCardTotal] = useState(0);
  // Manual line edits (client final doc item 9, confirmed 22-Jul). Keyed by
  // cost line; the server re-costs from these so overhead/margin follow.
  const [adjustments, setAdjustments] = useState<CostAdjustment[]>([]);
  // Custom card insert detail fields (client 22-Jul) — descriptive only.
  const [cardL, setCardL] = useState(0);
  const [cardW, setCardW] = useState(0);
  const [cardMaterial, setCardMaterial] = useState("");
  const [cardGsm, setCardGsm] = useState(0);
  const [ribbonSize, setRibbonSize] = useState("");

  // --- Round-5 inserts (client 13-Jul) --------------------------------------
  // Sleeve: real insert (round 6: card stock only — client 15-Jul "not kappa
  // board, only paper and art card"). Box type's own sleeve formula, dims
  // prefilled from the box; the stock is the card-stock trio with a FULL
  // finishing picker (unlike beading/partitions' lamination-only dropdown).
  const [sleeveEnabled, setSleeveEnabled] = useState(false);
  const [sleeveL, setSleeveL] = useState(0);
  const [sleeveW, setSleeveW] = useState(0);
  const [sleeveH, setSleeveH] = useState(0);
  const [sleeveStock, setSleeveStock] = useState<CardStockState>(defaultCardStock(null));
  const [sleeveFinish, setSleeveFinish] = useState<FinishingValue>(emptyFinishing());
  // Beading: blank [BH+BT+BH + L + BH+BT+BH] × [same with W], 1/box.
  const [beadingEnabled, setBeadingEnabled] = useState(false);
  const [beadingBH, setBeadingBH] = useState(0.5);
  const [beadingBT, setBeadingBT] = useState(0.125);
  // Entry unit (client 5-Aug: the floor works in mm). Display only — BH/BT
  // stay in INCHES in state and in the payload, so nothing downstream moves.
  const [beadingUnit, setBeadingUnit] = useState<Unit>("in");
  const [beadingStock, setBeadingStock] = useState<CardStockState>(defaultCardStock(null));
  // Card partitions: nL × (H+H)×L + nW × (H+H)×W on a shared stock.
  const [partsEnabled, setPartsEnabled] = useState(false);
  const [partsCountL, setPartsCountL] = useState(1);
  const [partsCountW, setPartsCountW] = useState(1);
  const [partsStock, setPartsStock] = useState<CardStockState>(defaultCardStock(null));
  // Custom card partition: explicit L×W × count.
  const [customPartEnabled, setCustomPartEnabled] = useState(false);
  const [customPartL, setCustomPartL] = useState(0);
  const [customPartW, setCustomPartW] = useState(0);
  const [customPartCount, setCustomPartCount] = useState(1);
  const [customPartStock, setCustomPartStock] = useState<CardStockState>(defaultCardStock(null));

  // Accessories
  const [magnetsPerBox, setMagnetsPerBox] = useState(0);
  const [magnetSel, setMagnetSel] = useState(""); // "dia|thick"
  const [washerName, setWasherName] = useState("");

  // Miscellaneous add-ons (client 8-Jul): sleeve / rate-card misc materials /
  // custom — each row is a manual line (units × price). label "" = custom text.
  // Round 10: `perBox` scales units by the box quantity (default on — most
  // rows are per-box consumables like a sleeve or satin cloth); off = a flat
  // total for the whole order (e.g. a one-off item bought once for the job).
  type MiscRow = { sel: string; customLabel: string; L: number; W: number; units: number; price: number; perBox: boolean };
  const [miscItems, setMiscItems] = useState<MiscRow[]>([]);
  const [miscUnit, setMiscUnit] = useState<Unit>("in");

  // Customisations (handles / locks / window) — doc 2026-06-19
  const [handlesEnabled, setHandlesEnabled] = useState(false);
  const [handleType, setHandleType] = useState("");
  const [handleCount, setHandleCount] = useState(1);
  const [locksEnabled, setLocksEnabled] = useState(false);
  const [lockType, setLockType] = useState("");
  const [lockCount, setLockCount] = useState(1);
  const [windowEnabled, setWindowEnabled] = useState(false);
  const [windowMaterial, setWindowMaterial] = useState("");
  const [windowL, setWindowL] = useState(0);
  const [windowW, setWindowW] = useState(0);

  // Labour + charges
  const [labourLines, setLabourLines] = useState<LabourRow[]>([]);
  // Glue / metlock (client 21-Jul: "either select bottles or cost itself").
  // "cost" = type the rupee amount (original behaviour, with the per-box
  // toggle); "qty" = count × rate, which also reports a real quantity on the
  // raw-material sheet.
  const [glueTotal, setGlueTotal] = useState(0);
  const [gluePerBox, setGluePerBox] = useState(false);
  const [glueMode, setGlueMode] = useState<"cost" | "qty">("cost");
  const [glueQty, setGlueQty] = useState(0);
  const [glueUnit, setGlueUnit] = useState("litres");
  const [glueRate, setGlueRate] = useState(0);
  const [metlockTotal, setMetlockTotal] = useState(0);
  const [metlockPerBox, setMetlockPerBox] = useState(false);
  const [metlockMode, setMetlockMode] = useState<"cost" | "qty">("cost");
  const [metlockQty, setMetlockQty] = useState(0);
  const [metlockUnit, setMetlockUnit] = useState("bottles");
  const [metlockRate, setMetlockRate] = useState(0);
  const [tapeTotal, setTapeTotal] = useState(0); // open-input tape override (e.g. collapsible)
  // Defaults ON: tape was always charged before this toggle existed, so a
  // fresh form has to behave the same way (see manual.tapeUsed in types).
  const [tapeUsed, setTapeUsed] = useState(true);
  // Additional charges (no margin): Die / Mould / Block each have qty + unit price; shown separately on PDF.
  const [addlDieQty, setAddlDieQty] = useState(0);
  const [addlDiePrice, setAddlDiePrice] = useState(0);
  const [addlMouldQty, setAddlMouldQty] = useState(0);
  const [addlMouldPrice, setAddlMouldPrice] = useState(0);
  const [addlBlockQty, setAddlBlockQty] = useState(0);
  const [addlBlockPrice, setAddlBlockPrice] = useState(0);
  const [addlDesigner, setAddlDesigner] = useState(0);
  // Quoted as their own line (default, client 28-Jul) or divided into every box.
  const [additionalMode, setAdditionalMode] = useState<"separate" | "included">("separate");
  const [overheadPct, setOverheadPct] = useState("");
  const [marginPct, setMarginPct] = useState("");

  // Flow
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  // The button's success state is momentary — it celebrates, then hands the
  // button back so a second save isn't blocked by a stale "Saved". The lasting
  // record (id + link) stays in the notice underneath.
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), SAVED_HOLD_MS);
    return () => clearTimeout(t);
  }, [justSaved]);
  const saveState = saving ? "saving" : justSaved ? "saved" : "idle";
  // Shake the job card when calculate / save reports an error.
  const { ref: jobCardRef, shake: shakeJobCard } = useShake<HTMLDivElement>();
  useEffect(() => {
    if (error) shakeJobCard();
  }, [error, shakeJobCard]);

  // Hydrate all form state from a saved specs_snapshot (edit / re-run flow).
  useEffect(() => {
    if (!initialSpecs) return;
    const s = initialSpecs;
    setClientId(s.clientId ?? "");
    setEstimateName(s.name ?? "");
    setBoxType(s.boxType);
    setDims(s.dims);
    setQuantity(s.quantity);
    setProductionQty(
      s.productionQuantity != null && s.productionQuantity > s.quantity
        ? String(s.productionQuantity)
        : "",
    );
    setBoardThickness(s.boardThickness_mm);
    setVars(s.vars ?? defaultVars(s.boxType));
    setUnit("in"); // specs are stored in inches

    const outer = s.wrapping?.outer;
    if (outer?.mode === "printed") {
      setOuterMode("printed");
      // Auto printing (round 5): the snapshot keeps auto:true (no sizes) so a
      // re-run re-optimizes — hydrate the selects back to the Auto option.
      setOuterPaperSize(outer.printing.auto ? "" : outer.paperSizeLabel ?? "");
      setOuterGsm(outer.gsm);
      setFolding(outer.foldingAllowance_mm ?? 20);
      setPrintingType(outer.printing.type);
      setPrintingSize(outer.printing.auto ? AUTO_SIZE : outer.printing.sizeLabel ?? "");
      setPrintingColour(outer.printing.colour ?? "multi");
      setPrintingVendor(outer.printing.vendor ?? "");
      setWastagePctStr(outer.wastagePctOverride != null ? String(outer.wastagePctOverride) : "");
    } else if (outer?.mode === "special") {
      setOuterMode("special");
      setSpecialSel(`${outer.specialPaperName}|${outer.specialSizeLabel}`);
      setFolding(outer.foldingAllowance_mm ?? 20);
    } else {
      setOuterMode("none");
    }

    // Inner lining — mode-aware hydration. Legacy snapshots (no mode): with
    // printing -> Printed; plain (no printing) -> White with the same size/GSM
    // (the white grid is seeded to match the paper grid, so the row exists).
    // Per-component wraps (client item 2) — absent on every pre-round-7 snapshot.
    const perComp = s.wrapping?.perComponent;
    setPerComponentOn(perComp != null && Object.keys(perComp).length > 0);
    setComponentWraps(
      Object.fromEntries(
        Object.entries(perComp ?? {}).map(([c, cw]) => [c, componentWrapFromSelection(cw, null)]),
      ),
    );

    const inner = s.wrapping?.inner;
    if (!inner) {
      setInnerMode("none");
    } else if (inner.mode === "special") {
      setInnerMode("special");
      setInnerSpecialSel(`${inner.specialPaperName}|${inner.specialSizeLabel}`);
      if (inner.sheetOverride) {
        setInnerSpecialSheetW(inner.sheetOverride.width_in);
        setInnerSpecialSheetH(inner.sheetOverride.height_in);
      }
    } else if (inner.mode === "white") {
      setInnerMode("white");
      setInnerWhiteSize(inner.paperSizeLabel);
      setInnerWhiteGsm(inner.gsm);
    } else if (inner.printing) {
      setInnerMode("printed");
      setInnerPaperSize(inner.printing.auto ? "" : inner.paperSizeLabel ?? "");
      setInnerGsm(inner.gsm);
      setInnerPrintingType(inner.printing.type);
      setInnerPrintingSize(inner.printing.auto ? AUTO_SIZE : inner.printing.sizeLabel ?? "");
      setInnerPrintingColour(inner.printing.colour ?? "multi");
      setInnerPrintingVendor(inner.printing.vendor ?? "");
    } else {
      setInnerMode("white");
      setInnerWhiteSize(inner.paperSizeLabel ?? "");
      setInnerWhiteGsm(inner.gsm);
    }
    setInnerFinish(fromFinishingSelections(inner?.finishing));

    // Outer finishing (EstimateRequest.finishing has always meant the outer wrap).
    setOuterFinish(fromFinishingSelections(s.finishing));

    // Sections (partial estimate) are no longer user-editable — always all-on.
    setNestingMode(s.nestingMode ?? "auto");
    setPrintingMode(s.printingMode ?? "combined");

    // Foam: new snapshots carry `foams[]`; old ones a single `foam`.
    const foamSels = s.inserts?.foams ?? (s.inserts?.foam ? [s.inserts.foam] : []);
    setFoamEnabled(foamSels.length > 0);
    setFoamItems(
      foamSels.map((f) => ({
        sel: `${f.type}|${f.thickness_mm}`,
        L: f.insert.length_in,
        W: f.insert.width_in,
        punchingMargin_mm: f.punchingMargin_mm ?? 0,
        cover: {
          enabled: !!f.cover && (f.cover.top || f.cover.bottom),
          top: f.cover?.top ?? true,
          bottom: f.cover?.bottom ?? true,
          material: f.cover?.material ?? "art_paper",
          // Legacy snapshots carry no boardType — every board row predating the
          // Type column was migrated to DEFAULT_BOARD_TYPE (see types/index.ts).
          boardType: f.cover?.boardType ?? DEFAULT_BOARD_TYPE,
          paperSize: f.cover?.paperSizeLabel ?? "",
          gsm: f.cover?.gsm ?? 0,
          specialSel:
            f.cover?.specialPaperName && f.cover.specialSizeLabel
              ? `${f.cover.specialPaperName}|${f.cover.specialSizeLabel}`
              : "",
          specialSheetW: f.cover?.sheetOverride?.width_in ?? 0,
          specialSheetH: f.cover?.sheetOverride?.height_in ?? 0,
          printingEnabled: !!f.cover?.printing,
          printingType: f.cover?.printing?.type ?? "offset",
          printingSize: f.cover?.printing?.sizeLabel ?? "",
          printingColour: f.cover?.printing?.colour ?? "multi",
          finish: fromFinishingSelections(f.cover?.finishing),
        },
      })),
    );

    const rev = s.inserts?.reverseBoard;
    setRevEnabled(!!rev);
    if (rev) {
      setRevThickness(rev.thickness_mm);
      setRevInsertHeight(rev.insertHeight_in);
      setRevTopEnabled(!!rev.topPaper);
      if (rev.topPaper) { setRevTopSize(rev.topPaper.paperSizeLabel); setRevTopGsm(rev.topPaper.gsm); }
    }

    setCardEnabled(!!s.inserts?.card);
    setAdjustments(s.adjustments ?? []);
    if (s.inserts?.card) {
      setCardTotal(s.inserts.card.total);
      setCardL(s.inserts.card.size?.length_in ?? 0);
      setCardW(s.inserts.card.size?.width_in ?? 0);
      setCardMaterial(s.inserts.card.materialType ?? "");
      setCardGsm(s.inserts.card.gsm ?? 0);
    }
    if (s.inserts?.ribbonTagSizeLabel) setRibbonSize(s.inserts.ribbonTagSizeLabel);

    // Round-5 inserts (client 13-Jul) — defensive: absent on old snapshots.
    // Sleeve (reworked round 6): `stock` replaces the old board+wrap shape; a
    // round-5 test snapshot without `stock` falls back to stock defaults.
    const sv = s.inserts?.sleeve;
    setSleeveEnabled(!!sv);
    if (sv) {
      setSleeveL(sv.dims.length_in);
      setSleeveW(sv.dims.width_in);
      setSleeveH(sv.dims.height_in);
      setSleeveStock(cardStockFromSelection(sv.stock, null));
      setSleeveFinish(fromFinishingSelections(sv.stock?.finishing));
    }
    const bd = s.inserts?.beading;
    setBeadingEnabled(!!bd);
    if (bd) {
      setBeadingBH(bd.height_in);
      setBeadingBT(bd.thickness_in);
      setBeadingStock(cardStockFromSelection(bd.stock, null));
    }
    const cp = s.inserts?.cardPartitions;
    setPartsEnabled(!!cp);
    if (cp) {
      setPartsCountL(cp.countL);
      setPartsCountW(cp.countW);
      setPartsStock(cardStockFromSelection(cp.stock, null));
    }
    const xp = s.inserts?.customPartition;
    setCustomPartEnabled(!!xp);
    if (xp) {
      setCustomPartL(xp.size.length_in);
      setCustomPartW(xp.size.width_in);
      setCustomPartCount(xp.count);
      setCustomPartStock(cardStockFromSelection(xp.stock, null));
    }

    const acc = s.accessories;
    if (acc) {
      setMagnetsPerBox(acc.magnetsPerBox ?? 0);
      if (acc.magnetDiameter_mm && acc.magnetThickness_mm)
        setMagnetSel(`${acc.magnetDiameter_mm}|${acc.magnetThickness_mm}`);
      if (acc.washerName) setWasherName(acc.washerName);
    }

    const handles = s.addons?.handles;
    setHandlesEnabled(!!handles);
    if (handles) { setHandleType(handles.type); setHandleCount(handles.count); }

    const locks = s.addons?.locks;
    setLocksEnabled(!!locks);
    if (locks) { setLockType(locks.type); setLockCount(locks.count); }

    const win = s.addons?.window;
    setWindowEnabled(!!win);
    if (win) {
      setWindowMaterial(win.name);
      setWindowL(win.size.length_in);
      setWindowW(win.size.width_in);
    }

    // Misc add-ons (client 8-Jul). `sel` holds the label; the dropdown falls
    // back to Custom + free text when the label isn't a known option.
    setMiscItems(
      (s.addons?.misc ?? []).map((m) => ({
        sel: m.label,
        customLabel: m.label,
        L: m.size?.length_in ?? 0,
        W: m.size?.width_in ?? 0,
        units: m.units,
        price: m.pricePerUnit,
        perBox: m.perBox ?? false,
      })),
    );

    setLabourLines(s.labour?.map((l) => ({ role: l.role, unit: l.unit, quantity: l.quantity })) ?? []);
    setGlueTotal(s.manual?.glueTotal ?? 0);
    setMetlockTotal(s.manual?.metlockTotal ?? 0);
    setTapeTotal(s.manual?.tapeTotal ?? 0);
    // Absent on every snapshot saved before the toggle -> tape was used.
    setTapeUsed(s.manual?.tapeUsed ?? true);
    // Quantity mode is remembered when the snapshot carries a count.
    const gq = s.manual?.glueQty;
    setGlueMode(gq ? "qty" : "cost");
    if (gq) { setGlueQty(gq.qty); setGlueUnit(gq.unit); setGlueRate(gq.rate); }
    const mq = s.manual?.metlockQty;
    setMetlockMode(mq ? "qty" : "cost");
    if (mq) { setMetlockQty(mq.qty); setMetlockUnit(mq.unit); setMetlockRate(mq.rate); }
    // Die / Mould / Block: round-3 snapshots store {qty, rate}; legacy ones a
    // pre-multiplied total (hydrated as qty=1, price=total).
    const hydrateCharge = (
      line: number | { qty: number; rate: number } | undefined,
      setQty: (n: number) => void,
      setPrice: (n: number) => void,
    ) => {
      if (line == null) { setQty(0); setPrice(0); }
      else if (typeof line === "number") { setQty(line > 0 ? 1 : 0); setPrice(line); }
      else { setQty(line.qty); setPrice(line.rate); }
    };
    hydrateCharge(s.additional?.die, setAddlDieQty, setAddlDiePrice);
    hydrateCharge(s.additional?.mould, setAddlMouldQty, setAddlMouldPrice);
    hydrateCharge(s.additional?.block, setAddlBlockQty, setAddlBlockPrice);
    setAddlDesigner(s.additional?.designer ?? 0);
    // Pre-28-Jul snapshots have no mode and DID divide the charges into every
    // box — hydrate them as "included" so a re-opened estimate shows what it
    // actually did rather than silently re-pricing.
    setAdditionalMode(s.additionalMode ?? "included");
    if (s.overheadPct != null) setOverheadPct(String(s.overheadPct));
    if (s.marginPct != null) setMarginPct(String(s.marginPct));
  }, [initialSpecs]);

  useEffect(() => {
    (async () => {
      try {
        // Server-rendered when the page could load it; only fall back to the
        // network when it could not. Either way the default-seeding below is
        // unchanged — it is the same `o`, from the same loader.
        let o = initialOptions;
        if (!o) {
          const res = await fetch("/api/rates/options");
          if (!res.ok) return;
          o = (await res.json()) as RateOptions;
          setOptions(o);
        }
        // Skip defaults when pre-populated from a saved estimate — those values are already set.
        if (!initialSpecs) {
          if (o.paper[0]) {
            setOuterPaperSize(o.paper[0].sizeLabel);
            setOuterGsm(o.paper[0].gsms[0]);
            setInnerPaperSize(o.paper[0].sizeLabel);
            setInnerGsm(o.paper[0].gsms[0]);
            setRevTopSize(o.paper[0].sizeLabel);
            setRevTopGsm(o.paper[0].gsms[0]);
          }
          if (o.offsetSizes[0]) { setPrintingSize(o.offsetSizes[0]); setInnerPrintingSize(o.offsetSizes[0]); }
          if (o.whitePaper[0]) {
            setInnerWhiteSize(o.whitePaper[0].sizeLabel);
            setInnerWhiteGsm(o.whitePaper[0].gsms[0]);
          }
          if (o.specialPaper[0]) {
            setSpecialSel(`${o.specialPaper[0].name}|${o.specialPaper[0].sizeLabel}`);
            setSpecialSheetW(o.specialPaper[0].sheetWidth_in);
            setSpecialSheetH(o.specialPaper[0].sheetHeight_in);
            setInnerSpecialSel(`${o.specialPaper[0].name}|${o.specialPaper[0].sizeLabel}`);
            setInnerSpecialSheetW(o.specialPaper[0].sheetWidth_in);
            setInnerSpecialSheetH(o.specialPaper[0].sheetHeight_in);
          }
          // The 1.5mm initial state is only a guess — fall back to a real row
          // when the rate card no longer carries it.
          if (o.board.length && !o.board.some((b) => b.thickness_mm === 1.5)) {
            setBoardThickness(o.board[0].thickness_mm);
          }
          if (o.reverseBoardThicknesses[0]) setRevThickness(o.reverseBoardThicknesses[0]);
          if (o.magnets[0]) setMagnetSel(`${o.magnets[0].diameter_mm}|${o.magnets[0].thickness_mm}`);
          if (o.washers[0]) setWasherName(o.washers[0]);
          if (o.ribbonTags[0]) setRibbonSize(o.ribbonTags[0]);
          if (o.handles[0]) setHandleType(o.handles[0].type);
          if (o.locks[0]) setLockType(o.locks[0].type);
          if (o.windows[0]) setWindowMaterial(o.windows[0].name);
          // Round-5 inserts: seed material/print defaults from the rate card.
          setSleeveStock(defaultCardStock(o));
          setBeadingStock(defaultCardStock(o));
          setPartsStock(defaultCardStock(o));
          setCustomPartStock(defaultCardStock(o));
        }
      } catch {
        /* options stay null */
      }
    })();
  }, []);

  function changeBoxType(bt: BoxType) {
    setBoxType(bt);
    setVars(defaultVars(bt));
    setResult(null);
    setSavedId(null);
  }
  const setVar = (key: keyof BoxVariables, value: number) =>
    setVars((v) => ({ ...v, [key]: value }));
  const gsmsFor = (size: string) =>
    options?.paper.find((p) => p.sizeLabel === size)?.gsms ?? [];
  // Distinct GSMs across every paper size — the Auto print option keeps GSM
  // user-chosen while the server picks the sheet (round 5).
  const allGsms = [...new Set((options?.paper ?? []).flatMap((p) => p.gsms))].sort((a, b) => a - b);
  const printingSizes =
    printingType === "offset" ? options?.offsetSizes ?? [] : options?.digitalSizes ?? [];
  const innerPrintingSizes =
    innerPrintingType === "offset" ? options?.offsetSizes ?? [] : options?.digitalSizes ?? [];

  // --- Print size drives paper size (client doc Step 1) ---------------------
  // Parse a "23x36"-style size label into inches; null when it doesn't parse.
  const parseSize = (label: string): { w: number; h: number } | null => {
    const m = label.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/i);
    return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
  };
  // Paper sizes that can be cut down to the chosen print size (either
  // orientation). Falls back to ALL sizes when labels don't parse.
  const papersForPrint = (printLabel: string) => {
    const all = options?.paper ?? [];
    const p = parseSize(printLabel);
    if (!p) return all;
    const fit = all.filter((paper) => {
      const s = parseSize(paper.sizeLabel);
      if (!s) return false;
      return (p.w <= s.w && p.h <= s.h) || (p.h <= s.w && p.w <= s.h);
    });
    return fit.length > 0 ? fit : all;
  };
  // Smallest-area compatible paper — the auto-pick when the print size changes.
  const bestPaperForPrint = (printLabel: string): string => {
    const fit = papersForPrint(printLabel);
    let best = fit[0]?.sizeLabel ?? "";
    let bestArea = Infinity;
    for (const paper of fit) {
      const s = parseSize(paper.sizeLabel);
      const area = s ? s.w * s.h : Infinity;
      if (area < bestArea) { bestArea = area; best = paper.sizeLabel; }
    }
    return best;
  };
  // When a print size is picked, re-point the paper selection at the smallest
  // compatible sheet (keeping the current one if it still fits).
  const syncPaperToPrint = (printLabel: string, current: string, setSize: (s: string) => void, setG: (g: number) => void) => {
    const fit = papersForPrint(printLabel);
    if (fit.some((paper) => paper.sizeLabel === current)) return; // still compatible
    const next = bestPaperForPrint(printLabel);
    if (next) { setSize(next); setG(gsmsFor(next)[0] ?? 0); }
  };
  const addLabour = () =>
    setLabourLines((l) => [...l, { role: options?.labourRoles[0] ?? "", unit: "day", quantity: 1 }]);
  const updateLabour = (i: number, patch: Partial<LabourRow>) =>
    setLabourLines((l) => l.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeLabour = (i: number) =>
    setLabourLines((l) => l.filter((_, idx) => idx !== i));
  const addFoamRow = () => {
    if (!options) return;
    setFoamItems((fs) => [...fs, {
      sel: options.foam[0] ? `${options.foam[0].type}|${options.foam[0].thickness_mm}` : "",
      L: dims.length_in,
      W: dims.width_in,
      punchingMargin_mm: 0,
      cover: {
        enabled: false,
        top: true,
        bottom: true,
        material: "art_paper",
        boardType: options.artCard[0]?.type ?? DEFAULT_BOARD_TYPE,
        paperSize: options.paper[0]?.sizeLabel ?? "",
        gsm: options.paper[0]?.gsms[0] ?? 0,
        specialSel: options.specialPaper[0] ? `${options.specialPaper[0].name}|${options.specialPaper[0].sizeLabel}` : "",
        specialSheetW: options.specialPaper[0]?.sheetWidth_in ?? 0,
        specialSheetH: options.specialPaper[0]?.sheetHeight_in ?? 0,
        printingEnabled: false,
        printingType: "offset",
        printingSize: options.offsetSizes[0] ?? "",
        printingColour: "multi",
        finish: emptyFinishing(),
      },
    }]);
  };
  // Misc add-on rows (client 8-Jul): rate-card misc materials are preset
  // labels; "__custom" switches to free text. Price defaults from the misc
  // rate card but stays a manual open input. (Round 5: the old hardcoded
  // "Sleeve" preset is gone — Sleeve is a real insert now; legacy snapshots
  // with a misc Sleeve row hydrate as Custom text and still cost the same.)
  const addMiscRow = () =>
    setMiscItems((ms) => [...ms, {
      sel: options?.misc[0]?.name ?? "__custom", customLabel: "", L: 0, W: 0, units: 1,
      price: options?.misc[0]?.price ?? 0, perBox: true,
    }]);

  function buildRequest(): EstimateRequest {
    let outer: OuterWrap | undefined;
    if (outerMode === "printed") {
      const wastageNum = wastagePctStr.trim() === "" ? NaN : Number(wastagePctStr);
      // Auto print size (round 5): omit both sizes; the server enumerates every
      // option of the chosen type and freezes the cheapest into the snapshot.
      const auto = printingSize === AUTO_SIZE;
      outer = {
        mode: "printed",
        paperSizeLabel: auto ? undefined : outerPaperSize,
        gsm: outerGsm,
        foldingAllowance_mm: folding,
        printing: {
          type: printingType,
          sizeLabel: auto ? undefined : printingSize,
          colour: printingType === "offset" ? printingColour : undefined,
          auto: auto || undefined,
          vendor: printingVendor || undefined,
        },
        // Empty field = auto (app_config 10/15); a number overrides per estimate.
        wastagePctOverride: Number.isFinite(wastageNum) && wastageNum >= 0 ? wastageNum : undefined,
      };
    } else if (outerMode === "special") {
      const [name, size] = specialSel.split("|");
      outer = {
        mode: "special",
        specialPaperName: name,
        specialSizeLabel: size,
        foldingAllowance_mm: folding,
        sheetOverride: specialSheetW > 0 && specialSheetH > 0 ? { width_in: specialSheetW, height_in: specialSheetH } : undefined,
      };
    }
    // Inner lining by mode (client 2026-07). Each mode carries the inner's OWN
    // finishing selections; None sends no inner at all.
    const innerFinishing = toFinishingSelections(innerFinish);
    let inner: InnerWrap | undefined;
    if (innerMode === "white" && innerWhiteSize) {
      inner = {
        mode: "white",
        paperSizeLabel: innerWhiteSize,
        gsm: innerWhiteGsm,
        finishing: innerFinishing.length ? innerFinishing : undefined,
      };
    } else if (innerMode === "printed" && (innerPaperSize || innerPrintingSize === AUTO_SIZE)) {
      const innerAuto = innerPrintingSize === AUTO_SIZE;
      inner = {
        mode: "printed",
        paperSizeLabel: innerAuto ? undefined : innerPaperSize,
        gsm: innerGsm,
        printing: innerPrintingSize
          ? {
              type: innerPrintingType,
              sizeLabel: innerAuto ? undefined : innerPrintingSize,
              colour: innerPrintingType === "offset" ? innerPrintingColour : undefined,
              auto: innerAuto || undefined,
              vendor: innerPrintingVendor || undefined,
            }
          : undefined,
        finishing: innerFinishing.length ? innerFinishing : undefined,
      };
    } else if (innerMode === "special" && innerSpecialSel) {
      const [name, size] = innerSpecialSel.split("|");
      inner = {
        mode: "special",
        specialPaperName: name,
        specialSizeLabel: size,
        sheetOverride:
          innerSpecialSheetW > 0 && innerSpecialSheetH > 0
            ? { width_in: innerSpecialSheetW, height_in: innerSpecialSheetH }
            : undefined,
        finishing: innerFinishing.length ? innerFinishing : undefined,
      };
    }
    // Outer finishing — tied to the outer wrap (no outer wrap = no outer finishing).
    const finishingArr = outerMode !== "none" ? toFinishingSelections(outerFinish) : [];

    // Per-component wraps (client item 2): only components that actually
    // override something are sent, so identical parts keep sharing one group.
    let perComponentSelections: Record<string, ComponentWrap> | undefined;
    if (perComponentOn) {
      const entries = componentNames
        .map((c) => [c, componentWrapToSelection(componentWraps[c] ?? defaultComponentWrap(options))] as const)
        .filter(([, sel]) => sel != null) as [string, ComponentWrap][];
      if (entries.length) perComponentSelections = Object.fromEntries(entries);
    }

    const inserts: InsertsSelection = {};
    const foams = (foamEnabled ? foamItems : [])
      .filter((f) => f.sel && f.L > 0 && f.W > 0)
      .map((f) => {
        const [type, thickness] = f.sel.split("|");
        const c = f.cover;
        const coverFinishing = toFinishingSelections(c.finish);
        const cover =
          c.enabled && (c.top || c.bottom)
            ? {
                top: c.top,
                bottom: c.bottom,
                material: c.material,
                boardType: c.material === "art_card" ? c.boardType : undefined,
                paperSizeLabel: c.material !== "special" ? c.paperSize : undefined,
                gsm: c.material !== "special" ? c.gsm : undefined,
                specialPaperName: c.material === "special" ? c.specialSel.split("|")[0] : undefined,
                specialSizeLabel: c.material === "special" ? c.specialSel.split("|")[1] : undefined,
                sheetOverride:
                  c.material === "special" && c.specialSheetW > 0 && c.specialSheetH > 0
                    ? { width_in: c.specialSheetW, height_in: c.specialSheetH }
                    : undefined,
                printing:
                  c.printingEnabled && c.printingSize
                    ? {
                        type: c.printingType,
                        sizeLabel: c.printingSize,
                        colour: c.printingType === "offset" ? c.printingColour : undefined,
                      }
                    : undefined,
                finishing: coverFinishing.length ? coverFinishing : undefined,
              }
            : undefined;
        return {
          type: type as "XLPE" | "EPE" | "PU",
          thickness_mm: Number(thickness),
          insert: { length_in: f.L, width_in: f.W },
          punchingMargin_mm: f.punchingMargin_mm > 0 ? f.punchingMargin_mm : undefined,
          cover,
        };
      });
    if (foams.length) inserts.foams = foams;
    if (revEnabled) {
      inserts.reverseBoard = {
        thickness_mm: revThickness,
        insertHeight_in: revInsertHeight,
        topPaper: revTopEnabled ? { paperSizeLabel: revTopSize, gsm: revTopGsm } : undefined,
      };
    }
    if (cardEnabled && cardTotal > 0) {
      inserts.card = {
        total: cardTotal,
        size: cardL > 0 && cardW > 0 ? { length_in: cardL, width_in: cardW } : undefined,
        materialType: cardMaterial.trim() || undefined,
        gsm: cardGsm > 0 ? cardGsm : undefined,
      };
    }
    if (RIBBON_BOXES.has(boxType) && ribbonSize) inserts.ribbonTagSizeLabel = ribbonSize;

    // Round-5 inserts (client 13-Jul; sleeve = card stock since round 6).
    if (sleeveEnabled && sleeveL > 0 && sleeveW > 0 && sleeveH > 0) {
      const sleeveFinishing = toFinishingSelections(sleeveFinish);
      const { lamination: _lam, ...stockSel } = cardStockToSelection(sleeveStock);
      void _lam; // the sleeve carries full finishing instead
      inserts.sleeve = {
        dims: { length_in: sleeveL, width_in: sleeveW, height_in: sleeveH },
        stock: {
          ...stockSel,
          finishing: sleeveFinishing.length ? sleeveFinishing : undefined,
        },
      };
    }
    if (beadingEnabled && beadingBH > 0 && beadingBT > 0) {
      inserts.beading = {
        height_in: beadingBH,
        thickness_in: beadingBT,
        stock: cardStockToSelection(beadingStock),
      };
    }
    if (partsEnabled && partsCountL + partsCountW > 0) {
      inserts.cardPartitions = {
        countL: partsCountL,
        countW: partsCountW,
        stock: cardStockToSelection(partsStock),
      };
    }
    if (customPartEnabled && customPartL > 0 && customPartW > 0 && customPartCount > 0) {
      inserts.customPartition = {
        size: { length_in: customPartL, width_in: customPartW },
        count: customPartCount,
        stock: cardStockToSelection(customPartStock),
      };
    }

    let accessories: EstimateRequest["accessories"];
    if (MAGNET_BOXES.has(boxType) && magnetsPerBox > 0 && magnetSel) {
      const [d, t] = magnetSel.split("|").map(Number);
      accessories = { magnetsPerBox, magnetDiameter_mm: d, magnetThickness_mm: t, washerName };
    }

    const addonsObj: NonNullable<EstimateRequest["addons"]> = {};
    if (handlesEnabled && handleType && handleCount > 0)
      addonsObj.handles = { type: handleType, count: handleCount };
    if (locksEnabled && lockType && lockCount > 0)
      addonsObj.locks = { type: lockType, count: lockCount };
    if (windowEnabled && windowMaterial && windowL > 0 && windowW > 0)
      addonsObj.window = {
        name: windowMaterial,
        size: { length_in: windowL, width_in: windowW },
        // Always 10mm, automatic (client final doc item 4C) — build-estimate
        // re-forces this server-side regardless, this is just so the payload
        // is self-documenting and the live preview matches what gets charged.
        punchingMargin_mm: WINDOW_PUNCHING_MARGIN_MM,
      };
    // Misc add-ons (client 8-Jul): each valid row = a manual line (units × price,
    // × quantity when perBox is on — round 10).
    const miscLines = miscItems
      .map((m) => ({
        label: (m.sel === "__custom" ? m.customLabel : m.sel).trim(),
        size: m.L > 0 && m.W > 0 ? { length_in: m.L, width_in: m.W } : undefined,
        units: m.units,
        pricePerUnit: m.price,
        perBox: m.perBox,
      }))
      .filter((m) => m.label && m.units > 0 && m.pricePerUnit > 0);
    if (miscLines.length) addonsObj.misc = miscLines;
    const addons = Object.keys(addonsObj).length ? addonsObj : undefined;

    const labour: LabourSelection[] = labourLines.filter((l) => l.role && l.quantity > 0);
    // Glue/metlock: quantity mode resolves count × rate; cost mode takes the
    // entered value as per-box when its toggle is on, else as a total.
    const glueResolved =
      glueMode === "qty" ? glueQty * glueRate : gluePerBox ? glueTotal * quantity : glueTotal;
    const metlockResolved =
      metlockMode === "qty"
        ? metlockQty * metlockRate
        : metlockPerBox
          ? metlockTotal * quantity
          : metlockTotal;
    const manual =
      glueResolved > 0 || metlockResolved > 0 || tapeTotal > 0 || !tapeUsed
        ? {
            glueTotal: glueResolved || undefined,
            metlockTotal: metlockResolved || undefined,
            // Amount is meaningless with the toggle off, so it is not sent.
            tapeTotal: tapeUsed ? tapeTotal || undefined : undefined,
            // OMITTED when tape is used, so a snapshot taken before this
            // toggle existed and one taken now are byte-identical.
            tapeUsed: tapeUsed ? undefined : false,
            glueQty:
              glueMode === "qty" && glueQty > 0
                ? { qty: glueQty, unit: glueUnit, rate: glueRate }
                : undefined,
            metlockQty:
              metlockMode === "qty" && metlockQty > 0
                ? { qty: metlockQty, unit: metlockUnit, rate: metlockRate }
                : undefined,
          }
        : undefined;
    // Round 3: send qty + rate (not the product) so the PDF can itemize
    // "Die (2 × ₹1,500)". Legacy snapshots with flat totals still hydrate.
    const charge = (qty: number, price: number) =>
      qty > 0 && price > 0 ? { qty, rate: price } : undefined;
    const addlDie = charge(addlDieQty, addlDiePrice);
    const addlMould = charge(addlMouldQty, addlMouldPrice);
    const addlBlock = charge(addlBlockQty, addlBlockPrice);
    const additional =
      addlDie || addlMould || addlBlock || addlDesigner > 0
        ? {
            die: addlDie,
            mould: addlMould,
            block: addlBlock,
            designer: addlDesigner || undefined,
          }
        : undefined;

    // For shoulder / hinge-lid: height is fully defined by BH + NH; H input is hidden.
    // Auto-compute height_in so the API validation (requires positive) passes.
    const HIDE_H = new Set<BoxType>(["shoulder", "hinge_lid"]);
    const resolvedDims =
      HIDE_H.has(boxType)
        ? {
            ...dims,
            height_in: (vars.bottomHeight_in ?? 0) + (vars.neckHeight_in ?? 0),
          }
        : dims;

    return {
      boxType,
      clientId: clientId || undefined,
      name: estimateName.trim() || undefined,
      sourceEstimateId,
      dims: resolvedDims,
      vars: varsWithFit,
      quantity,
      // Production run (client item 3) — omitted when it matches the order.
      productionQuantity: prodQtyValue > quantity ? prodQtyValue : undefined,
      boardThickness_mm: boardThickness,
      // Partial estimate: excluded sections' selections are omitted from the
      // request (and re-enforced server-side); toggles ride in the snapshot.
      sections: { board: secBoard, wrapping: secWrapping, inserts: secInserts },
      nestingMode,
      adjustments: adjustments.length ? adjustments : undefined,
      // Mixed-orientation nesting; old snapshots (no field) keep the pure-grid
      // model they were costed with. v2 = board + wrap layers + card stocks
      // (round 5); v3 = also foam, foam covers and window film (21-Jul).
      nestingVersion: 3,
      // Inner-lining model (round 10): a magnetic case is lined across flap +
      // one panel + spine only. Its own version, so round-5..9 estimates keep
      // the full-keyline lining they were quoted with.
      liningVersion: 2,
      printingMode,
      wrapping:
        secWrapping && (outer || inner || perComponentSelections)
          ? { outer, inner, perComponent: perComponentSelections }
          : undefined,
      finishing: secWrapping && finishingArr.length ? finishingArr : undefined,
      inserts: secInserts && Object.keys(inserts).length ? inserts : undefined,
      accessories: secInserts ? accessories : undefined,
      addons: secInserts ? addons : undefined,
      labour: labour.length ? labour : undefined,
      manual,
      additional,
      additionalMode,
      overheadPct: overheadPct.trim() === "" ? undefined : Number(overheadPct),
      marginPct: marginPct.trim() === "" ? undefined : Number(marginPct),
    };
  }

  async function submit(path: string, after: (data: Record<string, unknown>) => void) {
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequest()),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Request failed.");
      else after(data);
    } catch {
      setError("Network error — could not reach the server.");
    }
  }
  async function calculate() {
    setLoading(true);
    setSavedId(null);
    setJustSaved(false);
    await submit("/api/estimate/calculate", (d) => setResult(d as Result));
    setLoading(false);
  }
  async function save() {
    setSaving(true);
    // Only set on the success path — submit() runs this callback exclusively
    // when the POST came back OK, so a failed save never shows the tick.
    await submit("/api/estimate", (d) => {
      setSavedId(d.id as string);
      setJustSaved(true);
      setResult({
        materials: d.materials as MaterialQuantities,
        cost: d.cost as ResultCost,
        autoPicks: d.autoPicks as AutoPickInfo[] | undefined,
      });
    });
    setSaving(false);
  }

  // Manual line edits (item 9): editing re-runs the calculation so overhead,
  // margin and the box price follow. Effect-driven because buildRequest() reads
  // state — calling calculate() inline would submit the pre-edit values.
  const didMountAdj = useRef(false);
  useEffect(() => {
    if (!didMountAdj.current) { didMountAdj.current = true; return; }
    if (!result) return;
    void calculate();
    // calculate/result are re-created each render; re-running on them would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustments]);

  function editLine(line: AdjustableLine, to: number, basis: number) {
    setAdjustments((prev) => {
      const rest = prev.filter((a) => a.line !== line);
      // `basis` freezes what the engine computed when the edit was made, so a
      // later spec change can be detected and surfaced (see AppliedAdjustment).
      return [...rest, { line, to, basis }];
    });
  }
  function resetLine(line: AdjustableLine) {
    setAdjustments((prev) => prev.filter((a) => a.line !== line));
  }

  const Keyline = keylineComponents[boxType];
  const HIDE_H_TYPES = new Set<BoxType>(["shoulder", "hinge_lid"]);
  const hideH = HIDE_H_TYPES.has(boxType);
  const dimsValid =
    dims.length_in > 0 &&
    dims.width_in > 0 &&
    (hideH
      ? (vars.bottomHeight_in ?? 0) + (vars.neckHeight_in ?? 0) > 0
      : dims.height_in > 0) &&
    (secBoard || secWrapping || secInserts);

  // Engine-1 input for the LIVE nesting preview (right column). Engine 1 is pure,
  // so we build the same MaterialInput the server assembles in build-estimate.ts,
  // but source sheet sizes from RateOptions instead of resolved rates — nesting
  // needs geometry only, no cost data. null until options load / spec is valid;
  // each optional material is included only when its sheet dims are known (>0).
  const previewInput = useMemo<MaterialInput | null>(() => {
    if (!options || !dimsValid) return null;
    const boardRow = options.board.find((b) => b.thickness_mm === boardThickness);
    if (!boardRow) return null; // board sheet size is required to nest anything

    const previewDims = hideH
      ? { ...dims, height_in: (vars.bottomHeight_in ?? 0) + (vars.neckHeight_in ?? 0) }
      : dims;
    const sheetOf = (label: string) => {
      const s = parseSize(label);
      return s ? { width_in: s.w, height_in: s.h } : null;
    };

    const input: MaterialInput = {
      boxType,
      dims: previewDims,
      vars: varsWithFit,
      // The preview nests the PRODUCTION run, like the server (client item 3).
      quantity: prodQtyValue > quantity ? prodQtyValue : quantity,
      board: { sheet: { width_in: boardRow.sheetWidth_in, height_in: boardRow.sheetHeight_in } },
      // Reflect the board-cutting choice in the live preview (client 7-Jul).
      combine: nestingMode !== "single",
      // Round 5: the form always estimates at nesting version 2 (mixed), and
      // separate printing un-shares the wrap layers, exactly like the server.
      mixed: true,
      // Round 10: preview the same inner-lining model the server will use, or
      // the drawn inner sheet would not match the calculated one.
      liningVersion: 2,
      printingMode,
    };

    // Outer wrap: printed (paper + print size drives nesting) or special paper.
    // Gated on the wrapping section toggle (partial estimates). Under AUTO
    // print size the server picks print + paper on Calculate — the preview has
    // no sheet to nest on, so the layer is omitted (LiveNesting explains).
    if (secWrapping && outerMode === "printed" && printingSize !== AUTO_SIZE) {
      const sheet = sheetOf(outerPaperSize);
      if (sheet) {
        input.outerPaper = {
          sheet,
          foldingAllowance_mm: folding,
          printSheet: sheetOf(printingSize) ?? undefined,
          // wastagePct omitted: the preview shows base counts (see LiveNesting note).
        };
      }
    } else if (secWrapping && outerMode === "special" && specialSheetW > 0 && specialSheetH > 0) {
      input.outerPaper = {
        sheet: { width_in: specialSheetW, height_in: specialSheetH },
        foldingAllowance_mm: folding,
      };
    }

    // Inner lining — sheet per mode (white/printed labels parse; special uses
    // the override dims mirrored from the rate card).
    if (secWrapping && innerMode === "white") {
      const sheet = sheetOf(innerWhiteSize);
      if (sheet) input.innerPaper = { sheet };
    } else if (secWrapping && innerMode === "printed" && innerPrintingSize !== AUTO_SIZE) {
      const sheet = sheetOf(innerPaperSize);
      if (sheet) {
        input.innerPaper = {
          sheet,
          printSheet: sheetOf(innerPrintingSize) ?? undefined,
        };
      }
    } else if (secWrapping && innerMode === "special" && innerSpecialSheetW > 0 && innerSpecialSheetH > 0) {
      input.innerPaper = { sheet: { width_in: innerSpecialSheetW, height_in: innerSpecialSheetH } };
    }

    // Per-component wraps (client item 2) — the preview groups them exactly
    // like the server, so parts configured differently show separate layouts.
    if (secWrapping && perComponentOn) {
      const outerBy: NonNullable<MaterialInput["outerPaperByComponent"]> = {};
      const innerBy: NonNullable<MaterialInput["innerPaperByComponent"]> = {};
      for (const c of componentNames) {
        const st = componentWraps[c];
        if (!st?.enabled) continue;
        if (st.outerMode === "printed") {
          const sheet = sheetOf(st.outerPaperSize);
          if (sheet) {
            outerBy[c] = {
              sheet,
              printSheet: sheetOf(st.outerPrintSize) ?? undefined,
              foldingAllowance_mm: folding,
            };
          }
        } else if (st.outerMode === "special" && st.outerSpecialW > 0 && st.outerSpecialH > 0) {
          outerBy[c] = {
            sheet: { width_in: st.outerSpecialW, height_in: st.outerSpecialH },
            foldingAllowance_mm: folding,
          };
        }
        if (st.innerMode === "white") {
          const sheet = sheetOf(st.innerWhiteSize);
          if (sheet) innerBy[c] = { sheet };
        } else if (st.innerMode === "printed") {
          const sheet = sheetOf(st.innerPaperSize);
          if (sheet) {
            innerBy[c] = {
              sheet,
              printSheet: st.innerPrintEnabled ? sheetOf(st.innerPrintSize) ?? undefined : undefined,
            };
          }
        } else if (st.innerMode === "special" && st.innerSpecialW > 0 && st.innerSpecialH > 0) {
          innerBy[c] = { sheet: { width_in: st.innerSpecialW, height_in: st.innerSpecialH } };
        }
      }
      if (Object.keys(outerBy).length) input.outerPaperByComponent = outerBy;
      if (Object.keys(innerBy).length) input.innerPaperByComponent = innerBy;
    }

    // Foam inserts (multiple; optional cover nests on its material's sheet,
    // or on the print sheet when the cover is printed).
    if (secInserts && foamEnabled) {
      const previewFoams = foamItems
        .filter((f) => f.sel && f.L > 0 && f.W > 0)
        .map((f) => {
          const fo = options.foam.find((x) => `${x.type}|${x.thickness_mm}` === f.sel);
          if (!fo) return null;
          const c = f.cover;
          let cover;
          if (c.enabled && (c.top || c.bottom)) {
            const coverSheet =
              c.material === "special"
                ? (() => {
                    const sp = options.specialPaper.find(
                      (p) => `${p.name}|${p.sizeLabel}` === c.specialSel,
                    );
                    return sp ? { width_in: sp.sheetWidth_in, height_in: sp.sheetHeight_in } : null;
                  })()
                : sheetOf(c.paperSize);
            if (coverSheet) {
              cover = {
                piecesPerBox: (c.top ? 1 : 0) + (c.bottom ? 1 : 0),
                sheet: coverSheet,
                printSheet:
                  c.printingEnabled && c.printingSize
                    ? sheetOf(c.printingSize) ?? undefined
                    : undefined,
              };
            }
          }
          return {
            insert: { length_in: f.L, width_in: f.W },
            sheet: { width_in: fo.sheetWidth_in, height_in: fo.sheetHeight_in },
            punchingMargin_mm: f.punchingMargin_mm > 0 ? f.punchingMargin_mm : undefined,
            cover,
          };
        })
        .filter((f): f is NonNullable<typeof f> => f != null);
      if (previewFoams.length) input.foams = previewFoams;
    }

    // Reverse-board insert (+ optional top paper).
    if (secInserts && revEnabled) {
      const rb = options.reverseBoard.find((r) => r.thickness_mm === revThickness);
      if (rb) {
        input.reverseBoard = {
          insertHeight_in: revInsertHeight,
          boardSheet: { width_in: rb.sheetWidth_in, height_in: rb.sheetHeight_in },
          topPaperSheet: revTopEnabled ? sheetOf(revTopSize) ?? undefined : undefined,
        };
      }
    }

    // Round-5 inserts: sleeve board + wrap, and the card-stock inserts. The
    // preview mirrors buildMaterialInput's blank builders exactly.
    const previewStock = (s: CardStockState) => {
      const sheet =
        s.material === "special"
          ? s.specialSheetW > 0 && s.specialSheetH > 0
            ? { width_in: s.specialSheetW, height_in: s.specialSheetH }
            : null
          : sheetOf(s.paperSize);
      if (!sheet) return null;
      return {
        sheet,
        printSheet:
          s.printingEnabled && s.printingSize ? sheetOf(s.printingSize) ?? undefined : undefined,
      };
    };
    if (secInserts && sleeveEnabled && sleeveL > 0 && sleeveW > 0 && sleeveH > 0) {
      // Round 6: the sleeve is a card-stock cut (no board component).
      const stock = previewStock(sleeveStock);
      if (stock) {
        input.sleeve = {
          blank: sleeveBlank(boxType, { length_in: sleeveL, width_in: sleeveW, height_in: sleeveH }),
          stock,
        };
      }
    }
    if (secInserts && beadingEnabled && beadingBH > 0 && beadingBT > 0) {
      const stock = previewStock(beadingStock);
      if (stock) {
        const side = beadingBH + beadingBT + beadingBH;
        input.beading = {
          blank: {
            component: "beading",
            width_in: side + previewDims.length_in + side,
            height_in: side + previewDims.width_in + side,
            count_per_box: 1,
          },
          stock,
        };
      }
    }
    if (secInserts && partsEnabled && partsCountL + partsCountW > 0) {
      const stock = previewStock(partsStock);
      if (stock) {
        const H2 = previewDims.height_in + previewDims.height_in;
        const blanks = [];
        if (partsCountL > 0) blanks.push({ component: "partition_l", width_in: H2, height_in: previewDims.length_in, count_per_box: partsCountL });
        if (partsCountW > 0) blanks.push({ component: "partition_w", width_in: H2, height_in: previewDims.width_in, count_per_box: partsCountW });
        input.cardPartitions = { blanks, stock };
      }
    }
    if (secInserts && customPartEnabled && customPartL > 0 && customPartW > 0 && customPartCount > 0) {
      const stock = previewStock(customPartStock);
      if (stock) {
        input.customPartition = {
          blank: { component: "custom_partition", width_in: customPartL, height_in: customPartW, count_per_box: customPartCount },
          stock,
        };
      }
    }

    // Window film (round 5: the punching allowance grows the nested piece).
    if (secInserts && windowEnabled && windowMaterial && windowL > 0 && windowW > 0) {
      const win = options.windows.find((w) => w.name === windowMaterial);
      if (win) {
        input.window = {
          footprint: { length_in: windowL, width_in: windowW },
          sheet: { width_in: win.filmWidth_in, height_in: win.filmHeight_in },
          punchingMargin_mm: WINDOW_PUNCHING_MARGIN_MM,
        };
      }
    }

    return input;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    options, dimsValid, boxType, dims, vars, quantity, prodQtyValue, boardThickness, hideH, nestingMode,
    perComponentOn, componentWraps, componentNames,
    printingMode, secBoard, secWrapping, secInserts,
    outerMode, outerPaperSize, printingSize, folding, specialSheetW, specialSheetH,
    innerMode, innerWhiteSize, innerPaperSize, innerPrintingSize,
    innerSpecialSheetW, innerSpecialSheetH,
    foamEnabled, foamItems,
    revEnabled, revThickness, revInsertHeight, revTopEnabled, revTopSize,
    windowEnabled, windowMaterial, windowL, windowW,
    sleeveEnabled, sleeveL, sleeveW, sleeveH, sleeveStock,
    beadingEnabled, beadingBH, beadingBT, beadingStock,
    partsEnabled, partsCountL, partsCountW, partsStock,
    customPartEnabled, customPartL, customPartW, customPartCount, customPartStock,
  ]);

  // Resolve the currently-selected add-ons into large preview tiles (shown beside
  // the keyline). Selection is by label, so map each label back to its rate-card
  // row for the id + hasImage flag.
  const addonPreviewItems: AddonPreviewItem[] = [];
  if (options) {
    if (handlesEnabled && handleType) {
      const row = options.handles.find((h) => h.type === handleType);
      addonPreviewItems.push({
        table: "handle_rates",
        id: row?.id,
        label: handleType,
        hasImage: row?.hasImage ?? false,
        caption: `× ${handleCount} / box`,
      });
    }
    if (locksEnabled && lockType) {
      const row = options.locks.find((l) => l.type === lockType);
      addonPreviewItems.push({
        table: "lock_rates",
        id: row?.id,
        label: lockType,
        hasImage: row?.hasImage ?? false,
        caption: `× ${lockCount} / box`,
      });
    }
    if (windowEnabled && windowMaterial) {
      const row = options.windows.find((w) => w.name === windowMaterial);
      addonPreviewItems.push({
        table: "window_rates",
        id: row?.id,
        label: windowMaterial,
        hasImage: row?.hasImage ?? false,
        caption: `${windowL} × ${windowW} in`,
      });
    }
  }

  const num =
    (set: (n: number) => void) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      set(Number(e.target.value));

  return (
    <div className="flex flex-col gap-6">
      {/* Who the estimate is for — part of the page header, not a costing step
          (client 13-Jul: "estimate name and client under New estimate, not
          under Box specifications — easier visual cue"). */}
      <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="estimateName">Estimate name (optional)</Label>
          <Input
            id="estimateName"
            value={estimateName}
            onChange={(e) => setEstimateName(e.target.value)}
            placeholder="e.g. Acme festive box — v2"
            maxLength={200}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Client (optional)</Label>
          <ClientCombobox
            clients={clients}
            value={clientId}
            onChange={setClientId}
            placeholder="Type to search clients…"
            noneLabel="— no client —"
          />
        </div>
      </div>

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,400px)]">
      {/* ---- Form: one surface, numbered sections ---- */}
      <div className="min-w-0">
        {/* 1 — Box specification */}
        <FormSection def={SECTIONS[0]} description="Internal dimensions. MOQ is 500.">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="boxType">Box type</Label>
              <NativeSelect id="boxType" value={boxType} onChange={(e) => changeBoxType(e.target.value as BoxType)}>
                {(Object.keys(BOX_LABELS) as BoxType[]).map((bt) => (
                  <option key={bt} value={bt}>{BOX_LABELS[bt]}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Dimensions (L × W{hideH ? "" : " × H"})</span>
                <Segmented
                  size="sm"
                  value={unit}
                  onValueChange={(u) => setUnit(u)}
                  options={(["in", "cm", "mm"] as Unit[]).map((u) => ({ value: u, label: u }))}
                />
              </div>
              <div className={`grid gap-3 ${hideH ? "grid-cols-2" : "grid-cols-3"}`}>
                {(["length_in", "width_in", "height_in"] as const).map((k, i) => {
                  if (k === "height_in" && hideH) return null;
                  return (
                    <div key={k} className="flex flex-col gap-1.5">
                      <Label htmlFor={k}>{["L", "W", "H"][i]}</Label>
                      <NumberField
                        id={k}
                        step={dimStep(unit)}
                        min="0"
                        value={toDim(dims[k], unit)}
                        onValueChange={(n) =>
                          setDims((d) => ({ ...d, [k]: fromDim(n, unit) }))
                        }
                      />
                    </div>
                  );
                })}
              </div>
              {hideH && (
                <p className="text-xs text-muted-foreground">
                  Height = BH + NH (set in the variables below — no separate H input needed).
                </p>
              )}
            </div>
            {(VAR_KEYS[boxType].length > 0 || boxType === "magnetic") && (
              <div className="grid grid-cols-3 gap-3">
                {VAR_KEYS[boxType].map((key) => (
                  <div key={key} className="flex flex-col gap-2">
                    <Label htmlFor={key}>{varLabel(key, unit)}</Label>
                    <NumberField id={key} step={dimStep(unit)} min="0"
                      value={toDim((vars[key] as number | undefined) ?? 0, unit)}
                      onValueChange={(n) => setVar(key, fromDim(n, unit))} />
                  </div>
                ))}
                {boxType === "magnetic" && (
                  <>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="panels">Panels</Label>
                      <NativeSelect id="panels" value={vars.panels ?? 4}
                        onChange={(e) => setVars((v) => ({ ...v, panels: Number(e.target.value) as 3 | 4 | 5 }))}>
                        <option value={3}>3-panel</option>
                        <option value={4}>4-panel (regular)</option>
                        <option value={5}>5-panel</option>
                      </NativeSelect>
                    </div>
                    {vars.panels === 5 && (
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="flapHeight_in">{varLabel("flapHeight_in", unit)}</Label>
                        <NumberField id="flapHeight_in" step={dimStep(unit)} min="0"
                          value={toDim(vars.flapHeight_in ?? 0, unit)}
                          onValueChange={(n) => setVar("flapHeight_in", fromDim(n, unit))} />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="qty">Ordered quantity</Label>
                <NumberField id="qty" step="1" min="1" value={quantity} onValueChange={setQuantity} />
              </div>
              {/* Production quantity (client final doc item 3): everything is
                  costed on the production run, then divided by the order. */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="prodQty">Production quantity</Label>
                <Input
                  id="prodQty"
                  type="number"
                  step="1"
                  min={quantity}
                  value={productionQty}
                  onChange={(e) => setProductionQty(e.target.value)}
                  placeholder={`Same as ordered (${quantity})`}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="thickness">Board thickness (mm)</Label>
                <NativeSelect id="thickness" value={boardThickness} onChange={num(setBoardThickness)}>
                  {(options?.board.length ? options.board.map((b) => b.thickness_mm) : BOARD_THICKNESSES)
                    .map((t) => <option key={t} value={t}>{t} mm</option>)}
                </NativeSelect>
              </div>
            </div>
            {prodQtyValue > quantity && (
              <p className="-mt-1 text-xs text-muted-foreground">
                Materials and costs are calculated for{" "}
                <strong className="text-foreground">{prodQtyValue.toLocaleString("en-IN")}</strong>{" "}
                boxes (wastage included); the per-box rate is quoted against the{" "}
                <strong className="text-foreground">{quantity.toLocaleString("en-IN")}</strong>{" "}
                ordered.
              </p>
            )}
            {productionQty.trim() !== "" && prodQtyValue > 0 && prodQtyValue < quantity && (
              <p className="-mt-1 text-xs text-destructive">
                Production quantity can&apos;t be less than the ordered quantity.
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Label>Board cutting</Label>
              <Segmented
                value={nestingMode}
                onValueChange={setNestingMode}
                options={[
                  { value: "auto", label: "Auto (combine when it saves sheets)" },
                  { value: "single", label: "Single components only" },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                Auto lets different parts share a sheet when that needs fewer sheets overall — never worse than cutting each part alone.
              </p>
            </div>
            {/* Print-job layout (round 5, client 13-Jul "combined printing"). */}
            <div className="flex flex-col gap-2">
              <Label>Printing layout</Label>
              <Segmented
                value={printingMode}
                onValueChange={setPrintingMode}
                options={[
                  { value: "combined", label: "Combined (parts share sheets)" },
                  { value: "separate", label: "Separate (one plate per part)" },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                Separate prints each part as its own job — the offset minimum is charged per part (roughly double for a lid + base), and parts stop sharing printed sheets.
              </p>
            </div>
          </div>
        </FormSection>

        {/* 2 — Wrapping, printing & finishing */}
        <FormSection
          def={SECTIONS[1]}
          description={options ? "Optional — None = a plain board box." : "Loading rate options…"}
        >
          {!secWrapping ? (
            <p className="text-sm text-muted-foreground">
              Excluded from this estimate — tick “Wrapping & printing” under “Estimate covers” to include it.
            </p>
          ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Outer wrap</Label>
              <Segmented
                value={outerMode}
                onValueChange={(m) => setOuterMode(m)}
                options={[
                  { value: "none", label: "None", disabled: !options },
                  { value: "printed", label: "Printed paper", disabled: !options },
                  { value: "special", label: "Special paper", disabled: !options },
                ]}
              />
            </div>
            {outerMode === "printed" && options && (
              <div className="grid grid-cols-2 gap-3">
                {/* Print size first — it determines what paper size is used (client doc Step 1). */}
                <div className="flex flex-col gap-2">
                  <Label>Printing</Label>
                  <Segmented
                    value={printingType}
                    onValueChange={(t) => {
                      setPrintingType(t);
                      const first = (t === "offset" ? options.offsetSizes : options.digitalSizes)[0] ?? "";
                      setPrintingSize(first);
                      if (first) syncPaperToPrint(first, outerPaperSize, setOuterPaperSize, setOuterGsm);
                    }}
                    options={[
                      { value: "offset", label: "Offset" },
                      { value: "digital", label: "Digital" },
                    ]}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Print sheet size</Label>
                  <NativeSelect value={printingSize} onChange={(e) => {
                    setPrintingSize(e.target.value);
                    if (e.target.value !== AUTO_SIZE) {
                      syncPaperToPrint(e.target.value, outerPaperSize, setOuterPaperSize, setOuterGsm);
                    }
                  }}>
                    {/* Auto (round 5): the server compares every size of this
                        printing type and freezes the cheapest into the estimate. */}
                    <option value={AUTO_SIZE}>Auto — cheapest option</option>
                    {printingSizes.map((s) => <option key={s} value={s}>{s}</option>)}
                  </NativeSelect>
                </div>
                {printingSize === AUTO_SIZE ? (
                  <div className="flex flex-col gap-2">
                    <Label>GSM</Label>
                    <NativeSelect value={outerGsm} onChange={num(setOuterGsm)}>
                      {allGsms.map((g) => <option key={g} value={g}>{g}</option>)}
                    </NativeSelect>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-2">
                      <Label>Paper size</Label>
                      <NativeSelect value={outerPaperSize} onChange={(e) => { setOuterPaperSize(e.target.value); setOuterGsm(gsmsFor(e.target.value)[0] ?? 0); }}>
                        {papersForPrint(printingSize).map((p) => <option key={p.sizeLabel} value={p.sizeLabel}>{p.sizeLabel}</option>)}
                      </NativeSelect>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>GSM</Label>
                      <NativeSelect value={outerGsm} onChange={num(setOuterGsm)}>
                        {gsmsFor(outerPaperSize).map((g) => <option key={g} value={g}>{g}</option>)}
                      </NativeSelect>
                    </div>
                  </>
                )}
                <p className="col-span-2 -mt-1 text-xs text-muted-foreground">
                  {printingSize === AUTO_SIZE
                    ? "Auto compares every print size of this type with every fitting paper sheet at the chosen GSM and picks the cheapest — shown after Calculate."
                    : "Paper sizes are limited to sheets the chosen print size can be cut from."}
                </p>
                {printingType === "offset" && (
                  <div className="col-span-2 flex flex-col gap-2">
                    <Label>Print colours</Label>
                    <Segmented
                      value={printingColour}
                      onValueChange={setPrintingColour}
                      options={[
                        { value: "multi", label: "Multicolour" },
                        {
                          value: "single",
                          label: "Single colour",
                          disabled: !options?.offsetSingleColour,
                        },
                      ]}
                    />
                    {!options?.offsetSingleColour && (
                      <p className="text-xs text-muted-foreground">
                        Single-colour rates aren&apos;t set up yet — run migration-offset-colour.sql.
                      </p>
                    )}
                  </div>
                )}
                <PrintVendorField
                  options={options}
                  type={printingType}
                  colour={printingColour}
                  sizeLabel={printingSize}
                  value={printingVendor}
                  onChange={setPrintingVendor}
                  idPrefix="outer"
                />
                <div className="flex flex-col gap-2">
                  <Label>Folding allowance (mm, per side)</Label>
                  <NumberField step="1" min="0" value={folding} onValueChange={setFolding} />
                  <p className="text-xs text-muted-foreground">
                    Added to every side — blank grows by 2×{folding}mm on each axis.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Printing wastage %</Label>
                  <Input type="number" step="1" min="0" value={wastagePctStr}
                    onChange={(e) => setWastagePctStr(e.target.value)}
                    placeholder="auto (10 / 15 with foil-UV)" />
                </div>
              </div>
            )}
            {outerMode === "special" && options && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label>Special paper</Label>
                  <NativeSelect value={specialSel} onChange={(e) => {
                    setSpecialSel(e.target.value);
                    // Update sheet size preview from the selected rate-card row.
                    const sp = options.specialPaper.find((p) => `${p.name}|${p.sizeLabel}` === e.target.value);
                    if (sp) { setSpecialSheetW(sp.sheetWidth_in); setSpecialSheetH(sp.sheetHeight_in); }
                  }}>
                    {options.specialPaper.map((s) => (
                      <option key={`${s.name}|${s.sizeLabel}`} value={`${s.name}|${s.sizeLabel}`}>{s.name} ({s.sizeLabel}{s.gsm != null ? `, ${s.gsm} GSM` : ""})</option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Folding allowance (mm, per side)</Label>
                  <NumberField step="1" min="0" value={folding} onValueChange={setFolding} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Sheet width (in)</Label>
                  <NumberField step="0.1" min="0" value={specialSheetW} onValueChange={setSpecialSheetW} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Sheet height (in)</Label>
                  <NumberField step="0.1" min="0" value={specialSheetH} onValueChange={setSpecialSheetH} />
                </div>
                <p className="col-span-2 text-xs text-muted-foreground -mt-1">Sheet size from rate card — editable if your batch differs.</p>
              </div>
            )}
            {/* Outer finishing — belongs to the outer wrap (client 2026-07). */}
            {outerMode !== "none" && options && (
              <div className="border-t pt-3">
                <FinishingPicker
                  label="Outer finishing"
                  options={options}
                  value={outerFinish}
                  onChange={setOuterFinish}
                  defaultArea={{ L: dims.length_in, W: dims.width_in }}
                />
              </div>
            )}

            {/* Inner lining — 4 modes (client 2026-07), each with its own finishing. */}
            <div className="flex flex-col gap-2 border-t pt-4">
              <Label>Inner lining</Label>
              <Segmented
                value={innerMode}
                onValueChange={(m) => setInnerMode(m)}
                options={[
                  { value: "none", label: "None", disabled: !options },
                  {
                    value: "white",
                    label: options && options.whitePaper.length === 0 ? "White (no rates yet)" : "White paper",
                    disabled: !options || options.whitePaper.length === 0,
                  },
                  { value: "printed", label: "Printed paper", disabled: !options },
                  { value: "special", label: "Special paper", disabled: !options },
                ]}
              />
              {innerMode === "white" && options && (
                <div className="grid grid-cols-2 gap-3">
                  <NativeSelect aria-label="White paper size" value={innerWhiteSize} onChange={(e) => { setInnerWhiteSize(e.target.value); setInnerWhiteGsm(options.whitePaper.find((p) => p.sizeLabel === e.target.value)?.gsms[0] ?? 0); }}>
                    {options.whitePaper.map((p) => <option key={p.sizeLabel} value={p.sizeLabel}>{p.sizeLabel}</option>)}
                  </NativeSelect>
                  <NativeSelect aria-label="White paper GSM" value={innerWhiteGsm} onChange={num(setInnerWhiteGsm)}>
                    {(options.whitePaper.find((p) => p.sizeLabel === innerWhiteSize)?.gsms ?? []).map((g) => <option key={g} value={g}>{g} gsm</option>)}
                  </NativeSelect>
                </div>
              )}
              {innerMode === "printed" && options && (
                <div className="grid grid-cols-2 gap-3">
                  <Segmented
                    value={innerPrintingType}
                    onValueChange={(t) => { setInnerPrintingType(t); setInnerPrintingSize(""); }}
                    options={[
                      { value: "offset", label: "Offset" },
                      { value: "digital", label: "Digital" },
                    ]}
                  />
                  <NativeSelect aria-label="Inner printing size" value={innerPrintingSize} onChange={(e) => {
                    setInnerPrintingSize(e.target.value);
                    // Print size drives the inner paper size too.
                    if (e.target.value && e.target.value !== AUTO_SIZE) {
                      syncPaperToPrint(e.target.value, innerPaperSize, setInnerPaperSize, setInnerGsm);
                    }
                  }}>
                    <option value={AUTO_SIZE}>Auto — cheapest option</option>
                    {innerPrintingSizes.map((s) => <option key={s} value={s}>{s}</option>)}
                  </NativeSelect>
                  {innerPrintingSize === AUTO_SIZE ? (
                    <NativeSelect aria-label="Inner paper GSM" value={innerGsm} onChange={num(setInnerGsm)}>
                      {allGsms.map((g) => <option key={g} value={g}>{g} gsm</option>)}
                    </NativeSelect>
                  ) : (
                    <>
                      <NativeSelect aria-label="Inner paper size" value={innerPaperSize} onChange={(e) => { setInnerPaperSize(e.target.value); setInnerGsm(gsmsFor(e.target.value)[0] ?? 0); }}>
                        {papersForPrint(innerPrintingSize).map((p) => <option key={p.sizeLabel} value={p.sizeLabel}>{p.sizeLabel}</option>)}
                      </NativeSelect>
                      <NativeSelect aria-label="Inner paper GSM" value={innerGsm} onChange={num(setInnerGsm)}>
                        {gsmsFor(innerPaperSize).map((g) => <option key={g} value={g}>{g} gsm</option>)}
                      </NativeSelect>
                    </>
                  )}
                  <p className="col-span-2 -mt-1 text-xs text-muted-foreground">
                    {innerPrintingSize === AUTO_SIZE
                      ? "Auto compares every inner print size with every fitting paper sheet at the chosen GSM and picks the cheapest — shown after Calculate."
                      : "Print size first — paper sizes are limited to sheets it can be cut from. Printing wastage (10/15%) applies like the outer wrap."}
                  </p>
                  {innerPrintingType === "offset" && (
                    <div className="col-span-2 flex flex-col gap-2">
                      <Label>Print colours</Label>
                      <Segmented
                        value={innerPrintingColour}
                        onValueChange={setInnerPrintingColour}
                        options={[
                          { value: "multi", label: "Multicolour" },
                          {
                            value: "single",
                            label: "Single colour",
                            disabled: !options?.offsetSingleColour,
                          },
                        ]}
                      />
                    </div>
                  )}
                  <PrintVendorField
                    options={options}
                    type={innerPrintingType}
                    colour={innerPrintingColour}
                    sizeLabel={innerPrintingSize}
                    value={innerPrintingVendor}
                    onChange={setInnerPrintingVendor}
                    idPrefix="inner"
                  />
                </div>
              )}
              {innerMode === "special" && options && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 flex flex-col gap-2">
                    <NativeSelect aria-label="Inner special paper" value={innerSpecialSel} onChange={(e) => {
                      setInnerSpecialSel(e.target.value);
                      const sp = options.specialPaper.find((p) => `${p.name}|${p.sizeLabel}` === e.target.value);
                      if (sp) { setInnerSpecialSheetW(sp.sheetWidth_in); setInnerSpecialSheetH(sp.sheetHeight_in); }
                    }}>
                      {options.specialPaper.map((s) => (
                        <option key={`${s.name}|${s.sizeLabel}`} value={`${s.name}|${s.sizeLabel}`}>{s.name} ({s.sizeLabel}{s.gsm != null ? `, ${s.gsm} GSM` : ""})</option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Sheet width (in)</Label>
                    <NumberField step="0.1" min="0" value={innerSpecialSheetW} onValueChange={setInnerSpecialSheetW} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Sheet height (in)</Label>
                    <NumberField step="0.1" min="0" value={innerSpecialSheetH} onValueChange={setInnerSpecialSheetH} />
                  </div>
                  <p className="col-span-2 text-xs text-muted-foreground -mt-1">Sheet size from rate card — editable if your batch differs. No printing on special paper.</p>
                </div>
              )}
              {innerMode !== "none" && options && (
                <div className="pt-2">
                  <FinishingPicker
                    label="Inner finishing"
                    options={options}
                    value={innerFinish}
                    onChange={setInnerFinish}
                    defaultArea={{ L: dims.length_in, W: dims.width_in }}
                  />
                </div>
              )}
            </div>
          </div>
          )}

          {/* Per-component wrapping (client final doc item 2): each part can
              carry its own paper / printing / finishing. Parts left off — and
              parts that end up configured identically — still share sheets and
              one print job, so switching this on costs nothing by itself. */}
          {secWrapping && options && componentNames.length > 1 && (
            <div className="mt-4 flex flex-col gap-3 border-t pt-4">
              <div className="flex items-center gap-2.5">
                <Switch
                  id="perComponentOn"
                  checked={perComponentOn}
                  onCheckedChange={(on) => {
                    setPerComponentOn(on);
                    if (on) {
                      setComponentWraps((prev) => {
                        const next = { ...prev };
                        for (const c of componentNames) {
                          if (!next[c]) next[c] = defaultComponentWrap(options);
                        }
                        return next;
                      });
                    }
                  }}
                />
                <Label htmlFor="perComponentOn">Different wrapping per part</Label>
              </div>
              {perComponentOn ? (
                <>
                  <p className="-mt-1 text-xs text-muted-foreground">
                    Set paper, printing and finishing separately for each part (e.g. tray and
                    case). Parts left on &quot;Same as box&quot; use the wrap above; parts that
                    end up identical still share sheets and one print plate.
                  </p>
                  {componentNames.map((c) => (
                    <ComponentWrapFields
                      key={c}
                      component={c}
                      state={componentWraps[c] ?? defaultComponentWrap(options)}
                      onChange={(patch) =>
                        setComponentWraps((prev) => ({
                          ...prev,
                          [c]: { ...(prev[c] ?? defaultComponentWrap(options)), ...patch },
                        }))
                      }
                      options={options}
                      defaultArea={{ L: dims.length_in, W: dims.width_in }}
                    />
                  ))}
                </>
              ) : (
                <p className="-mt-1 text-xs text-muted-foreground">
                  One wrap for the whole box. Turn this on to wrap the{" "}
                  {componentNames.map((c) => c.replace(/_/g, " ")).join(" and ")} differently.
                </p>
              )}
            </div>
          )}
        </FormSection>

        {/* 3 — Inserts & add-ons */}
        <FormSection def={SECTIONS[2]}>
          {!secInserts ? (
            <p className="text-sm text-muted-foreground">
              Excluded from this estimate — tick “Inserts & add-ons” under “Estimate covers” to include it.
            </p>
          ) : !options ? (
            <p className="text-sm text-muted-foreground">Loading rate options…</p>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Foam inserts — multiple per estimate (client 2-Jul), each with
                  its own type/thickness/size and optional top/bottom cover. */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Switch
                      aria-label="Foam inserts"
                      checked={foamEnabled}
                      onCheckedChange={(on) => {
                        setFoamEnabled(on);
                        // First enable with an empty list: start with one row.
                        if (on && foamItems.length === 0) addFoamRow();
                      }}
                    />
                    <span className="text-sm font-medium">Foam inserts</span>
                  </div>
                  {foamEnabled && (
                    <div className="flex items-center gap-2">
                      {foamItems.length > 0 && (
                        <Segmented
                          size="sm"
                          value={foamUnit}
                          onValueChange={setFoamUnit}
                          options={(["in", "cm", "mm"] as Unit[]).map((u) => ({ value: u, label: u }))}
                        />
                      )}
                      <Button type="button" variant="outline" size="sm" onClick={addFoamRow}>
                        <Plus data-icon="inline-start" /> Add foam
                      </Button>
                    </div>
                  )}
                </div>
                {foamEnabled && foamItems.length === 0 && (
                  <p className="text-xs text-muted-foreground">No foam inserts added.</p>
                )}
                {foamEnabled && foamItems.map((f, i) => {
                  const patchFoam = (p: Partial<FoamRow>) =>
                    setFoamItems((fs) => fs.map((x, idx) => (idx === i ? { ...x, ...p } : x)));
                  const patchCover = (p: Partial<FoamCoverState>) =>
                    patchFoam({ cover: { ...f.cover, ...p } });
                  const [selType, selThickness] = f.sel.split("|");
                  const foamTypes = [...new Set(options.foam.map((x) => x.type))];
                  const thicknessesFor = (t: string) =>
                    options.foam.filter((x) => x.type === t).map((x) => x.thickness_mm);
                  const c = f.cover;
                  // Cover paper list for the chosen material (art paper / art card),
                  // filtered to sheets the chosen print size can be cut from.
                  // Art card narrows to the selected board type — the Board rate
                  // section can hold several types at the same size/GSM.
                  const boardTypes = [...new Set(options.artCard.map((x) => x.type))];
                  const boardStock = (t: string) => options.artCard.filter((x) => x.type === t);
                  // A hydrated cover can carry a board type the rate card no
                  // longer has (legacy DEFAULT_BOARD_TYPE, or a renamed row) —
                  // fall back so the size/GSM lists are never empty. The
                  // material switch below already guards the same way.
                  const coverBoardType = boardTypes.includes(c.boardType)
                    ? c.boardType
                    : boardTypes[0] ?? c.boardType;
                  const coverList: { sizeLabel: string; gsms: number[] }[] =
                    c.material === "art_card" ? boardStock(coverBoardType) : options.paper;
                  const coverPapers = c.printingEnabled && c.printingSize
                    ? (() => {
                        const p = parseSize(c.printingSize);
                        if (!p) return coverList;
                        const fit = coverList.filter((paper) => {
                          const s = parseSize(paper.sizeLabel);
                          return s ? (p.w <= s.w && p.h <= s.h) || (p.h <= s.w && p.w <= s.h) : false;
                        });
                        return fit.length > 0 ? fit : coverList;
                      })()
                    : coverList;
                  const coverGsms = coverList.find((x) => x.sizeLabel === c.paperSize)?.gsms ?? [];
                  const coverPrintSizes = c.printingType === "offset" ? options.offsetSizes : options.digitalSizes;
                  return (
                    <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">Foam insert {i + 1}</span>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove foam insert"
                          onClick={() => setFoamItems((fs) => fs.filter((_, idx) => idx !== i))}>
                          <X />
                        </Button>
                      </div>
                      <div className="grid grid-cols-4 gap-3 text-xs text-muted-foreground">
                        <span>Foam type</span>
                        <span>Thickness</span>
                        <span>Insert L ({UNIT_LABELS[foamUnit]})</span>
                        <span>Insert W ({UNIT_LABELS[foamUnit]})</span>
                      </div>
                      <div className="grid grid-cols-4 gap-3">
                        <NativeSelect aria-label="Foam type" value={selType} onChange={(e) => {
                          const t = e.target.value;
                          const ths = thicknessesFor(t);
                          const th = ths.includes(Number(selThickness)) ? selThickness : String(ths[0] ?? "");
                          patchFoam({ sel: `${t}|${th}` });
                        }}>
                          {foamTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                        </NativeSelect>
                        <NativeSelect aria-label="Foam thickness" value={selThickness}
                          onChange={(e) => patchFoam({ sel: `${selType}|${e.target.value}` })}>
                          {thicknessesFor(selType).map((th) => <option key={th} value={th}>{th} mm</option>)}
                        </NativeSelect>
                        <NumberField aria-label="Foam length" step={dimStep(foamUnit)} min="0" value={toDim(f.L, foamUnit)}
                          onValueChange={(n) => patchFoam({ L: fromDim(n, foamUnit) })}
                          placeholder={`L ${UNIT_LABELS[foamUnit]}`} />
                        <NumberField aria-label="Foam width" step={dimStep(foamUnit)} min="0" value={toDim(f.W, foamUnit)}
                          onValueChange={(n) => patchFoam({ W: fromDim(n, foamUnit) })}
                          placeholder={`W ${UNIT_LABELS[foamUnit]}`} />
                      </div>
                      {/* Punching margin (client 7-Jul): die-punch clearance added to
                          every side of the piece when nesting. Empty/0 = none. */}
                      <div className="flex items-center gap-3">
                        <Label className="text-xs text-muted-foreground" htmlFor={`foamPunch-${i}`}>
                          Punching margin (mm, per side)
                        </Label>
                        <NumberField id={`foamPunch-${i}`} className="w-24" step="1" min="0"
                          value={f.punchingMargin_mm}
                          emptyValue={0}
                          onValueChange={(n) => patchFoam({ punchingMargin_mm: n })}
                          placeholder="0" />
                      </div>

                      {/* Board covering (client 2-Jul): paper/card pieces cut to the
                          foam footprint, top and/or bottom; optional printing follows
                          the outer/inner formulas (print size drives the purchase). */}
                      <div className="flex items-center gap-2.5 pt-1">
                        <Switch id={`foamCover-${i}`} checked={c.enabled} onCheckedChange={(on) => patchCover({ enabled: on })} />
                        <Label htmlFor={`foamCover-${i}`}>Board covering</Label>
                      </div>
                      {c.enabled && (
                        <div className="flex flex-col gap-2 pl-1">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                            <label className="flex items-center gap-1.5">
                              <input type="checkbox" checked={c.top} onChange={(e) => patchCover({ top: e.target.checked })} />
                              top
                            </label>
                            <label className="flex items-center gap-1.5">
                              <input type="checkbox" checked={c.bottom} onChange={(e) => patchCover({ bottom: e.target.checked })} />
                              bottom
                            </label>
                            <Segmented
                              size="sm"
                              value={c.material}
                              onValueChange={(m) => {
                                // Re-point size/GSM at the new material's list.
                                // Art card also settles on a board type first —
                                // the stock list is per (type, size).
                                const boardType = boardTypes.includes(c.boardType)
                                  ? c.boardType
                                  : boardTypes[0] ?? DEFAULT_BOARD_TYPE;
                                const list = m === "art_card" ? boardStock(boardType) : options.paper;
                                patchCover({
                                  material: m,
                                  boardType,
                                  paperSize: list[0]?.sizeLabel ?? "",
                                  gsm: list[0]?.gsms[0] ?? 0,
                                });
                              }}
                              options={[
                                { value: "art_paper", label: "Art paper" },
                                {
                                  value: "art_card",
                                  label: options.artCard.length === 0 ? "Art card (no rates yet)" : "Art card",
                                  disabled: options.artCard.length === 0,
                                },
                                { value: "special", label: "Special paper" },
                              ]}
                            />
                          </div>
                          {!c.top && !c.bottom && (
                            <p className="text-xs text-destructive">Pick top and/or bottom.</p>
                          )}
                          {c.material === "special" ? (
                            <div className="grid grid-cols-2 gap-3">
                              <div className="col-span-2">
                                <NativeSelect aria-label="Cover special paper" value={c.specialSel}
                                  onChange={(e) => {
                                    setFoamItems((fs) => fs.map((x, idx) => {
                                      if (idx !== i) return x;
                                      const sp = options.specialPaper.find((p) => `${p.name}|${p.sizeLabel}` === e.target.value);
                                      return {
                                        ...x,
                                        cover: {
                                          ...x.cover,
                                          specialSel: e.target.value,
                                          specialSheetW: sp?.sheetWidth_in ?? x.cover.specialSheetW,
                                          specialSheetH: sp?.sheetHeight_in ?? x.cover.specialSheetH,
                                        },
                                      };
                                    }));
                                  }}>
                                  {options.specialPaper.map((s) => (
                                    <option key={`${s.name}|${s.sizeLabel}`} value={`${s.name}|${s.sizeLabel}`}>{s.name} ({s.sizeLabel}{s.gsm != null ? `, ${s.gsm} GSM` : ""})</option>
                                  ))}
                                </NativeSelect>
                              </div>
                              <div className="flex flex-col gap-2">
                                <Label>Sheet width (in)</Label>
                                <NumberField step="0.1" min="0" value={c.specialSheetW}
                                  emptyValue={0}
                                  onValueChange={(n) => patchCover({ specialSheetW: n })} />
                              </div>
                              <div className="flex flex-col gap-2">
                                <Label>Sheet height (in)</Label>
                                <NumberField step="0.1" min="0" value={c.specialSheetH}
                                  emptyValue={0}
                                  onValueChange={(n) => patchCover({ specialSheetH: n })} />
                              </div>
                              <p className="col-span-2 -mt-1 text-xs text-muted-foreground">Sheet size from rate card — editable if your batch differs.</p>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-3">
                              {/* Board type (client 18-Jul): the Board rate section
                                  can hold several stocks, so the type picks the
                                  size/GSM list below. Only one type = no picker. */}
                              {c.material === "art_card" && boardTypes.length > 1 && (
                                <div className="col-span-2 flex flex-col gap-2">
                                  <Label>Board type</Label>
                                  <NativeSelect aria-label="Cover board type" value={coverBoardType}
                                    onChange={(e) => {
                                      const t = e.target.value;
                                      const list = boardStock(t);
                                      // Keep the current size when the new type
                                      // stocks it; otherwise fall back to its first.
                                      const keep = list.find((x) => x.sizeLabel === c.paperSize);
                                      const pick = keep ?? list[0];
                                      patchCover({
                                        boardType: t,
                                        paperSize: pick?.sizeLabel ?? "",
                                        gsm: pick?.gsms.includes(c.gsm) ? c.gsm : pick?.gsms[0] ?? 0,
                                      });
                                    }}>
                                    {boardTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                                  </NativeSelect>
                                </div>
                              )}
                              <NativeSelect aria-label="Cover paper size" value={c.paperSize}
                                onChange={(e) => patchCover({ paperSize: e.target.value, gsm: coverList.find((x) => x.sizeLabel === e.target.value)?.gsms[0] ?? 0 })}>
                                {coverPapers.map((p) => <option key={p.sizeLabel} value={p.sizeLabel}>{p.sizeLabel}</option>)}
                              </NativeSelect>
                              <NativeSelect aria-label="Cover paper GSM" value={c.gsm}
                                onChange={(e) => patchCover({ gsm: Number(e.target.value) })}>
                                {coverGsms.map((g) => <option key={g} value={g}>{g} gsm</option>)}
                              </NativeSelect>
                            </div>
                          )}
                          <div className="flex items-center gap-2.5">
                            <Switch id={`foamCoverPrint-${i}`} checked={c.printingEnabled}
                              onCheckedChange={(on) => patchCover({ printingEnabled: on })} />
                            <Label htmlFor={`foamCoverPrint-${i}`}>Print the cover</Label>
                          </div>
                          {c.printingEnabled && (
                            <div className="grid grid-cols-2 gap-3">
                              <Segmented
                                value={c.printingType}
                                onValueChange={(t) => patchCover({
                                  printingType: t,
                                  printingSize: (t === "offset" ? options.offsetSizes : options.digitalSizes)[0] ?? "",
                                })}
                                options={[
                                  { value: "offset", label: "Offset" },
                                  { value: "digital", label: "Digital" },
                                ]}
                              />
                              <NativeSelect aria-label="Cover print size" value={c.printingSize}
                                onChange={(e) => {
                                  const size = e.target.value;
                                  // Print size drives the cover paper size too: re-point
                                  // the paper at a compatible sheet when needed.
                                  const p = parseSize(size);
                                  let paperSize = c.paperSize;
                                  let gsm = c.gsm;
                                  if (p && c.material !== "special") {
                                    const stillFits = (() => {
                                      const s = parseSize(paperSize);
                                      return s ? (p.w <= s.w && p.h <= s.h) || (p.h <= s.w && p.w <= s.h) : false;
                                    })();
                                    if (!stillFits) {
                                      const fit = coverList.find((paper) => {
                                        const s = parseSize(paper.sizeLabel);
                                        return s ? (p.w <= s.w && p.h <= s.h) || (p.h <= s.w && p.w <= s.h) : false;
                                      });
                                      if (fit) { paperSize = fit.sizeLabel; gsm = fit.gsms[0] ?? 0; }
                                    }
                                  }
                                  patchCover({ printingSize: size, paperSize, gsm });
                                }}>
                                {coverPrintSizes.map((s) => <option key={s} value={s}>{s}</option>)}
                              </NativeSelect>
                            </div>
                          )}
                          {c.printingEnabled && c.printingType === "offset" && (
                            <div className="flex flex-col gap-2">
                              <Label>Print colours</Label>
                              <Segmented
                                size="sm"
                                value={c.printingColour}
                                onValueChange={(v) => patchCover({ printingColour: v })}
                                options={[
                                  { value: "multi", label: "Multicolour" },
                                  {
                                    value: "single",
                                    label: "Single colour",
                                    disabled: !options.offsetSingleColour,
                                  },
                                ]}
                              />
                            </div>
                          )}
                          {c.printingEnabled && (
                            <p className="text-xs text-muted-foreground">
                              Same formula as the outer wrap: pieces nest on the print size, paper is bought to fit it, +10% printing wastage
                              (15% if the cover has foiling/UV finishing below).
                            </p>
                          )}
                          <div className="border-t pt-2">
                            <FinishingPicker
                              label="Cover finishing"
                              options={options}
                              value={c.finish}
                              onChange={(v) => patchCover({ finish: v })}
                              defaultArea={{ L: f.L, W: f.W }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Reverse board */}
              <div className="flex flex-col gap-2 border-t pt-4">
                <div className="flex items-center gap-2.5">
                  <Switch id="revEnabled" checked={revEnabled} onCheckedChange={setRevEnabled} />
                  <Label htmlFor="revEnabled">Reverse-board insert</Label>
                  {revEnabled && (
                    <Segmented
                      size="sm"
                      className="ml-auto"
                      value={revUnit}
                      onValueChange={setRevUnit}
                      options={(["in", "cm", "mm"] as Unit[]).map((u) => ({ value: u, label: u }))}
                    />
                  )}
                </div>
                {revEnabled && (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-2">
                        <Label>Thickness (mm)</Label>
                        <NativeSelect value={revThickness} onChange={num(setRevThickness)}>
                          {options.reverseBoardThicknesses.map((t) => <option key={t} value={t}>{t} mm</option>)}
                        </NativeSelect>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label>Insert height Hi ({UNIT_LABELS[revUnit]})</Label>
                        <NumberField step={dimStep(revUnit)} min="0" value={toDim(revInsertHeight, revUnit)} onValueChange={(n) => setRevInsertHeight(fromDim(n, revUnit))} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <Switch id="revTopEnabled" checked={revTopEnabled} onCheckedChange={setRevTopEnabled} />
                      <Label htmlFor="revTopEnabled">Top paper</Label>
                    </div>
                    {revTopEnabled && (
                      <div className="grid grid-cols-2 gap-3">
                        <NativeSelect aria-label="Top paper size" value={revTopSize} onChange={(e) => { setRevTopSize(e.target.value); setRevTopGsm(gsmsFor(e.target.value)[0] ?? 0); }}>
                          {options.paper.map((p) => <option key={p.sizeLabel} value={p.sizeLabel}>{p.sizeLabel}</option>)}
                        </NativeSelect>
                        <NativeSelect aria-label="Top paper GSM" value={revTopGsm} onChange={num(setRevTopGsm)}>
                          {gsmsFor(revTopSize).map((g) => <option key={g} value={g}>{g} gsm</option>)}
                        </NativeSelect>
                      </div>
                    )}
                    {dims.length_in > 0 && dims.width_in > 0 && revInsertHeight > 0 && (
                      <div className="rounded-lg border p-3">
                        <ReverseBoardKeyline dims={dims} insertHeight_in={revInsertHeight} />
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* Sleeve insert (round 6: card stock only — client 15-Jul "not
                  kappa board, only paper and art card"): box type's own sleeve
                  formula, dims prefilled from the box; material/printing via
                  the shared card-stock fields + a FULL finishing picker. */}
              <div className="flex flex-col gap-2 border-t pt-3">
                <div className="flex items-center gap-2.5">
                  <Switch
                    id="sleeveEnabled"
                    checked={sleeveEnabled}
                    onCheckedChange={(on) => {
                      setSleeveEnabled(on);
                      if (on && sleeveL === 0) {
                        setSleeveL(dims.length_in);
                        setSleeveW(dims.width_in);
                        setSleeveH(dims.height_in);
                      }
                    }}
                  />
                  <Label htmlFor="sleeveEnabled">Sleeve</Label>
                </div>
                {sleeveEnabled && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-muted-foreground">
                      Same formula as the {boxType === "drawer_sliding" ? "drawer" : "matchbox"} sleeve keyline — sizes prefill from the box, editable below. Cut from paper / board stock (no kappa board).
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      <NumberField aria-label="Sleeve length" step="0.1" min="0" value={sleeveL} onValueChange={setSleeveL} placeholder="L (in)" />
                      <NumberField aria-label="Sleeve width" step="0.1" min="0" value={sleeveW} onValueChange={setSleeveW} placeholder="W (in)" />
                      <NumberField aria-label="Sleeve height" step="0.1" min="0" value={sleeveH} onValueChange={setSleeveH} placeholder="H (in)" />
                    </div>
                    <CardStockFields
                      idPrefix="sleeve"
                      state={sleeveStock}
                      onChange={(p) => setSleeveStock((s) => ({ ...s, ...p }))}
                      options={options}
                      hideLamination
                    />
                    <FinishingPicker
                      label="Sleeve finishing"
                      options={options}
                      value={sleeveFinish}
                      onChange={setSleeveFinish}
                      defaultArea={{ L: sleeveL || dims.length_in, W: sleeveW || dims.width_in }}
                    />
                  </div>
                )}
              </div>
              {/* Beading insert (round 5, client 13-Jul). */}
              <div className="flex flex-col gap-2 border-t pt-3">
                <div className="flex items-center gap-2.5">
                  <Switch id="beadingEnabled" checked={beadingEnabled} onCheckedChange={setBeadingEnabled} />
                  <Label htmlFor="beadingEnabled">Beading</Label>
                  {beadingEnabled && (
                    <Segmented
                      size="sm"
                      className="ml-auto"
                      value={beadingUnit}
                      onValueChange={setBeadingUnit}
                      options={(["in", "cm", "mm"] as Unit[]).map((u) => ({ value: u, label: u }))}
                    />
                  )}
                </div>
                {beadingEnabled && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-muted-foreground">
                      Blank = [BH+BT+BH + L + BH+BT+BH] × [BH+BT+BH + W + BH+BT+BH], one per box.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-2">
                        <Label>Beading height BH ({UNIT_LABELS[beadingUnit]})</Label>
                        <NumberField step={beadStep(beadingUnit)} min="0" value={toDim(beadingBH, beadingUnit)} onValueChange={(n) => setBeadingBH(fromDim(n, beadingUnit))} />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label>Beading thickness BT ({UNIT_LABELS[beadingUnit]})</Label>
                        <NumberField step={beadStep(beadingUnit)} min="0" value={toDim(beadingBT, beadingUnit)} onValueChange={(n) => setBeadingBT(fromDim(n, beadingUnit))} />
                      </div>
                    </div>
                    <CardStockFields idPrefix="beading" state={beadingStock} onChange={(p) => setBeadingStock((s) => ({ ...s, ...p }))} options={options} />
                  </div>
                )}
              </div>
              {/* Card partitions (round 5, client 13-Jul). */}
              <div className="flex flex-col gap-2 border-t pt-3">
                <div className="flex items-center gap-2.5">
                  <Switch id="partsEnabled" checked={partsEnabled} onCheckedChange={setPartsEnabled} />
                  <Label htmlFor="partsEnabled">Card partition</Label>
                </div>
                {partsEnabled && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-muted-foreground">
                      L partition (H+H) × L; W partition (H+H) × W — counts per box.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-2">
                        <Label>L partitions</Label>
                        <NumberField step="1" min="0" value={partsCountL} onValueChange={(n) => setPartsCountL(Math.max(0, Math.round(n)))} />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label>W partitions</Label>
                        <NumberField step="1" min="0" value={partsCountW} onValueChange={(n) => setPartsCountW(Math.max(0, Math.round(n)))} />
                      </div>
                    </div>
                    <CardStockFields idPrefix="parts" state={partsStock} onChange={(p) => setPartsStock((s) => ({ ...s, ...p }))} options={options} />
                  </div>
                )}
              </div>
              {/* Custom card partition (round 5, client 13-Jul). */}
              <div className="flex flex-col gap-2 border-t pt-3">
                <div className="flex items-center gap-2.5">
                  <Switch id="customPartEnabled" checked={customPartEnabled} onCheckedChange={setCustomPartEnabled} />
                  <Label htmlFor="customPartEnabled">Custom card partition</Label>
                </div>
                {customPartEnabled && (
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="flex flex-col gap-2">
                        <Label>L (in)</Label>
                        <NumberField step="0.1" min="0" value={customPartL} onValueChange={setCustomPartL} />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label>W (in)</Label>
                        <NumberField step="0.1" min="0" value={customPartW} onValueChange={setCustomPartW} />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label>Pieces / box</Label>
                        <NumberField step="1" min="1" value={customPartCount} onValueChange={(n) => setCustomPartCount(Math.max(1, Math.round(n)))} />
                      </div>
                    </div>
                    <CardStockFields idPrefix="customPart" state={customPartStock} onChange={(p) => setCustomPartStock((s) => ({ ...s, ...p }))} options={options} />
                  </div>
                )}
              </div>
              {/* Custom card insert (renamed round 5) — Switch toggle for consistency (client 8-Jul) */}
              <div className="flex flex-col gap-2 border-t pt-3">
                <div className="flex items-center gap-2.5">
                  <Switch id="cardEnabled" checked={cardEnabled} onCheckedChange={setCardEnabled} />
                  <Label htmlFor="cardEnabled">Custom card insert</Label>
                </div>
                {cardEnabled && (
                  <div className="flex flex-col gap-2">
                    {/* Detail fields (client 22-Jul: "size, material type, GSM").
                        Descriptive only — a one-off die-cut can't be nested, so
                        the cost below stays the manual open input it always was;
                        these just document what the floor needs to buy. */}
                    <p className="text-xs text-muted-foreground">
                      Cost is entered manually; the fields below record what the insert is.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="cardL">Size L (in)</Label>
                        <NumberField id="cardL" step="0.1" min="0" value={cardL} onValueChange={setCardL} />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="cardW">Size W (in)</Label>
                        <NumberField id="cardW" step="0.1" min="0" value={cardW} onValueChange={setCardW} />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="cardMaterial">Material type</Label>
                        <Input
                          id="cardMaterial"
                          value={cardMaterial}
                          onChange={(e) => setCardMaterial(e.target.value)}
                          placeholder="e.g. Grey board"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="cardGsm">GSM</Label>
                        <NumberField id="cardGsm" step="1" min="0" value={cardGsm} onValueChange={setCardGsm} />
                      </div>
                    </div>
                    <Label htmlFor="cardTotal">Total cost ({moneyLabel}, manual)</Label>
                    <NumberField id="cardTotal" step="0.01" min="0" value={cardTotal} onValueChange={setCardTotal} />
                  </div>
                )}
              </div>
              {/* Ribbon tag (auto box types) */}
              {RIBBON_BOXES.has(boxType) && (
                <div className="flex flex-col gap-2 border-t pt-3">
                  <Label>Ribbon tag size</Label>
                  <NativeSelect value={ribbonSize} onChange={(e) => setRibbonSize(e.target.value)}>
                    {options.ribbonTags.map((s) => <option key={s} value={s}>{s}</option>)}
                  </NativeSelect>
                </div>
              )}
              {/* Magnets (auto box types) */}
              {MAGNET_BOXES.has(boxType) && (
                <div className="flex flex-col gap-2 border-t pt-3">
                  <span className="text-sm font-medium">Magnets & washers</span>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="flex flex-col gap-2">
                      <Label>Per box</Label>
                      <NumberField step="1" min="0" value={magnetsPerBox} onValueChange={setMagnetsPerBox} />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>Magnet</Label>
                      <NativeSelect value={magnetSel} onChange={(e) => setMagnetSel(e.target.value)}>
                        {options.magnets.map((m) => {
                          const v = `${m.diameter_mm}|${m.thickness_mm}`;
                          return <option key={v} value={v}>{m.diameter_mm}×{m.thickness_mm}mm</option>;
                        })}
                      </NativeSelect>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>Washer</Label>
                      <NativeSelect value={washerName} onChange={(e) => setWasherName(e.target.value)}>
                        {options.washers.map((w) => <option key={w} value={w}>{w}</option>)}
                      </NativeSelect>
                    </div>
                  </div>
                </div>
              )}
              {/* Customisations: handles / locks / window (doc 2026-06-19) */}
              <div className="flex flex-col gap-3 border-t pt-3">
                <span className="text-sm font-medium">Customisations</span>
                {/* Handles */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2.5">
                    <Switch id="handlesEnabled" checked={handlesEnabled} onCheckedChange={setHandlesEnabled} />
                    <Label htmlFor="handlesEnabled">Handles</Label>
                  </div>
                  {handlesEnabled && (
                    <div className="flex flex-col gap-2">
                      <ImagePick table="handle_rates" items={options.handles.map((h) => ({ id: h.id, label: h.type, hasImage: h.hasImage }))} selected={handleType} onSelect={setHandleType} />
                      <div className="flex items-center gap-2">
                        <Label htmlFor="handleCount" className="text-xs">Per box</Label>
                        <NumberField id="handleCount" className="w-24" step="1" min="0" value={handleCount} onValueChange={setHandleCount} />
                      </div>
                    </div>
                  )}
                </div>
                {/* Locks */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2.5">
                    <Switch id="locksEnabled" checked={locksEnabled} onCheckedChange={setLocksEnabled} />
                    <Label htmlFor="locksEnabled">Locks</Label>
                  </div>
                  {locksEnabled && (
                    <div className="flex flex-col gap-2">
                      <ImagePick table="lock_rates" items={options.locks.map((l) => ({ id: l.id, label: l.type, hasImage: l.hasImage }))} selected={lockType} onSelect={setLockType} />
                      <div className="flex items-center gap-2">
                        <Label htmlFor="lockCount" className="text-xs">Per box</Label>
                        <NumberField id="lockCount" className="w-24" step="1" min="0" value={lockCount} onValueChange={setLockCount} />
                      </div>
                    </div>
                  )}
                </div>
                {/* Window */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2.5">
                    <Switch
                      id="windowEnabled"
                      checked={windowEnabled}
                      onCheckedChange={(on) => {
                        setWindowEnabled(on);
                        if (on && windowL === 0) { setWindowL(dims.length_in); setWindowW(dims.width_in); }
                      }}
                    />
                    <Label htmlFor="windowEnabled">Window</Label>
                    {windowEnabled && (
                      <Segmented
                        size="sm"
                        className="ml-auto"
                        value={windowUnit}
                        onValueChange={setWindowUnit}
                        options={(["in", "cm", "mm"] as Unit[]).map((u) => ({ value: u, label: u }))}
                      />
                    )}
                  </div>
                  {windowEnabled && (
                    <div className="flex flex-col gap-2">
                      <ImagePick table="window_rates" items={options.windows.map((w) => ({ id: w.id, label: w.name, hasImage: w.hasImage }))} selected={windowMaterial} onSelect={setWindowMaterial} />
                      <div className="grid grid-cols-2 gap-3">
                        <NumberField aria-label="Window length" step={dimStep(windowUnit)} min="0" value={toDim(windowL, windowUnit)} onValueChange={(n) => setWindowL(fromDim(n, windowUnit))} placeholder={`Window L (${UNIT_LABELS[windowUnit]})`} />
                        <NumberField aria-label="Window width" step={dimStep(windowUnit)} min="0" value={toDim(windowW, windowUnit)} onValueChange={(n) => setWindowW(fromDim(n, windowUnit))} placeholder={`Window W (${UNIT_LABELS[windowUnit]})`} />
                      </div>
                      {/* Client final doc item 4C: the formula always adds +10mm
                          per side automatically — not staff-editable. */}
                      <p className="text-xs text-muted-foreground">
                        A {WINDOW_PUNCHING_MARGIN_MM}mm punching allowance is added on each side automatically.
                      </p>
                    </div>
                  )}
                </div>
              </div>
              {/* Miscellaneous add-ons (client 8-Jul): sleeve / rate-card misc
                  materials / custom — each a manual line, cost = units × price. */}
              <div className="flex flex-col gap-2 border-t pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">Other add-ons (sleeve / miscellaneous)</span>
                  <div className="flex items-center gap-2">
                    {miscItems.length > 0 && (
                      <Segmented
                        size="sm"
                        value={miscUnit}
                        onValueChange={setMiscUnit}
                        options={(["in", "cm", "mm"] as Unit[]).map((u) => ({ value: u, label: u }))}
                      />
                    )}
                    <Button type="button" variant="outline" size="sm" onClick={addMiscRow}>
                      <Plus data-icon="inline-start" /> Add add-on
                    </Button>
                  </div>
                </div>
                {miscItems.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    e.g. a sleeve, satin cloth, buckles — price is entered manually per line.
                  </p>
                )}
                {miscItems.length > 0 && (
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] items-center gap-2 text-xs text-muted-foreground">
                    <span>Type</span>
                    <span className="w-20">L ({UNIT_LABELS[miscUnit]})</span>
                    <span className="w-20">W ({UNIT_LABELS[miscUnit]})</span>
                    <span className="w-16">Units</span>
                    <span className="w-24">{moneyLabel} / unit</span>
                    <span className="w-16 text-center">Per box</span>
                    <span className="w-7" />
                  </div>
                )}
                {miscItems.map((m, i) => {
                  const patchMisc = (p: Partial<MiscRow>) =>
                    setMiscItems((ms) => ms.map((x, idx) => (idx === i ? { ...x, ...p } : x)));
                  // Round 5: "Sleeve" is a real insert now — legacy misc Sleeve
                  // rows fall through to Custom text and still cost identically.
                  const isKnown = (label: string) =>
                    options.misc.some((o) => o.name === label);
                  const selValue = m.sel === "__custom" || isKnown(m.sel) ? m.sel : "__custom";
                  return (
                    <div key={i} className="flex flex-col gap-1.5">
                      <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] items-center gap-2">
                        <NativeSelect aria-label="Add-on type" value={selValue}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "__custom") {
                              patchMisc({ sel: "__custom", customLabel: m.customLabel || (isKnown(m.sel) ? "" : m.sel) });
                            } else {
                              // Rate-card rows pre-fill the price (still editable).
                              const row = options.misc.find((o) => o.name === v);
                              patchMisc({ sel: v, price: row ? row.price : m.price });
                            }
                          }}>
                          {options.misc.map((o) => (
                            <option key={o.id} value={o.name}>{o.name} ({o.unit})</option>
                          ))}
                          <option value="__custom">Custom…</option>
                        </NativeSelect>
                        <NumberField className="w-20" aria-label="Add-on length" step={dimStep(miscUnit)} min="0"
                          value={toDim(m.L, miscUnit)}
                          emptyValue={0}
                          onValueChange={(n) => patchMisc({ L: fromDim(n, miscUnit) || 0 })}
                          placeholder="—" />
                        <NumberField className="w-20" aria-label="Add-on width" step={dimStep(miscUnit)} min="0"
                          value={toDim(m.W, miscUnit)}
                          emptyValue={0}
                          onValueChange={(n) => patchMisc({ W: fromDim(n, miscUnit) || 0 })}
                          placeholder="—" />
                        <NumberField className="w-16" aria-label="Add-on units" step="1" min="0" value={m.units}
                          emptyValue={0}
                          onValueChange={(n) => patchMisc({ units: n })} />
                        <NumberField className="w-24" aria-label="Add-on price per unit" step="0.01" min="0" value={m.price}
                          emptyValue={0}
                          onValueChange={(n) => patchMisc({ price: n })} />
                        <div className="flex w-16 justify-center">
                          <Switch aria-label="Units are per box (multiplied by quantity), off = a flat total for the order"
                            checked={m.perBox}
                            onCheckedChange={(v) => patchMisc({ perBox: v })} />
                        </div>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove add-on"
                          onClick={() => setMiscItems((ms) => ms.filter((_, idx) => idx !== i))}><X /></Button>
                      </div>
                      {selValue === "__custom" && (
                        <Input aria-label="Custom add-on name" value={m.customLabel}
                          onChange={(e) => patchMisc({ customLabel: e.target.value })}
                          placeholder="Name this add-on (e.g. satin pouch)" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </FormSection>

        {/* 4 — Labour */}
        <FormSection def={SECTIONS[3]} description="One line per role. Cost = rate × hours or days.">
          <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Labour lines</span>
                <Button type="button" variant="outline" size="sm" onClick={addLabour} disabled={!options}>
                  Add line
                </Button>
              </div>
              {labourLines.length === 0 && <p className="text-xs text-muted-foreground">No labour added.</p>}
              {labourLines.length > 0 && (
                <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 text-xs text-muted-foreground">
                  <span>Role</span>
                  <span className="w-24">Unit</span>
                  <span className="w-20">Qty</span>
                  <span className="w-7" />
                </div>
              )}
              {labourLines.map((line, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
                  <NativeSelect aria-label="Role" value={line.role} onChange={(e) => updateLabour(i, { role: e.target.value })}>
                    {options?.labourRoles.map((r) => <option key={r} value={r}>{r}</option>)}
                  </NativeSelect>
                  <NativeSelect aria-label="Unit" className="w-24" value={line.unit} onChange={(e) => updateLabour(i, { unit: e.target.value as "hour" | "day" })}>
                    <option value="hour">per hour</option>
                    <option value="day">per day</option>
                  </NativeSelect>
                  <NumberField aria-label="Quantity" className="w-20" step="1" min="0" value={line.quantity} emptyValue={0} onValueChange={(n) => updateLabour(i, { quantity: n })} />
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove labour line" onClick={() => removeLabour(i)}>
                    <X />
                  </Button>
                </div>
              ))}
            </div>
        </FormSection>

        {/* 5 — Charges & overrides */}
        <FormSection
          def={SECTIONS[4]}
          description="Manual costs (glue, metlock, tape) and the after-margin charges."
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              {/* Glue / metlock (client 21-Jul): enter either a real quantity
                  (count × rate — also reported on the raw-material sheet) or
                  just the cost, since usage varies with size/customisation. */}
              <div className="grid grid-cols-2 gap-3">
                <ConsumableField
                  id="glue"
                  label="Glue"
                  mode={glueMode}
                  onModeChange={setGlueMode}
                  cost={glueTotal}
                  onCostChange={setGlueTotal}
                  perBox={gluePerBox}
                  onPerBoxChange={setGluePerBox}
                  qty={glueQty}
                  onQtyChange={setGlueQty}
                  unit={glueUnit}
                  onUnitChange={setGlueUnit}
                  rate={glueRate}
                  onRateChange={setGlueRate}
                  units={["litres", "kg", "bottles", "packets"]}
                />
                <ConsumableField
                  id="metlock"
                  label="Metlock"
                  mode={metlockMode}
                  onModeChange={setMetlockMode}
                  cost={metlockTotal}
                  onCostChange={setMetlockTotal}
                  perBox={metlockPerBox}
                  onPerBoxChange={setMetlockPerBox}
                  qty={metlockQty}
                  onQtyChange={setMetlockQty}
                  unit={metlockUnit}
                  onUnitChange={setMetlockUnit}
                  rate={metlockRate}
                  onRateChange={setMetlockRate}
                  units={["bottles", "litres", "kg", "packets"]}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Tape</Label>
                <div className="flex items-center gap-2">
                  <Switch id="tapeUsed" className="scale-90" checked={tapeUsed} onCheckedChange={setTapeUsed} />
                  <Label htmlFor="tapeUsed" className="font-normal">This box uses tape</Label>
                </div>
                {tapeUsed && (
                  <NumberField
                    id="tape"
                    aria-label={`Tape total override in ${moneyLabel}`}
                    step="0.01"
                    min="0"
                    value={tapeTotal}
                    emptyValue={0}
                    onValueChange={setTapeTotal}
                    placeholder={`${moneyLabel} total — blank = auto per tray / lid`}
                  />
                )}
                <span className="text-xs text-muted-foreground">
                  Off — no tape is charged. On and left blank — charged automatically,
                  one per tray and lid at the rate-card rate. On with an amount — that
                  amount is the total tape cost for the whole order, replacing the
                  automatic figure (useful for collapsible boxes, where the per-tray/lid
                  count doesn&apos;t match what the floor actually uses).
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t pt-4">
              <span className="text-sm font-medium">One-time charges (no margin)</span>
              <p className="-mt-1 text-xs text-muted-foreground">Enter qty and unit price. Total = qty × price per row.</p>
              <div className="flex flex-col gap-2">
                <Label>How to price them</Label>
                <Segmented
                  size="sm"
                  value={additionalMode}
                  onValueChange={(v) => setAdditionalMode(v as "separate" | "included")}
                  options={[
                    { value: "separate", label: "Separate price" },
                    { value: "included", label: "Included in box price" },
                  ]}
                />
                <span className="text-xs text-muted-foreground">
                  {additionalMode === "separate"
                    ? "Kept out of the per-box rate and quoted as their own line (18% GST)."
                    : "Divided into every box, so the unit price carries them (5% GST, no separate line on the quote)."}
                </span>
              </div>
              <div className="grid grid-cols-[80px_1fr_1fr_60px] items-center gap-2 text-xs text-muted-foreground">
                <span />
                <span>Qty</span>
                <span>Unit price {moneyLabel}</span>
                <span className="text-right">Total</span>
              </div>
              {([
                ["Die", addlDieQty, setAddlDieQty, addlDiePrice, setAddlDiePrice] as const,
                ["Mould", addlMouldQty, setAddlMouldQty, addlMouldPrice, setAddlMouldPrice] as const,
                ["Block", addlBlockQty, setAddlBlockQty, addlBlockPrice, setAddlBlockPrice] as const,
              ]).map(([label, qty, setQty, price, setPrice]) => (
                <div key={label} className="grid grid-cols-[80px_1fr_1fr_60px] items-center gap-2">
                  <span className="text-sm font-medium">{label}</span>
                  <NumberField aria-label={`${label} qty`} step="1" min="0" value={qty} emptyValue={0} onValueChange={setQty} placeholder="Qty" />
                  <NumberField aria-label={`${label} price`} step="0.01" min="0" value={price} emptyValue={0} onValueChange={setPrice} placeholder={`${moneyLabel} each`} />
                  <span className="text-xs text-muted-foreground text-right">{moneySymbol}{(qty * price).toFixed(0)}</span>
                </div>
              ))}
              <div className="flex flex-col gap-2">
                <Label>Designer charges ({moneyLabel})</Label>
                <NumberField step="0.01" min="0" value={addlDesigner} emptyValue={0} onValueChange={setAddlDesigner} />
              </div>
            </div>

            {/* Trial accounts set their own margin: it's their markup on
                their own private estimate, from their own cloned
                margin_config row — not the company's. Staff still never see
                it. Mirrored server-side in costForRole() and both estimate
                routes' override stripping. */}
            {(role === "admin" || role === "trial") && (
              <div className="grid grid-cols-2 gap-3 border-t pt-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="overhead">Overhead % (blank = default 11)</Label>
                  <Input id="overhead" type="number" step="0.1" min="0" value={overheadPct} onChange={(e) => setOverheadPct(e.target.value)} placeholder="11" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="margin">Margin % (blank = default 20)</Label>
                  <Input id="margin" type="number" step="0.1" min="0" value={marginPct} onChange={(e) => setMarginPct(e.target.value)} placeholder="20" />
                </div>
              </div>
            )}
          </div>
        </FormSection>
      </div>

      {/* ---- Right: job card (price + actions) + keyline + nesting ----
           Normal flow: the column scrolls with the page (no pinning — pinned
           variants either overlapped later cards or double-scrolled). */}
      <div className="flex min-w-0 flex-col gap-4">
        {/* Job card — price + actions. STICKY so Calculate / Save stay reachable
            after scrolling through the long form (no scrolling back to the top).
            It's opaque (base card) so the cards below scroll cleanly behind it. */}
        <div className="sticky top-4 z-10">
          <Card ref={jobCardRef} className="t-shake">
            <CardContent className="flex flex-col gap-3 pt-4">
              {result ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Price per box
                    {result.cost.additionalMode === "separate" &&
                      result.cost.additional.total > 0 &&
                      " (boxes only)"}
                  </p>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-semibold tabular-nums tracking-tight">
                      {inr(result.cost.pricePerBox)}
                    </span>
                    <span className="text-sm text-muted-foreground">/ box</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Total {inr(result.cost.total)} · {quantity.toLocaleString("en-IN")} boxes · pre-GST
                  </p>
                  {/* The headline is boxes-only in separate mode — say what the
                      order still owes so it can't be read as the whole job. */}
                  {result.cost.additionalMode === "separate" &&
                    result.cost.additional.total > 0 && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Total includes {inr(result.cost.additional.total)} one-time charges,
                        billed separately from the per-box price.
                      </p>
                    )}
                </div>
              ) : (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Price per box</p>
                  <p className="text-sm text-muted-foreground">
                    Fill the spec, then calculate to see the price.
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <Button size="lg" className="flex-1" onClick={calculate} disabled={loading || !dimsValid}>
                  {loading ? "Calculating…" : "Calculate"}
                </Button>
                <SaveButton
                  className="flex-1"
                  state={saveState}
                  savedId={savedId}
                  onClick={() => void save()}
                  disabled={saving || !dimsValid}
                />
              </div>
              {/* icon={false}: the button already drew the tick, and two of them
                  a few pixels apart reads as a glitch rather than emphasis. */}
              <InlineNotice kind="success" autoDismissMs={0} icon={false} messageKey={savedId}>
                {savedId ? (
                  <>
                    Saved
                    {" · "}
                    <Link
                      href={`/estimates/${savedId}`}
                      className="font-medium underline underline-offset-2 hover:no-underline"
                    >
                      Open estimate
                    </Link>
                  </>
                ) : null}
              </InlineNotice>
              <InlineNotice kind="error">{error}</InlineNotice>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Keyline</CardTitle>
            <CardDescription>Dashed lines are folds; numbers are inches.</CardDescription>
          </CardHeader>
          <CardContent>
            {dimsValid ? <Keyline dims={dims} vars={varsWithFit} /> : <p className="text-sm text-muted-foreground">Enter L, W and H to see the keyline.</p>}
          </CardContent>
        </Card>
        <LiveNesting
          input={previewInput}
          autoPrintNote={
            (outerMode === "printed" && printingSize === AUTO_SIZE) ||
            (innerMode === "printed" && innerPrintingSize === AUTO_SIZE)
              ? "Print size: Auto — the cheapest print + paper pair is chosen on Calculate; that layer's nesting appears in the result."
              : undefined
          }
        />
        <SelectedAddonPreview items={addonPreviewItems} />
        {result && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cost breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <ResultPanel
                materials={result.materials}
                cost={result.cost}
                autoPicks={result.autoPicks}
                // Section-wise breakdown (client item 11). buildCostView is
                // pure, so the form can render it from the response directly.
                costView={buildCostView(
                  buildRequest(),
                  result.cost as unknown as CostBreakdown,
                  result.materials,
                  moneyFormat,
                )}
                onEditLine={editLine}
                onResetLine={resetLine}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
    </div>
  );
}
