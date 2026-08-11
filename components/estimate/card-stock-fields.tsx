"use client";

// Shared Material / Printing / Lamination fields for the round-5 card-stock
// inserts (client 13-Jul: Beading, Card partition, Custom card partition each
// list "Material, Printing, Lamination"). Material = the foam-cover trio (art
// paper / board with type / special paper, incl. the pre-migration disable
// states); Printing = offset/digital + explicit size (Auto is an outer/inner-
// wrap feature) + colour; Lamination = a single dropdown — these inserts get
// exactly one lamination pass, so a full FinishingPicker would be noise.

import { useEffect } from "react";

import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { NumberField } from "@/components/ui/number-field";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import type { RateOptions } from "@/lib/db/rate-options";
import type { CardStockSelection } from "@/types";
import { DEFAULT_BOARD_TYPE } from "@/types";

/** Form state for one card stock. Kept while hidden; mapped on submit. */
export interface CardStockState {
  material: "art_paper" | "art_card" | "special";
  boardType: string;
  paperSize: string;
  gsm: number;
  specialSel: string; // "name|size"
  specialSheetW: number;
  specialSheetH: number;
  printingEnabled: boolean;
  printingType: "offset" | "digital";
  printingSize: string;
  printingColour: "multi" | "single";
  /** Lamination type ("" = none) -> FinishingSelection kind "lamination". */
  lamination: string;
}

export function defaultCardStock(options: RateOptions | null): CardStockState {
  return {
    material: "art_paper",
    boardType: options?.artCard[0]?.type ?? DEFAULT_BOARD_TYPE,
    paperSize: options?.paper[0]?.sizeLabel ?? "",
    gsm: options?.paper[0]?.gsms[0] ?? 0,
    specialSel: options?.specialPaper[0]
      ? `${options.specialPaper[0].name}|${options.specialPaper[0].sizeLabel}`
      : "",
    specialSheetW: options?.specialPaper[0]?.sheetWidth_in ?? 0,
    specialSheetH: options?.specialPaper[0]?.sheetHeight_in ?? 0,
    printingEnabled: false,
    printingType: "offset",
    printingSize: options?.offsetSizes[0] ?? "",
    printingColour: "multi",
    lamination: "",
  };
}

/** Request payload for a state (validated server-side). */
export function cardStockToSelection(s: CardStockState): CardStockSelection {
  return {
    material: s.material,
    boardType: s.material === "art_card" ? s.boardType : undefined,
    paperSizeLabel: s.material !== "special" ? s.paperSize : undefined,
    gsm: s.material !== "special" ? s.gsm : undefined,
    specialPaperName: s.material === "special" ? s.specialSel.split("|")[0] : undefined,
    specialSizeLabel: s.material === "special" ? s.specialSel.split("|")[1] : undefined,
    sheetOverride:
      s.material === "special" && s.specialSheetW > 0 && s.specialSheetH > 0
        ? { width_in: s.specialSheetW, height_in: s.specialSheetH }
        : undefined,
    printing:
      s.printingEnabled && s.printingSize
        ? {
            type: s.printingType,
            sizeLabel: s.printingSize,
            colour: s.printingType === "offset" ? s.printingColour : undefined,
          }
        : undefined,
    lamination: s.lamination ? [{ kind: "lamination", key: s.lamination }] : undefined,
  };
}

/** Hydrate state from a saved selection (defensive — old/partial snapshots). */
export function cardStockFromSelection(
  sel: CardStockSelection | undefined,
  options: RateOptions | null,
): CardStockState {
  const base = defaultCardStock(options);
  if (!sel) return base;
  return {
    ...base,
    material: sel.material ?? "art_paper",
    boardType: sel.boardType ?? base.boardType,
    paperSize: sel.paperSizeLabel ?? base.paperSize,
    gsm: sel.gsm ?? base.gsm,
    specialSel:
      sel.specialPaperName && sel.specialSizeLabel
        ? `${sel.specialPaperName}|${sel.specialSizeLabel}`
        : base.specialSel,
    specialSheetW: sel.sheetOverride?.width_in ?? base.specialSheetW,
    specialSheetH: sel.sheetOverride?.height_in ?? base.specialSheetH,
    printingEnabled: !!sel.printing,
    printingType: sel.printing?.type ?? "offset",
    printingSize: sel.printing?.sizeLabel ?? base.printingSize,
    printingColour: sel.printing?.colour ?? "multi",
    lamination: sel.lamination?.[0]?.key ?? "",
  };
}

/** The rendered field block. `idPrefix` keeps input ids unique per insert.
 *  `hideLamination` — the round-6 sleeve renders a FULL FinishingPicker of its
 *  own instead of the single lamination dropdown. */
export function CardStockFields({
  idPrefix,
  state,
  onChange,
  options,
  hideLamination = false,
}: {
  idPrefix: string;
  state: CardStockState;
  onChange: (patch: Partial<CardStockState>) => void;
  options: RateOptions;
  hideLamination?: boolean;
}) {
  const s = state;
  const boardTypes = [...new Set(options.artCard.map((x) => x.type))];
  const boardStock = (t: string) => options.artCard.filter((x) => x.type === t);
  // The board type in state may not exist on the rate card: snapshots saved
  // before the Type column fall back to DEFAULT_BOARD_TYPE ("Art card"), and
  // the client has since renamed their rows (CyberXL, Duplex White Board, …).
  // Without this, boardStock() returns [] and the size/GSM selects render EMPTY
  // while the type select — having no matching <option> — paints the first type
  // anyway, so the picker looks broken. Same guard the foam-cover block uses.
  const effectiveBoardType = boardTypes.includes(s.boardType)
    ? s.boardType
    : boardTypes[0] ?? s.boardType;
  const list = s.material === "art_card" ? boardStock(effectiveBoardType) : options.paper;
  const gsms = list.find((x) => x.sizeLabel === s.paperSize)?.gsms ?? [];
  const printSizes = s.printingType === "offset" ? options.offsetSizes : options.digitalSizes;

  // Heal the stale value in STATE too — the picker showing a valid type while
  // the request still carries a dead one would fail to resolve server-side.
  useEffect(() => {
    if (boardTypes.length === 0 || boardTypes.includes(s.boardType)) return;
    const next = boardStock(effectiveBoardType);
    const keep = next.find((x) => x.sizeLabel === s.paperSize) ?? next[0];
    onChange({
      boardType: effectiveBoardType,
      ...(s.material === "art_card"
        ? {
            paperSize: keep?.sizeLabel ?? "",
            gsm: keep?.gsms.includes(s.gsm) ? s.gsm : keep?.gsms[0] ?? 0,
          }
        : {}),
    });
    // onChange is re-created each render by the parent; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBoardType, s.boardType, s.material, boardTypes.length]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <Segmented
          size="sm"
          value={s.material}
          onValueChange={(m) => {
            const nextList = m === "art_card" ? boardStock(effectiveBoardType) : options.paper;
            onChange({
              material: m,
              boardType: effectiveBoardType,
              paperSize: nextList[0]?.sizeLabel ?? "",
              gsm: nextList[0]?.gsms[0] ?? 0,
            });
          }}
          options={[
            { value: "art_paper", label: "Art paper" },
            {
              value: "art_card",
              label: options.artCard.length === 0 ? "Board (no rates yet)" : "Board",
              disabled: options.artCard.length === 0,
            },
            { value: "special", label: "Special paper" },
          ]}
        />
      </div>

      {s.material === "special" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <NativeSelect
              aria-label="Special paper"
              value={s.specialSel}
              onChange={(e) => {
                const sp = options.specialPaper.find((p) => `${p.name}|${p.sizeLabel}` === e.target.value);
                onChange({
                  specialSel: e.target.value,
                  specialSheetW: sp?.sheetWidth_in ?? s.specialSheetW,
                  specialSheetH: sp?.sheetHeight_in ?? s.specialSheetH,
                });
              }}
            >
              {options.specialPaper.map((p) => (
                <option key={`${p.name}|${p.sizeLabel}`} value={`${p.name}|${p.sizeLabel}`}>
                  {p.name} ({p.sizeLabel}{p.gsm != null ? `, ${p.gsm} GSM` : ""})
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Sheet width (in)</Label>
            <NumberField step="0.1" min="0" value={s.specialSheetW} onValueChange={(n) => onChange({ specialSheetW: n })} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Sheet height (in)</Label>
            <NumberField step="0.1" min="0" value={s.specialSheetH} onValueChange={(n) => onChange({ specialSheetH: n })} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {s.material === "art_card" && boardTypes.length > 1 && (
            <div className="col-span-2 flex flex-col gap-2">
              <Label>Board type</Label>
              <NativeSelect
                aria-label="Board type"
                value={effectiveBoardType}
                onChange={(e) => {
                  const t = e.target.value;
                  const nextList = boardStock(t);
                  const keep = nextList.find((x) => x.sizeLabel === s.paperSize) ?? nextList[0];
                  onChange({
                    boardType: t,
                    paperSize: keep?.sizeLabel ?? "",
                    gsm: keep?.gsms.includes(s.gsm) ? s.gsm : keep?.gsms[0] ?? 0,
                  });
                }}
              >
                {boardTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </NativeSelect>
            </div>
          )}
          <NativeSelect
            aria-label="Stock size"
            value={s.paperSize}
            onChange={(e) =>
              onChange({
                paperSize: e.target.value,
                gsm: list.find((x) => x.sizeLabel === e.target.value)?.gsms[0] ?? 0,
              })
            }
          >
            {list.map((p) => <option key={p.sizeLabel} value={p.sizeLabel}>{p.sizeLabel}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Stock GSM" value={s.gsm} onChange={(e) => onChange({ gsm: Number(e.target.value) })}>
            {gsms.map((g) => <option key={g} value={g}>{g} gsm</option>)}
          </NativeSelect>
        </div>
      )}

      <div className="flex items-center gap-2.5">
        <Switch
          id={`${idPrefix}-print`}
          checked={s.printingEnabled}
          onCheckedChange={(on) => onChange({ printingEnabled: on })}
        />
        <Label htmlFor={`${idPrefix}-print`}>Printed</Label>
      </div>
      {s.printingEnabled && (
        <div className="grid grid-cols-2 gap-3">
          <Segmented
            size="sm"
            value={s.printingType}
            onValueChange={(t) =>
              onChange({
                printingType: t,
                printingSize: (t === "offset" ? options.offsetSizes : options.digitalSizes)[0] ?? "",
              })
            }
            options={[
              { value: "offset", label: "Offset" },
              { value: "digital", label: "Digital" },
            ]}
          />
          <NativeSelect
            aria-label="Print size"
            value={s.printingSize}
            onChange={(e) => onChange({ printingSize: e.target.value })}
          >
            {printSizes.map((p) => <option key={p} value={p}>{p}</option>)}
          </NativeSelect>
          {s.printingType === "offset" && (
            <Segmented
              size="sm"
              value={s.printingColour}
              onValueChange={(v) => onChange({ printingColour: v })}
              options={[
                { value: "multi", label: "Multicolour" },
                { value: "single", label: "Single colour", disabled: !options.offsetSingleColour },
              ]}
            />
          )}
          <p className="col-span-2 -mt-1 text-xs text-muted-foreground">
            Pieces nest on the print size; stock is bought to fit it (+10% printing wastage).
          </p>
        </div>
      )}

      {!hideLamination && (
        <div className="flex items-center gap-3">
          <Label className="text-xs text-muted-foreground" htmlFor={`${idPrefix}-lam`}>
            Lamination
          </Label>
          <NativeSelect
            id={`${idPrefix}-lam`}
            className="w-44"
            value={s.lamination}
            onChange={(e) => onChange({ lamination: e.target.value })}
          >
            <option value="">None</option>
            {options.lamination.map((t) => <option key={t} value={t}>{t}</option>)}
          </NativeSelect>
        </div>
      )}
    </div>
  );
}
