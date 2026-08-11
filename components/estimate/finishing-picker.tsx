"use client";

// Reusable finishing picker (client 2026-07: outer wrap and inner lining each
// get their OWN finishing). Whole-sheet finishes (lamination, full UV/drip-off/
// aquas) are checkboxes; per-sq-inch finishes (foiling, emboss/deboss, spot UV)
// are dynamic lists with per-item design area + wastage allowance (default
// 10 mm each side, client 27-Jun). Controlled component: all state lives in the
// parent form as a FinishingValue bundle.

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import type { RateOptions } from "@/lib/db/rate-options";
import { UNIT_LABELS, dimStep, fromDim, toDim, type Unit } from "@/lib/units";
import type { FinishingSelection } from "@/types";

export type FoilItem = {
  type: string;
  /** Matte vs glossy foil (client 4-Jul; prices identical today). */
  finish: "matte" | "glossy";
  areaL: number;
  areaW: number;
  wastage_mm: number;
};
export type EmbossItem = { type: "emboss" | "deboss"; areaL: number; areaW: number; wastage_mm: number };
export type SpotUVItem = { areaL: number; areaW: number; wastage_mm: number };

/** One wrap layer's finishing selections, as the form holds them. */
export interface FinishingValue {
  wholeSheet: string[]; // "lamination:<type>" | "uv:<type>" (whole-sheet UV)
  foils: FoilItem[];
  embosses: EmbossItem[];
  spotUVs: SpotUVItem[];
}

export const emptyFinishing = (): FinishingValue => ({
  wholeSheet: [],
  foils: [],
  embosses: [],
  spotUVs: [],
});

export const hasAnyFinishing = (v: FinishingValue): boolean =>
  v.wholeSheet.length > 0 || v.foils.length > 0 || v.embosses.length > 0 || v.spotUVs.length > 0;

/** FinishingValue -> the request payload's FinishingSelection[]. */
export function toFinishingSelections(v: FinishingValue): FinishingSelection[] {
  return [
    ...v.wholeSheet.map((s) => {
      const [kind, key] = s.split(":");
      return { kind: kind as FinishingSelection["kind"], key };
    }),
    ...v.foils.map((fi) => ({
      kind: "foiling" as const,
      key: fi.type,
      // The resolver falls back to the colour's other row when this exact
      // finish doesn't exist yet (pre-round-3 DB), so always carry it.
      finish: fi.finish,
      designArea: fi.areaL > 0 && fi.areaW > 0 ? { length_in: fi.areaL, width_in: fi.areaW } : undefined,
      wastageAllowance_mm: fi.wastage_mm > 0 ? fi.wastage_mm : undefined,
    })),
    ...v.embosses.map((ei) => ({
      kind: "relief" as const,
      key: ei.type,
      designArea: ei.areaL > 0 && ei.areaW > 0 ? { length_in: ei.areaL, width_in: ei.areaW } : undefined,
      wastageAllowance_mm: ei.wastage_mm > 0 ? ei.wastage_mm : undefined,
    })),
    ...v.spotUVs.map((si) => ({
      kind: "uv" as const,
      key: "spot",
      designArea: si.areaL > 0 && si.areaW > 0 ? { length_in: si.areaL, width_in: si.areaW } : undefined,
      wastageAllowance_mm: si.wastage_mm > 0 ? si.wastage_mm : undefined,
    })),
  ];
}

/** Snapshot FinishingSelection[] -> FinishingValue (form hydration). */
export function fromFinishingSelections(arr: FinishingSelection[] | undefined): FinishingValue {
  const v = emptyFinishing();
  for (const f of arr ?? []) {
    if (f.kind === "lamination") {
      v.wholeSheet.push(`lamination:${f.key}`);
    } else if (f.kind === "foiling") {
      v.foils.push({ type: f.key, finish: f.finish ?? "glossy", areaL: f.designArea?.length_in ?? 0, areaW: f.designArea?.width_in ?? 0, wastage_mm: f.wastageAllowance_mm ?? 10 });
    } else if (f.kind === "relief") {
      v.embosses.push({ type: f.key as "emboss" | "deboss", areaL: f.designArea?.length_in ?? 0, areaW: f.designArea?.width_in ?? 0, wastage_mm: f.wastageAllowance_mm ?? 10 });
    } else if (f.kind === "uv" && f.key === "spot") {
      v.spotUVs.push({ areaL: f.designArea?.length_in ?? 0, areaW: f.designArea?.width_in ?? 0, wastage_mm: f.wastageAllowance_mm ?? 10 });
    } else {
      v.wholeSheet.push(`uv:${f.key}`);
    }
  }
  return v;
}

/** Pill toggle for a whole-sheet finish (lamination type / whole-sheet UV). */
function FinishChip({
  active,
  label,
  onToggle,
}: {
  active: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={active}
      onClick={onToggle}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background text-muted-foreground hover:border-ring/40 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

export function FinishingPicker({
  label,
  options,
  value,
  onChange,
  defaultArea,
}: {
  label: string;
  options: RateOptions;
  value: FinishingValue;
  onChange: (v: FinishingValue) => void;
  /** Default design area for new per-sq-inch items (box footprint L x W, inches). */
  defaultArea: { L: number; W: number };
}) {
  // Per-spot display unit for the design-area inputs (client 2026-07: each
  // dimension-entry spot carries its own visible in/cm/mm selector). Internal
  // values stay in inches.
  const [unit, setUnit] = useState<Unit>("in");
  const patch = (p: Partial<FinishingValue>) => onChange({ ...value, ...p });
  const toggleWholeSheet = (key: string) =>
    patch({
      wholeSheet: value.wholeSheet.includes(key)
        ? value.wholeSheet.filter((x) => x !== key)
        : [...value.wholeSheet, key],
    });

  const wholeSheetUv = options.uv.filter((u) => u.unit === "per_100sqin");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <Segmented
          size="sm"
          value={unit}
          onValueChange={setUnit}
          options={(["in", "cm", "mm"] as Unit[]).map((u) => ({ value: u, label: u }))}
        />
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">
        Per-sq-inch finishes (foiling, emboss, spot UV) each carry their own design area.
      </p>

      {/* Lamination — whole-sheet chip toggles */}
      {options.lamination.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Lamination</span>
          <div className="flex flex-wrap gap-1.5">
            {options.lamination.map((key) => {
              const v = `lamination:${key}`;
              return (
                <FinishChip
                  key={v}
                  active={value.wholeSheet.includes(v)}
                  label={key.replace(/_/g, " ")}
                  onToggle={() => toggleWholeSheet(v)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Whole-sheet UV — full UV, drip-off, aquas */}
      {wholeSheetUv.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">UV (whole-sheet)</span>
          <div className="flex flex-wrap gap-1.5">
            {wholeSheetUv.map((u) => {
              const v = `uv:${u.type}`;
              return (
                <FinishChip
                  key={v}
                  active={value.wholeSheet.includes(v)}
                  label={u.type.replace(/_/g, " ")}
                  onToggle={() => toggleWholeSheet(v)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Foiling — dynamic list, each with type (+ matte/glossy) + area */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Foiling (per sq inch)</span>
          <Button type="button" variant="outline" size="sm"
            onClick={() => patch({ foils: [...value.foils, { type: options.foiling[0] ?? "", finish: "glossy", areaL: defaultArea.L, areaW: defaultArea.W, wastage_mm: 10 }] })}>
            <Plus data-icon="inline-start" /> Add foiling
          </Button>
        </div>
        {value.foils.length > 0 && (
          <div className={cn("grid items-center gap-2 text-xs text-muted-foreground", options.foilingFinishes ? "grid-cols-[1fr_auto_auto_auto_auto_auto]" : "grid-cols-[1fr_auto_auto_auto_auto]")}>
            <span>Foil type</span>
            {options.foilingFinishes && <span className="w-24">Finish</span>}
            <span className="w-20">Area L ({UNIT_LABELS[unit]})</span>
            <span className="w-20">Area W ({UNIT_LABELS[unit]})</span>
            <span className="w-16">+Waste mm</span>
            <span className="w-7" />
          </div>
        )}
        {value.foils.map((fi, i) => (
          <div key={i} className={cn("grid items-center gap-2", options.foilingFinishes ? "grid-cols-[1fr_auto_auto_auto_auto_auto]" : "grid-cols-[1fr_auto_auto_auto_auto]")}>
            <NativeSelect aria-label="Foil type" value={fi.type}
              onChange={(e) => patch({ foils: value.foils.map((f, idx) => idx === i ? { ...f, type: e.target.value } : f) })}>
              {options.foiling.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
            </NativeSelect>
            {options.foilingFinishes && (
              <NativeSelect className="w-24" aria-label="Foil finish" value={fi.finish}
                onChange={(e) => patch({ foils: value.foils.map((f, idx) => idx === i ? { ...f, finish: e.target.value as "matte" | "glossy" } : f) })}>
                <option value="glossy">Glossy</option>
                <option value="matte">Matte</option>
              </NativeSelect>
            )}
            <Input className="w-20" aria-label="Foil area L" type="number" step={dimStep(unit)} min="0" value={toDim(fi.areaL, unit)}
              onChange={(e) => patch({ foils: value.foils.map((f, idx) => idx === i ? { ...f, areaL: fromDim(Number(e.target.value), unit) } : f) })}
              placeholder={`L ${UNIT_LABELS[unit]}`} />
            <Input className="w-20" aria-label="Foil area W" type="number" step={dimStep(unit)} min="0" value={toDim(fi.areaW, unit)}
              onChange={(e) => patch({ foils: value.foils.map((f, idx) => idx === i ? { ...f, areaW: fromDim(Number(e.target.value), unit) } : f) })}
              placeholder={`W ${UNIT_LABELS[unit]}`} />
            <Input className="w-16" aria-label="Foil wastage (mm each side)" type="number" step="1" min="0" value={fi.wastage_mm}
              onChange={(e) => patch({ foils: value.foils.map((f, idx) => idx === i ? { ...f, wastage_mm: Number(e.target.value) } : f) })}
              placeholder="+mm" title="+mm wastage each side" />
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove foiling"
              onClick={() => patch({ foils: value.foils.filter((_, idx) => idx !== i) })}><X /></Button>
          </div>
        ))}
      </div>

      {/* Emboss / Deboss — dynamic list, each with type + area */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Emboss / Deboss (per sq inch)</span>
          <Button type="button" variant="outline" size="sm"
            onClick={() => patch({ embosses: [...value.embosses, { type: (options.relief[0] as "emboss" | "deboss") ?? "emboss", areaL: defaultArea.L, areaW: defaultArea.W, wastage_mm: 10 }] })}>
            <Plus data-icon="inline-start" /> Add emboss/deboss
          </Button>
        </div>
        {value.embosses.length > 0 && (
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2 text-xs text-muted-foreground">
            <span>Type</span>
            <span className="w-20">Area L ({UNIT_LABELS[unit]})</span>
            <span className="w-20">Area W ({UNIT_LABELS[unit]})</span>
            <span className="w-16">+Waste mm</span>
            <span className="w-7" />
          </div>
        )}
        {value.embosses.map((ei, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2">
            <NativeSelect aria-label="Emboss type" value={ei.type}
              onChange={(e) => patch({ embosses: value.embosses.map((f, idx) => idx === i ? { ...f, type: e.target.value as "emboss" | "deboss" } : f) })}>
              {options.relief.map((r) => <option key={r} value={r} className="capitalize">{r}</option>)}
            </NativeSelect>
            <Input className="w-20" aria-label="Emboss area L" type="number" step={dimStep(unit)} min="0" value={toDim(ei.areaL, unit)}
              onChange={(e) => patch({ embosses: value.embosses.map((f, idx) => idx === i ? { ...f, areaL: fromDim(Number(e.target.value), unit) } : f) })}
              placeholder={`L ${UNIT_LABELS[unit]}`} />
            <Input className="w-20" aria-label="Emboss area W" type="number" step={dimStep(unit)} min="0" value={toDim(ei.areaW, unit)}
              onChange={(e) => patch({ embosses: value.embosses.map((f, idx) => idx === i ? { ...f, areaW: fromDim(Number(e.target.value), unit) } : f) })}
              placeholder={`W ${UNIT_LABELS[unit]}`} />
            <Input className="w-16" aria-label="Emboss wastage (mm each side)" type="number" step="1" min="0" value={ei.wastage_mm}
              onChange={(e) => patch({ embosses: value.embosses.map((f, idx) => idx === i ? { ...f, wastage_mm: Number(e.target.value) } : f) })}
              placeholder="+mm" title="+mm wastage each side" />
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove emboss/deboss"
              onClick={() => patch({ embosses: value.embosses.filter((_, idx) => idx !== i) })}><X /></Button>
          </div>
        ))}
      </div>

      {/* Spot UV — dynamic list, area only */}
      {options.uv.some((u) => u.unit === "per_sqin") && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Spot UV (per sq inch)</span>
            <Button type="button" variant="outline" size="sm"
              onClick={() => patch({ spotUVs: [...value.spotUVs, { areaL: defaultArea.L, areaW: defaultArea.W, wastage_mm: 10 }] })}>
              <Plus data-icon="inline-start" /> Add spot UV
            </Button>
          </div>
          {value.spotUVs.length > 0 && (
            <div className="grid grid-cols-[auto_auto_auto_auto] items-center gap-2 text-xs text-muted-foreground">
              <span className="w-24">Area L ({UNIT_LABELS[unit]})</span>
              <span className="w-24">Area W ({UNIT_LABELS[unit]})</span>
              <span className="w-16">+Waste mm</span>
              <span className="w-7" />
            </div>
          )}
          {value.spotUVs.map((si, i) => (
            <div key={i} className="grid grid-cols-[auto_auto_auto_auto] items-center gap-2">
              <Input className="w-24" aria-label="Spot UV area L" type="number" step={dimStep(unit)} min="0" value={toDim(si.areaL, unit)}
                onChange={(e) => patch({ spotUVs: value.spotUVs.map((s, idx) => idx === i ? { ...s, areaL: fromDim(Number(e.target.value), unit) } : s) })}
                placeholder={`L ${UNIT_LABELS[unit]}`} />
              <Input className="w-24" aria-label="Spot UV area W" type="number" step={dimStep(unit)} min="0" value={toDim(si.areaW, unit)}
                onChange={(e) => patch({ spotUVs: value.spotUVs.map((s, idx) => idx === i ? { ...s, areaW: fromDim(Number(e.target.value), unit) } : s) })}
                placeholder={`W ${UNIT_LABELS[unit]}`} />
              <Input className="w-16" aria-label="Spot UV wastage (mm each side)" type="number" step="1" min="0" value={si.wastage_mm}
                onChange={(e) => patch({ spotUVs: value.spotUVs.map((s, idx) => idx === i ? { ...s, wastage_mm: Number(e.target.value) } : s) })}
                placeholder="+mm" title="+mm wastage each side" />
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove spot UV"
                onClick={() => patch({ spotUVs: value.spotUVs.filter((_, idx) => idx !== i) })}><X /></Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
