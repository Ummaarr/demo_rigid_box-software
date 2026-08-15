"use client";

import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useShake } from "@/hooks/use-shake";
import {
  EMPTY_FILTERS,
  rowContext,
  rowPasses,
  type RateFilters,
} from "@/lib/rates/filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { InlineNotice } from "@/components/ui/inline-notice";

// Types mirrored from lib/db/rate-admin (no server-only import needed here).
export interface ColDef {
  field: string;
  label: string;
  type?: "date";
}

export interface SectionDef {
  id: string;
  label: string;
  /** Category filter chip this section sits under (client 18-Jul). */
  category: string;
  table: string;
  idField: "id" | "key";
  keyCols: ColDef[];
  editCols: ColDef[];
  textEditCols?: ColDef[];
  /** Key column fields editable inline (click-to-edit). */
  editableKeys?: string[];
  hasDummy: boolean;
  /** Billing unit shown in the section header (client 4-Jul). */
  unitLabel?: string;
  hasImage?: boolean;
  /** Template for the add-row form (keys = fields, values = defaults). */
  newRowTemplate?: Record<string, string | number>;
  rows: Record<string, unknown>[];
}

interface EditState {
  rowId: unknown;
  field: string;
  value: string;
  isText?: boolean;
}

function fmtDate(val: unknown): string {
  if (!val || typeof val !== "string") return "—";
  const d = new Date(val);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

/**
 * A row whose size label disagrees with its own width/height columns — e.g.
 * "30x 20" saved with 23x22 in. The engine nests on the DIMENSIONS, so such a
 * row silently costs the wrong sheet and surfaces later as a confusing
 * "print doesn't fit the paper" error. Flag it where it's fixable.
 * Labels that aren't a plain WxH pair never warn (A4, Custom, …).
 */
function sizeMismatch(row: Record<string, unknown>): string | null {
  const label = row.size_label;
  if (typeof label !== "string") return null;
  const m = label.match(/^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*$/i);
  if (!m) return null;
  // Paper/print tables use width_in/height_in; window film uses film_*.
  const w = Number(row.width_in ?? row.film_width_in);
  const h = Number(row.height_in ?? row.film_height_in);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if ((a === w && b === h) || (a === h && b === w)) return null;
  return `Name says ${a}×${b} but the sheet is ${w}×${h} in — costing uses ${w}×${h}.`;
}

// Friendly display names for config keys. The coded key stays in the DB (all
// engine/config lookups use it); this is presentation only. Unmapped keys fall
// back to a humanized form.
const CONFIG_LABELS: Record<string, string> = {
  folding_allowance_mm: "Folding allowance",
  inner_lining_reduction_mm: "Inner lining reduction",
  lid_depth_default_in: "Default lid depth",
  moq: "Minimum order qty (MOQ)",
  overhead_pct: "Overhead",
  print_wastage_pct: "Print wastage (printing only)",
  print_foil_wastage_pct: "Print wastage (printing + foil/UV)",
  default_margin_pct: "Default margin",
};

function configLabel(key: unknown): string {
  if (typeof key !== "string") return String(key ?? "—");
  return (
    CONFIG_LABELS[key] ??
    key
      .replace(/_(mm|in|pct)$/, "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase())
  );
}

type PatchResult = { updated_at?: string; updated_by?: string | null };

async function patchRate(table: string, id: unknown, field: string, value: unknown): Promise<PatchResult> {
  const r = await fetch("/api/rates", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table, id, field, value }),
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string } & PatchResult;
  if (!r.ok) throw new Error(j.error ?? "Update failed");
  return j;
}

async function insertRate(table: string, fields: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch("/api/rates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table, fields }),
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string; row?: Record<string, unknown> };
  if (!r.ok) throw new Error(j.error ?? "Insert failed");
  return j.row ?? {};
}

async function proposeRate(
  table: string,
  id: unknown,
  field: string,
  value: unknown,
  rowLabel: string,
): Promise<void> {
  const r = await fetch("/api/rates/propose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table, id, field, value, rowLabel }),
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? "Proposal failed");
  }
}

export function RateSection({
  section: initial,
  role = "admin",
  filters = EMPTY_FILTERS,
}: {
  section: SectionDef;
  /** Staff (round 3) see rates read-only and PROPOSE changes instead of editing. */
  role?: "admin" | "staff" | null;
  /** Active rate-card search + filters (client 18-Jul). Default = show everything. */
  filters?: RateFilters;
}) {
  const isAdmin = role === "admin";
  // Adding / deleting catalogue rows is open to STAFF as well (client final
  // doc: "Staff Access: should be able to add and delete materials"). Editing
  // an existing rate stays admin-only — staff propose those (round 3), because
  // an edit moves the price of every future estimate while an add/delete
  // cannot: saved estimates carry their own rates_snapshot. Sections without a
  // newRowTemplate are config, not a rate table, and stay unmanageable.
  const canManageRows = !!initial.newRowTemplate;
  const [rows, setRows] = useState(initial.rows);
  // Rows added in this session stay visible even when they don't match the
  // active search — a row vanishing the instant it saves reads as a failure.
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  // Shake the cell being edited when the typed value is rejected (empty /
  // negative / NaN) instead of silently reverting.
  const { ref: editRef, shake: shakeEdit } = useShake<HTMLInputElement>();
  const [imgVer, setImgVer] = useState<Record<string, number>>({});

  // Add-row state: null = hidden; object = the in-progress new row values.
  const [addingRow, setAddingRow] = useState<Record<string, string | number> | null>(null);
  const [addErr, setAddErr] = useState<string | null>(null);
  // Photo picked while adding a row — uploaded right after the insert returns
  // the new row id (client 8-Jul: "add images along with the details").
  const [addImage, setAddImage] = useState<File | null>(null);

  const { textEditCols = [], editableKeys = [] } = initial;
  const editableKeySet = new Set(editableKeys);
  const { idField, table, hasDummy, hasImage } = initial;

  // Human-readable row description stored on proposals so the approver can
  // read "Foam Inserts — XLPE 20mm" without joining tables.
  function rowLabelFor(row: Record<string, unknown> | undefined): string {
    if (!row) return initial.label;
    const keys = initial.keyCols
      .filter((c) => c.type !== "date" && c.field !== "updated_by")
      .map((c) => row[c.field])
      .filter((v) => v != null && v !== "")
      .slice(0, 3)
      .join(" ");
    return `${initial.label}${keys ? ` — ${keys}` : ""}`;
  }

  /** Raw upload (no saving-state guard) — shared by row edits and add-row. */
  async function postImage(rowId: unknown, file: File): Promise<string> {
    const fd = new FormData();
    fd.append("table", table);
    fd.append("id", String(rowId));
    fd.append("image", file);
    const r = await fetch("/api/rates/image", { method: "POST", body: fd });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? "Upload failed");
    }
    const j = (await r.json()) as { path: string };
    setImgVer((v) => ({ ...v, [String(rowId)]: (v[String(rowId)] ?? 0) + 1 }));
    return j.path;
  }

  async function uploadImage(rowId: unknown, file: File) {
    if (saving) return;
    setSaving(true);
    setErr(null);
    try {
      const path = await postImage(rowId, file);
      setRows((prev) => prev.map((row) => row[idField] === rowId ? { ...row, image_path: path } : row));
    } catch (e) {
      setErr((e as Error).message);
    }
    setSaving(false);
  }

  async function commitEdit() {
    if (!editing || saving) return;
    const { rowId, field, isText } = editing;
    const row = rows.find((r) => r[idField] === rowId);

    let newValue: string | number;
    if (isText) {
      newValue = editing.value.trim();
      if (row && (row[field] ?? "") === newValue) { setEditing(null); return; }
    } else {
      const num = parseFloat(editing.value);
      // Reject empty / negative / non-numeric — shake and keep editing so the
      // user can correct it (Escape still cancels).
      if (isNaN(num) || num < 0) { shakeEdit(); return; }
      if (row && Number(row[field]) === num) { setEditing(null); return; }
      newValue = num;
    }

    setSaving(true);
    setErr(null);
    setNotice(null);
    try {
      if (!isAdmin) {
        // Staff: the change is PROPOSED, not applied — the row keeps its
        // current value until an admin approves (round 3 workflow).
        await proposeRate(table, rowId, field, newValue, rowLabelFor(row));
        setNotice("Change proposed — an admin will review it.");
      } else {
        const res = await patchRate(table, rowId, field, newValue);
        if (!isText && hasDummy && row?.is_dummy === true) {
          await patchRate(table, rowId, "is_dummy", false);
        }
        setRows((prev) =>
          prev.map((r) =>
            r[idField] === rowId
              ? {
                  ...r,
                  [field]: newValue,
                  ...(res.updated_at ? { updated_at: res.updated_at } : {}),
                  ...(res.updated_by != null ? { updated_by: res.updated_by } : {}),
                  ...(!isText && hasDummy ? { is_dummy: false } : {}),
                }
              : r,
          ),
        );
      }
    } catch (e) {
      setErr((e as Error).message);
    }
    setSaving(false);
    setEditing(null);
  }

  async function deleteRow(rowId: unknown, row: Record<string, unknown>) {
    const ok = await confirm({
      title: "Delete this rate?",
      subject: rowLabelFor(row),
      body: "Saved estimates keep their own rate snapshots and are unaffected.",
    });
    if (!ok) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`/api/rates?table=${encodeURIComponent(table)}&id=${encodeURIComponent(String(rowId))}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Delete failed");
      }
      setRows((prev) => prev.filter((x) => x[idField] !== rowId));
    } catch (e) {
      setErr((e as Error).message);
    }
    setSaving(false);
  }

  async function toggleDummy(rowId: unknown, current: boolean) {
    setSaving(true);
    setErr(null);
    try {
      const res = await patchRate(table, rowId, "is_dummy", !current);
      setRows((prev) => prev.map((r) => r[idField] === rowId
        ? { ...r, is_dummy: !current, ...(res.updated_at ? { updated_at: res.updated_at } : {}) }
        : r));
    } catch (e) {
      setErr((e as Error).message);
    }
    setSaving(false);
  }

  async function commitAddRow() {
    if (!addingRow || saving) return;
    setSaving(true);
    setAddErr(null);
    try {
      const inserted = await insertRate(table, addingRow);
      // Photo picked during add: the insert response carries the new row id,
      // so the image can be attached in the same flow (client 8-Jul).
      let imagePath: string | null = null;
      if (addImage && hasImage && inserted[idField] != null) {
        imagePath = await postImage(inserted[idField], addImage);
      }
      setRows((prev) => [...prev, imagePath ? { ...inserted, image_path: imagePath } : inserted]);
      if (inserted[idField] != null) {
        setAddedIds((prev) => new Set(prev).add(String(inserted[idField])));
      }
      setAddingRow(null);
      setAddImage(null);
    } catch (e) {
      setAddErr((e as Error).message);
    }
    setSaving(false);
  }

  // Determine if a key col field is a number (for add-row input type).
  function isNumericField(field: string, rows: Record<string, unknown>[]): boolean {
    const sample = rows.find((r) => r[field] != null);
    if (!sample) return typeof (initial.newRowTemplate?.[field]) === "number";
    return typeof sample[field] === "number";
  }

  // Search + filters (client 18-Jul), against the section's LIVE rows so an
  // inline edit re-filters immediately. Same matcher the toolbar uses to decide
  // whether this section renders at all.
  const ctx = rowContext({ ...initial, rows }, filters);
  const visibleRows = rows.filter(
    (r) => addedIds.has(String(r[idField])) || rowPasses(r, ctx, filters),
  );

  const allCols = [...initial.keyCols, ...initial.editCols, ...(textEditCols ?? [])];
  // For the add-row form, show all template fields in column order.
  const templateFields = initial.newRowTemplate ? Object.keys(initial.newRowTemplate) : [];
  const addRowColDefs: ColDef[] = templateFields.map((f) => {
    const found = allCols.find((c) => c.field === f);
    return found ?? { field: f, label: f };
  });

  function renderEditableCell(
    rowId: unknown,
    field: string,
    rawVal: unknown,
    isText: boolean,
    className?: string,
  ) {
    const isEditing = editing?.rowId === rowId && editing?.field === field;
    return isEditing ? (
      <input
        autoFocus
        ref={isText ? undefined : editRef}
        type={isText ? "text" : "number"}
        step={isText ? undefined : "0.01"}
        min={isText ? undefined : "0"}
        maxLength={isText ? 200 : undefined}
        disabled={saving}
        className={`t-shake rounded border px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary ${className ?? "w-28"}`}
        value={editing.value}
        // Select all on focus so typing replaces the current value (no stuck
        // leading zero when editing an existing rate).
        onFocus={(e) => e.target.select()}
        onChange={(e) => setEditing((prev) => prev ? { ...prev, value: e.target.value } : null)}
        onBlur={() => void commitEdit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commitEdit();
          if (e.key === "Escape") setEditing(null);
        }}
      />
    ) : (
      <button
        type="button"
        title={isAdmin ? "Click to edit" : "Click to propose a change (admin approves)"}
        className={`text-sm transition-colors hover:text-primary ${isText ? "text-muted-foreground hover:text-foreground" : "tabular-nums"}`}
        onClick={() => setEditing({ rowId, field, value: String(rawVal ?? ""), isText })}
      >
        {isText
          ? rawVal ? String(rawVal) : <span className="text-xs italic opacity-50">—</span>
          : typeof rawVal === "number"
            ? rawVal % 1 === 0 ? String(rawVal) : rawVal.toFixed(2)
            : String(rawVal ?? "—")}
      </button>
    );
  }

  return (
    <Card>
      {confirmDialog}
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <CardTitle className="text-sm font-semibold">{initial.label}</CardTitle>
            {initial.unitLabel && (
              <span className="text-xs text-muted-foreground">({initial.unitLabel})</span>
            )}
            {visibleRows.length !== rows.length && (
              <span className="text-xs text-muted-foreground">
                {visibleRows.length} of {rows.length} rows
              </span>
            )}
          </div>
          {canManageRows && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving || !!addingRow}
              onClick={() => setAddingRow({ ...initial.newRowTemplate! })}
            >
              + Add row
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <InlineNotice kind="error">{err}</InlineNotice>
        <InlineNotice kind="success" onDismiss={() => setNotice(null)}>
          {notice}
        </InlineNotice>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                {hasImage && <th className="whitespace-nowrap pb-2 pr-4 font-normal">Photo</th>}
                {initial.keyCols.map((c) => (
                  <th key={c.field} className="whitespace-nowrap pb-2 pr-6 font-normal">
                    {c.label}{editableKeySet.has(c.field) ? " ✎" : ""}
                  </th>
                ))}
                {initial.editCols.map((c) => (
                  <th key={c.field} className="whitespace-nowrap pb-2 pr-4 text-right font-normal">{c.label}</th>
                ))}
                {textEditCols.map((c) => (
                  <th key={c.field} className="whitespace-nowrap pb-2 pr-4 font-normal">{c.label}</th>
                ))}
                {hasDummy && <th className="pb-2 text-right font-normal">Status</th>}
                {canManageRows && <th className="w-8 pb-2" />}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, i) => {
                const rowId = row[idField];
                const isDummy = row.is_dummy as boolean | undefined;
                const mismatch = sizeMismatch(row);
                return (
                  <tr key={String(rowId ?? i)} className="border-b border-dashed last:border-0">
                    {hasImage && (
                      <td className="py-2 pr-4">
                        <label
                          className={isAdmin ? "inline-flex cursor-pointer" : "inline-flex"}
                          title={isAdmin ? "Click to upload / replace photo (PNG, JPEG, WebP — max 2 MB)" : undefined}
                        >
                          {row.image_path ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`/api/rates/image?table=${table}&id=${String(rowId)}&v=${imgVer[String(rowId)] ?? 0}`}
                              alt=""
                              className="h-10 w-10 rounded border object-cover"
                            />
                          ) : (
                            <span className="flex h-10 w-10 items-center justify-center rounded border border-dashed text-center text-[9px] leading-tight text-muted-foreground">
                              {isAdmin ? "Add photo" : "No photo"}
                            </span>
                          )}
                          {isAdmin && (
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="hidden"
                              disabled={saving}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) void uploadImage(rowId, f);
                                e.target.value = "";
                              }}
                            />
                          )}
                        </label>
                      </td>
                    )}
                    {initial.keyCols.map((c) => (
                      <td key={c.field} className="whitespace-nowrap py-2 pr-6">
                        {c.type === "date"
                          ? <span className="text-muted-foreground">{fmtDate(row[c.field])}</span>
                          : c.field === "key"
                            ? (
                              <span className="flex flex-col leading-tight">
                                <span className="font-medium">{configLabel(row[c.field])}</span>
                                <span className="text-[10px] text-muted-foreground/70">{String(row[c.field] ?? "")}</span>
                              </span>
                            )
                            : editableKeySet.has(c.field)
                              ? (
                                <span className="inline-flex items-center gap-1">
                                  {renderEditableCell(rowId, c.field, row[c.field], !isNumericField(c.field, rows))}
                                  {c.field === "size_label" && mismatch && (
                                    <span title={mismatch} className="text-amber-600" aria-label={mismatch}>
                                      <AlertTriangle className="size-3.5" />
                                    </span>
                                  )}
                                </span>
                              )
                              : <span className="text-muted-foreground">{String(row[c.field] ?? "—")}</span>}
                      </td>
                    ))}
                    {initial.editCols.map((c) => (
                      <td key={c.field} className="py-2 pr-4 text-right">
                        {renderEditableCell(rowId, c.field, row[c.field], false, "w-28 text-right")}
                      </td>
                    ))}
                    {textEditCols.map((c) => (
                      <td key={c.field} className="py-2 pr-4">
                        {renderEditableCell(rowId, c.field, row[c.field], true, "w-32")}
                      </td>
                    ))}
                    {hasDummy && (
                      <td className="py-2 text-right">
                        {isAdmin ? (
                          <button type="button" disabled={saving} onClick={() => void toggleDummy(rowId, isDummy ?? false)} title="Toggle dummy / real">
                            <Badge variant="outline" className={isDummy ? "cursor-pointer border-amber-300 text-amber-700" : "cursor-pointer border-green-300 text-green-700"}>
                              {isDummy ? "Dummy" : "Real"}
                            </Badge>
                          </button>
                        ) : (
                          <Badge variant="outline" className={isDummy ? "border-amber-300 text-amber-700" : "border-green-300 text-green-700"}>
                            {isDummy ? "Dummy" : "Real"}
                          </Badge>
                        )}
                      </td>
                    )}
                    {/* Delete (admin or staff, rate tables only — client 7-Jul
                        + final doc). Old estimates keep their own
                        rates_snapshot, so this is safe. */}
                    {canManageRows && (
                      <td className="py-2 pl-2 text-right">
                        <button
                          type="button"
                          disabled={saving}
                          title="Delete row"
                          aria-label="Delete row"
                          className="text-muted-foreground/50 transition-colors hover:text-destructive"
                          onClick={() => void deleteRow(rowId, row)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}

              {/* Add-row inline form */}
              {addingRow && (
                <tr className="border-t-2 border-primary/30 bg-muted/20">
                  {hasImage && (
                    <td className="py-2 pr-4">
                      <label className="inline-flex cursor-pointer" title="Pick a photo — uploaded with the new row (PNG, JPEG, WebP — max 2 MB)">
                        <span className={`flex h-10 w-10 items-center justify-center rounded border border-dashed text-center text-[9px] leading-tight ${addImage ? "border-primary text-primary" : "text-muted-foreground"}`}>
                          {addImage ? "Photo ✓" : "Add photo"}
                        </span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          disabled={saving}
                          onChange={(e) => {
                            setAddImage(e.target.files?.[0] ?? null);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </td>
                  )}
                  {initial.keyCols.map((c) => {
                    if (!templateFields.includes(c.field)) {
                      return <td key={c.field} className="py-2 pr-6 text-xs text-muted-foreground">auto</td>;
                    }
                    const isNum = isNumericField(c.field, rows);
                    return (
                      <td key={c.field} className="py-2 pr-6">
                        <input
                          type={isNum ? "number" : "text"}
                          step={isNum ? "0.01" : undefined}
                          min={isNum ? "0" : undefined}
                          placeholder={c.label}
                          className="w-24 rounded border px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          value={String(addingRow[c.field] ?? "")}
                          onChange={(e) => setAddingRow((r) => r ? { ...r, [c.field]: isNum ? Number(e.target.value) : e.target.value } : null)}
                        />
                      </td>
                    );
                  })}
                  {initial.editCols.map((c) => (
                    <td key={c.field} className="py-2 pr-4 text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder={c.label}
                        className="w-28 rounded border px-2 py-0.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        value={String(addingRow[c.field] ?? "")}
                        onChange={(e) => setAddingRow((r) => r ? { ...r, [c.field]: Number(e.target.value) } : null)}
                      />
                    </td>
                  ))}
                  {textEditCols.map((c) => (
                    c.field === "vendor" ? (
                      <td key={c.field} className="py-2 pr-4">
                        <input
                          type="text"
                          placeholder="Vendor"
                          className="w-28 rounded border px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          value={String(addingRow["vendor"] ?? "")}
                          onChange={(e) => setAddingRow((r) => r ? { ...r, vendor: e.target.value } : null)}
                        />
                      </td>
                    ) : <td key={c.field} className="py-2 pr-4" />
                  ))}
                  {hasDummy && <td className="py-2 text-right text-xs text-muted-foreground">Dummy</td>}
                  <td colSpan={99} className="py-2 pl-2">
                    <div className="flex items-center gap-2">
                      <Button type="button" size="sm" disabled={saving} onClick={() => void commitAddRow()}>Save</Button>
                      <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { setAddingRow(null); setAddErr(null); }}>Cancel</Button>
                      {addErr && <span className="text-xs text-destructive">{addErr}</span>}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Extra fields in the add-row template that aren't key cols or edit cols */}
        {addingRow && addRowColDefs.filter((c) =>
          !initial.keyCols.some((k) => k.field === c.field) &&
          !initial.editCols.some((e) => e.field === c.field) &&
          c.field !== "vendor"
        ).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-3 rounded border border-primary/30 bg-muted/20 px-3 py-2">
            {addRowColDefs
              .filter((c) =>
                !initial.keyCols.some((k) => k.field === c.field) &&
                !initial.editCols.some((e) => e.field === c.field) &&
                c.field !== "vendor"
              )
              .map((c) => {
                const isNum = typeof (initial.newRowTemplate?.[c.field]) === "number";
                return (
                  <div key={c.field} className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground">{c.label}</label>
                    <input
                      type={isNum ? "number" : "text"}
                      step={isNum ? "0.01" : undefined}
                      min={isNum ? "0" : undefined}
                      placeholder={c.label}
                      className="w-24 rounded border px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      value={String(addingRow[c.field] ?? "")}
                      onChange={(e) => setAddingRow((r) => r ? { ...r, [c.field]: isNum ? Number(e.target.value) : e.target.value } : null)}
                    />
                  </div>
                );
              })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
