"use client";

// Per-component wrapping editor (client final doc item 2: "allow wrapping
// options — printing + paper + finish — to be set separately for each part of
// the box; e.g. Tray inner+outer, Case inner+outer").
//
// Each of the box type's components can override the estimate-level wrap. A
// component left OFF inherits the shared wrap, and components whose resolved
// wrap is identical still nest together and share one print job — so turning
// this on for a part that ends up configured the same costs nothing extra.
//
// Kept deliberately compact next to the main wrap block: the fields here are
// the ones that actually differ per part (stock, print size/colour, finishing).
// The folding allowance and the estimate-level Auto print size stay global —
// Auto optimises one shared layer, so a per-part wrap names its sizes.

import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { NumberField } from "@/components/ui/number-field";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import {
  FinishingPicker,
  emptyFinishing,
  fromFinishingSelections,
  toFinishingSelections,
  type FinishingValue,
} from "@/components/estimate/finishing-picker";
import type { RateOptions } from "@/lib/db/rate-options";
import type { ComponentWrap } from "@/types";

/** Form state for one component's override. */
export interface ComponentWrapState {
  enabled: boolean;
  outerMode: "inherit" | "printed" | "special";
  outerPaperSize: string;
  outerGsm: number;
  outerPrintType: "offset" | "digital";
  outerPrintSize: string;
  outerColour: "multi" | "single";
  outerSpecialSel: string; // "name|size"
  outerSpecialW: number;
  outerSpecialH: number;
  finishing: FinishingValue;
  innerMode: "inherit" | "none" | "white" | "printed" | "special";
  innerPaperSize: string;
  innerGsm: number;
  innerPrintEnabled: boolean;
  innerPrintType: "offset" | "digital";
  innerPrintSize: string;
  innerColour: "multi" | "single";
  innerWhiteSize: string;
  innerWhiteGsm: number;
  innerSpecialSel: string;
  innerSpecialW: number;
  innerSpecialH: number;
}

export function defaultComponentWrap(o: RateOptions | null): ComponentWrapState {
  const paper = o?.paper[0];
  const white = o?.whitePaper[0];
  const special = o?.specialPaper[0];
  return {
    enabled: false,
    outerMode: "inherit",
    outerPaperSize: paper?.sizeLabel ?? "",
    outerGsm: paper?.gsms[0] ?? 0,
    outerPrintType: "offset",
    outerPrintSize: o?.offsetSizes[0] ?? "",
    outerColour: "multi",
    outerSpecialSel: special ? `${special.name}|${special.sizeLabel}` : "",
    outerSpecialW: special?.sheetWidth_in ?? 0,
    outerSpecialH: special?.sheetHeight_in ?? 0,
    finishing: emptyFinishing(),
    innerMode: "inherit",
    innerPaperSize: paper?.sizeLabel ?? "",
    innerGsm: paper?.gsms[0] ?? 0,
    innerPrintEnabled: false,
    innerPrintType: "offset",
    innerPrintSize: o?.offsetSizes[0] ?? "",
    innerColour: "multi",
    innerWhiteSize: white?.sizeLabel ?? "",
    innerWhiteGsm: white?.gsms[0] ?? 0,
    innerSpecialSel: special ? `${special.name}|${special.sizeLabel}` : "",
    innerSpecialW: special?.sheetWidth_in ?? 0,
    innerSpecialH: special?.sheetHeight_in ?? 0,
  };
}

/** Request payload for one component (undefined = inherit everything). */
export function componentWrapToSelection(s: ComponentWrapState): ComponentWrap | undefined {
  if (!s.enabled) return undefined;
  const out: ComponentWrap = {};

  if (s.outerMode === "printed" && s.outerPaperSize && s.outerPrintSize) {
    out.outer = {
      mode: "printed",
      paperSizeLabel: s.outerPaperSize,
      gsm: s.outerGsm,
      printing: {
        type: s.outerPrintType,
        sizeLabel: s.outerPrintSize,
        colour: s.outerPrintType === "offset" ? s.outerColour : undefined,
      },
    };
  } else if (s.outerMode === "special" && s.outerSpecialSel) {
    out.outer = {
      mode: "special",
      specialPaperName: s.outerSpecialSel.split("|")[0],
      specialSizeLabel: s.outerSpecialSel.split("|")[1],
      sheetOverride:
        s.outerSpecialW > 0 && s.outerSpecialH > 0
          ? { width_in: s.outerSpecialW, height_in: s.outerSpecialH }
          : undefined,
    };
  }

  if (s.innerMode === "white" && s.innerWhiteSize) {
    out.inner = { mode: "white", paperSizeLabel: s.innerWhiteSize, gsm: s.innerWhiteGsm };
  } else if (s.innerMode === "printed" && s.innerPaperSize) {
    out.inner = {
      mode: "printed",
      paperSizeLabel: s.innerPaperSize,
      gsm: s.innerGsm,
      printing:
        s.innerPrintEnabled && s.innerPrintSize
          ? {
              type: s.innerPrintType,
              sizeLabel: s.innerPrintSize,
              colour: s.innerPrintType === "offset" ? s.innerColour : undefined,
            }
          : undefined,
    };
  } else if (s.innerMode === "special" && s.innerSpecialSel) {
    out.inner = {
      mode: "special",
      specialPaperName: s.innerSpecialSel.split("|")[0],
      specialSizeLabel: s.innerSpecialSel.split("|")[1],
      sheetOverride:
        s.innerSpecialW > 0 && s.innerSpecialH > 0
          ? { width_in: s.innerSpecialW, height_in: s.innerSpecialH }
          : undefined,
    };
  }

  const fin = toFinishingSelections(s.finishing);
  if (fin.length) out.finishing = fin;

  // Nothing actually overridden -> inherit (keeps the payload and the engine's
  // grouping clean rather than creating a duplicate group).
  return out.outer || out.inner || out.finishing ? out : undefined;
}

/** Hydrate state from a saved selection. */
export function componentWrapFromSelection(
  sel: ComponentWrap | undefined,
  o: RateOptions | null,
): ComponentWrapState {
  const base = defaultComponentWrap(o);
  if (!sel) return base;
  const s: ComponentWrapState = { ...base, enabled: true };

  if (sel.outer?.mode === "printed") {
    s.outerMode = "printed";
    s.outerPaperSize = sel.outer.paperSizeLabel ?? base.outerPaperSize;
    s.outerGsm = sel.outer.gsm;
    s.outerPrintType = sel.outer.printing.type;
    s.outerPrintSize = sel.outer.printing.sizeLabel ?? base.outerPrintSize;
    s.outerColour = sel.outer.printing.colour ?? "multi";
  } else if (sel.outer?.mode === "special") {
    s.outerMode = "special";
    s.outerSpecialSel = `${sel.outer.specialPaperName}|${sel.outer.specialSizeLabel}`;
    s.outerSpecialW = sel.outer.sheetOverride?.width_in ?? base.outerSpecialW;
    s.outerSpecialH = sel.outer.sheetOverride?.height_in ?? base.outerSpecialH;
  }

  if (sel.inner?.mode === "white") {
    s.innerMode = "white";
    s.innerWhiteSize = sel.inner.paperSizeLabel;
    s.innerWhiteGsm = sel.inner.gsm;
  } else if (sel.inner?.mode === "special") {
    s.innerMode = "special";
    s.innerSpecialSel = `${sel.inner.specialPaperName}|${sel.inner.specialSizeLabel}`;
    s.innerSpecialW = sel.inner.sheetOverride?.width_in ?? base.innerSpecialW;
    s.innerSpecialH = sel.inner.sheetOverride?.height_in ?? base.innerSpecialH;
  } else if (sel.inner) {
    s.innerMode = "printed";
    s.innerPaperSize = sel.inner.paperSizeLabel ?? base.innerPaperSize;
    s.innerGsm = sel.inner.gsm;
    s.innerPrintEnabled = sel.inner.printing != null;
    s.innerPrintType = sel.inner.printing?.type ?? "offset";
    s.innerPrintSize = sel.inner.printing?.sizeLabel ?? base.innerPrintSize;
    s.innerColour = sel.inner.printing?.colour ?? "multi";
  }

  s.finishing = fromFinishingSelections(sel.finishing);
  return s;
}

/** Editor for ONE component. */
export function ComponentWrapFields({
  component,
  state,
  onChange,
  options,
  defaultArea,
}: {
  component: string;
  state: ComponentWrapState;
  onChange: (patch: Partial<ComponentWrapState>) => void;
  options: RateOptions;
  defaultArea: { L: number; W: number };
}) {
  const s = state;
  const gsmsFor = (size: string) =>
    options.paper.find((p) => p.sizeLabel === size)?.gsms ?? [];
  const whiteGsmsFor = (size: string) =>
    options.whitePaper.find((p) => p.sizeLabel === size)?.gsms ?? [];
  const printSizes = (t: "offset" | "digital") =>
    t === "offset" ? options.offsetSizes : options.digitalSizes;
  const id = `pcw-${component}`;

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center gap-2.5">
        <Switch
          id={id}
          checked={s.enabled}
          onCheckedChange={(on) => onChange({ enabled: on })}
        />
        <Label htmlFor={id} className="capitalize">
          {component.replace(/_/g, " ")}
        </Label>
        {!s.enabled && (
          <span className="text-xs text-muted-foreground">uses the box wrap</span>
        )}
      </div>

      {s.enabled && (
        <div className="flex flex-col gap-3">
          {/* Outer */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs text-muted-foreground">Outer wrap</Label>
            <Segmented
              size="sm"
              value={s.outerMode}
              onValueChange={(m) => onChange({ outerMode: m })}
              options={[
                { value: "inherit", label: "Same as box" },
                { value: "printed", label: "Printed paper" },
                { value: "special", label: "Special paper" },
              ]}
            />
            {s.outerMode === "printed" && (
              <div className="grid grid-cols-2 gap-2">
                <Segmented
                  size="sm"
                  value={s.outerPrintType}
                  onValueChange={(t) =>
                    onChange({ outerPrintType: t, outerPrintSize: printSizes(t)[0] ?? "" })
                  }
                  options={[
                    { value: "offset", label: "Offset" },
                    { value: "digital", label: "Digital" },
                  ]}
                />
                <NativeSelect
                  aria-label="Print size"
                  value={s.outerPrintSize}
                  onChange={(e) => onChange({ outerPrintSize: e.target.value })}
                >
                  {printSizes(s.outerPrintType).map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label="Paper size"
                  value={s.outerPaperSize}
                  onChange={(e) =>
                    onChange({
                      outerPaperSize: e.target.value,
                      outerGsm: gsmsFor(e.target.value)[0] ?? 0,
                    })
                  }
                >
                  {options.paper.map((p) => (
                    <option key={p.sizeLabel} value={p.sizeLabel}>{p.sizeLabel}</option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label="Paper GSM"
                  value={s.outerGsm}
                  onChange={(e) => onChange({ outerGsm: Number(e.target.value) })}
                >
                  {gsmsFor(s.outerPaperSize).map((g) => (
                    <option key={g} value={g}>{g} gsm</option>
                  ))}
                </NativeSelect>
                {s.outerPrintType === "offset" && (
                  <Segmented
                    size="sm"
                    value={s.outerColour}
                    onValueChange={(v) => onChange({ outerColour: v })}
                    options={[
                      { value: "multi", label: "Multicolour" },
                      { value: "single", label: "Single colour", disabled: !options.offsetSingleColour },
                    ]}
                  />
                )}
              </div>
            )}
            {s.outerMode === "special" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <NativeSelect
                    aria-label="Special paper"
                    value={s.outerSpecialSel}
                    onChange={(e) => {
                      const sp = options.specialPaper.find(
                        (p) => `${p.name}|${p.sizeLabel}` === e.target.value,
                      );
                      onChange({
                        outerSpecialSel: e.target.value,
                        outerSpecialW: sp?.sheetWidth_in ?? s.outerSpecialW,
                        outerSpecialH: sp?.sheetHeight_in ?? s.outerSpecialH,
                      });
                    }}
                  >
                    {options.specialPaper.map((p) => (
                      <option key={`${p.name}|${p.sizeLabel}`} value={`${p.name}|${p.sizeLabel}`}>
                        {p.name} ({p.sizeLabel})
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <NumberField
                  aria-label="Sheet width"
                  step="0.1"
                  min="0"
                  value={s.outerSpecialW}
                  onValueChange={(n) => onChange({ outerSpecialW: n })}
                />
                <NumberField
                  aria-label="Sheet height"
                  step="0.1"
                  min="0"
                  value={s.outerSpecialH}
                  onValueChange={(n) => onChange({ outerSpecialH: n })}
                />
              </div>
            )}
          </div>

          {/* Inner */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs text-muted-foreground">Inner lining</Label>
            <Segmented
              size="sm"
              value={s.innerMode}
              onValueChange={(m) => onChange({ innerMode: m })}
              options={[
                { value: "inherit", label: "Same as box" },
                { value: "white", label: "White", disabled: options.whitePaper.length === 0 },
                { value: "printed", label: "Printed" },
                { value: "special", label: "Special" },
              ]}
            />
            {s.innerMode === "white" && (
              <div className="grid grid-cols-2 gap-2">
                <NativeSelect
                  aria-label="White paper size"
                  value={s.innerWhiteSize}
                  onChange={(e) =>
                    onChange({
                      innerWhiteSize: e.target.value,
                      innerWhiteGsm: whiteGsmsFor(e.target.value)[0] ?? 0,
                    })
                  }
                >
                  {options.whitePaper.map((p) => (
                    <option key={p.sizeLabel} value={p.sizeLabel}>{p.sizeLabel}</option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label="White paper GSM"
                  value={s.innerWhiteGsm}
                  onChange={(e) => onChange({ innerWhiteGsm: Number(e.target.value) })}
                >
                  {whiteGsmsFor(s.innerWhiteSize).map((g) => (
                    <option key={g} value={g}>{g} gsm</option>
                  ))}
                </NativeSelect>
              </div>
            )}
            {s.innerMode === "printed" && (
              <div className="grid grid-cols-2 gap-2">
                <NativeSelect
                  aria-label="Inner paper size"
                  value={s.innerPaperSize}
                  onChange={(e) =>
                    onChange({
                      innerPaperSize: e.target.value,
                      innerGsm: gsmsFor(e.target.value)[0] ?? 0,
                    })
                  }
                >
                  {options.paper.map((p) => (
                    <option key={p.sizeLabel} value={p.sizeLabel}>{p.sizeLabel}</option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label="Inner paper GSM"
                  value={s.innerGsm}
                  onChange={(e) => onChange({ innerGsm: Number(e.target.value) })}
                >
                  {gsmsFor(s.innerPaperSize).map((g) => (
                    <option key={g} value={g}>{g} gsm</option>
                  ))}
                </NativeSelect>
                <div className="col-span-2 flex items-center gap-2.5">
                  <Switch
                    id={`${id}-innerprint`}
                    checked={s.innerPrintEnabled}
                    onCheckedChange={(on) => onChange({ innerPrintEnabled: on })}
                  />
                  <Label htmlFor={`${id}-innerprint`} className="text-xs">Printed lining</Label>
                </div>
                {s.innerPrintEnabled && (
                  <>
                    <Segmented
                      size="sm"
                      value={s.innerPrintType}
                      onValueChange={(t) =>
                        onChange({ innerPrintType: t, innerPrintSize: printSizes(t)[0] ?? "" })
                      }
                      options={[
                        { value: "offset", label: "Offset" },
                        { value: "digital", label: "Digital" },
                      ]}
                    />
                    <NativeSelect
                      aria-label="Inner print size"
                      value={s.innerPrintSize}
                      onChange={(e) => onChange({ innerPrintSize: e.target.value })}
                    >
                      {printSizes(s.innerPrintType).map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </NativeSelect>
                  </>
                )}
              </div>
            )}
            {s.innerMode === "special" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <NativeSelect
                    aria-label="Inner special paper"
                    value={s.innerSpecialSel}
                    onChange={(e) => {
                      const sp = options.specialPaper.find(
                        (p) => `${p.name}|${p.sizeLabel}` === e.target.value,
                      );
                      onChange({
                        innerSpecialSel: e.target.value,
                        innerSpecialW: sp?.sheetWidth_in ?? s.innerSpecialW,
                        innerSpecialH: sp?.sheetHeight_in ?? s.innerSpecialH,
                      });
                    }}
                  >
                    {options.specialPaper.map((p) => (
                      <option key={`${p.name}|${p.sizeLabel}`} value={`${p.name}|${p.sizeLabel}`}>
                        {p.name} ({p.sizeLabel})
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <NumberField
                  aria-label="Inner sheet width"
                  step="0.1"
                  min="0"
                  value={s.innerSpecialW}
                  onValueChange={(n) => onChange({ innerSpecialW: n })}
                />
                <NumberField
                  aria-label="Inner sheet height"
                  step="0.1"
                  min="0"
                  value={s.innerSpecialH}
                  onValueChange={(n) => onChange({ innerSpecialH: n })}
                />
              </div>
            )}
          </div>

          <FinishingPicker
            label={`${component.replace(/_/g, " ")} finishing`}
            options={options}
            value={s.finishing}
            onChange={(v) => onChange({ finishing: v })}
            defaultArea={defaultArea}
          />
        </div>
      )}
    </div>
  );
}
