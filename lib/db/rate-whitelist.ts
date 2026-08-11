// Shared rate-table whitelists + update application (round 3: extracted from
// app/api/rates/route.ts so the propose/approve workflow applies changes
// through the EXACT same validation and stamping as a direct admin edit).
// Route files can only export HTTP handlers, hence this module.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// All fields that accept free text (not numbers / booleans).
export const TEXT_FIELDS = new Set([
  "vendor", "name", "type", "color", "colour", "finish", "size_label", "unit",
]);

// Config tables have `updated_at` but NOT the `vendor`/`updated_by` meta columns
// that every rate table carries. Stamping `updated_by` on these would fail.
export const NO_META_TABLES = new Set(["app_config", "margin_config"]);

/**
 * "<table>.<field>" pairs where a BLANK value means "not set" and must be
 * stored as NULL rather than "".
 *
 * Round 10: vendor is part of the unique key on the two printing tables, and
 * the whole backward-compatibility story rests on the un-named row being NULL —
 * the partial unique index is `where vendor is null`, and the resolver orders
 * `nullsFirst` to keep resolving legacy snapshots to it. An empty string would
 * silently sit outside both and split into a second "default" row.
 */
export const NULL_WHEN_BLANK = new Set([
  "offset_printing_rates.vendor",
  "digital_printing_rates.vendor",
]);

/** Blank -> null for the fields above; every other value passes through. */
export function normaliseRateValue(
  table: string,
  field: string,
  value: unknown,
): unknown {
  if (
    NULL_WHEN_BLANK.has(`${table}.${field}`) &&
    typeof value === "string" &&
    value.trim() === ""
  ) {
    return null;
  }
  return value;
}

// Tables staff may PROPOSE changes to: everything editable except the config
// tables — margin_config is admin-only by hard rule (staff must never see
// margin), and app_config drives global costing behaviour.
export const PROPOSABLE_EXCLUDED = new Set(["app_config", "margin_config"]);

// Per-table PATCH allowlist.
export const ALLOWED: Record<string, { fields: Set<string>; idCol: "id" | "key" }> = {
  board_rates:            { fields: new Set(["thickness_mm", "sheet_width_in", "sheet_height_in", "cost_per_sheet", "vendor", "is_dummy"]),   idCol: "id" },
  paper_rates:            { fields: new Set(["size_label", "width_in", "height_in", "gsm", "cost_per_sheet", "vendor", "is_dummy"]),          idCol: "id" },
  white_paper_rates:      { fields: new Set(["name", "size_label", "width_in", "height_in", "gsm", "cost_per_sheet", "vendor", "is_dummy"]),   idCol: "id" },
  art_card_rates:         { fields: new Set(["type", "size_label", "width_in", "height_in", "gsm", "cost_per_sheet", "vendor", "is_dummy"]),  idCol: "id" },
  special_paper_rates:    { fields: new Set(["name", "size_label", "width_in", "height_in", "gsm", "cost_per_sheet", "vendor", "is_dummy"]),  idCol: "id" },
  offset_printing_rates:  { fields: new Set(["size_label", "colour", "width_in", "height_in", "first_1000", "additional_1000", "vendor", "is_dummy"]), idCol: "id" },
  digital_printing_rates: { fields: new Set(["size_label", "width_in", "height_in", "cost_per_sheet", "vendor", "is_dummy"]),                 idCol: "id" },
  lamination_rates:       { fields: new Set(["type", "rate_per_100sqin", "vendor", "is_dummy"]),                                     idCol: "id" },
  foiling_rates:          { fields: new Set(["color", "finish", "rate_per_sqin", "vendor", "is_dummy"]),                              idCol: "id" },
  uv_coating_rates:       { fields: new Set(["type", "unit", "rate", "vendor", "is_dummy"]),                                         idCol: "id" },
  relief_rates:           { fields: new Set(["type", "rate_per_sqin", "vendor", "is_dummy"]),                                        idCol: "id" },
  magnet_rates:           { fields: new Set(["type", "diameter_mm", "thickness_mm", "price_each", "vendor", "is_dummy"]),             idCol: "id" },
  washer_rates:           { fields: new Set(["name", "price_each", "vendor", "is_dummy"]),                                           idCol: "id" },
  foam_rates:             { fields: new Set(["type", "thickness_mm", "sheet_width_in", "sheet_height_in", "cost_per_sheet", "rate_per_mm", "vendor", "is_dummy"]), idCol: "id" },
  reverse_board_rates:    { fields: new Set(["thickness_mm", "cost_per_sheet", "vendor", "is_dummy"]),                               idCol: "id" },
  consumable_rates:       { fields: new Set(["name", "unit", "rate", "vendor", "is_dummy"]),                                         idCol: "id" },
  labour_rates:           { fields: new Set(["name", "rate_per_month", "rate_per_day", "rate_per_hour", "vendor", "is_dummy"]),       idCol: "id" },
  ribbon_tag_rates:       { fields: new Set(["size_label", "price_each", "vendor", "is_dummy"]),                                     idCol: "id" },
  handle_rates:           { fields: new Set(["type", "price_each", "vendor", "is_dummy"]),                                           idCol: "id" },
  lock_rates:             { fields: new Set(["type", "price_each", "vendor", "is_dummy"]),                                           idCol: "id" },
  window_rates:           { fields: new Set(["name", "film_width_in", "film_height_in", "cost_per_sheet", "vendor", "is_dummy"]),    idCol: "id" },
  misc_rates:             { fields: new Set(["name", "unit", "width_in", "height_in", "thickness_mm", "price", "vendor", "is_dummy"]), idCol: "id" },
  app_config:             { fields: new Set(["value"]),                                                                               idCol: "key" },
  margin_config:          { fields: new Set(["value"]),                                                                               idCol: "key" },
};

// Per-table INSERT allowlist — required + optional allowed fields.
// is_dummy defaults true server-side; id is auto-generated.
export const INSERTABLE: Record<string, { required: string[]; optional: string[]; numeric: Set<string> }> = {
  board_rates:            { required: ["thickness_mm", "cost_per_sheet"],                                      optional: ["sheet_width_in", "sheet_height_in", "vendor"],          numeric: new Set(["thickness_mm", "sheet_width_in", "sheet_height_in", "cost_per_sheet"]) },
  paper_rates:            { required: ["size_label", "width_in", "height_in", "gsm", "cost_per_sheet"],        optional: ["vendor"],                                              numeric: new Set(["width_in", "height_in", "gsm", "cost_per_sheet"]) },
  white_paper_rates:      { required: ["size_label", "width_in", "height_in", "gsm", "cost_per_sheet"],        optional: ["name", "vendor"],                                      numeric: new Set(["width_in", "height_in", "gsm", "cost_per_sheet"]) },
  // `type` is optional so a pre-migration-board-type DB (no such column) can
  // still insert rows; the rate card only sends it once the column exists.
  art_card_rates:         { required: ["size_label", "width_in", "height_in", "gsm", "cost_per_sheet"],        optional: ["type", "vendor"],                                      numeric: new Set(["width_in", "height_in", "gsm", "cost_per_sheet"]) },
  special_paper_rates:    { required: ["name", "size_label", "width_in", "height_in", "cost_per_sheet"],       optional: ["gsm", "vendor"],                                       numeric: new Set(["width_in", "height_in", "gsm", "cost_per_sheet"]) },
  offset_printing_rates:  { required: ["size_label", "width_in", "height_in", "first_1000", "additional_1000"], optional: ["colour", "vendor"],                                   numeric: new Set(["width_in", "height_in", "first_1000", "additional_1000"]) },
  digital_printing_rates: { required: ["size_label", "width_in", "height_in", "cost_per_sheet"],               optional: ["vendor"],                                              numeric: new Set(["width_in", "height_in", "cost_per_sheet"]) },
  lamination_rates:       { required: ["type", "rate_per_100sqin"],                                            optional: ["vendor"],                                              numeric: new Set(["rate_per_100sqin"]) },
  foiling_rates:          { required: ["color", "rate_per_sqin"],                                              optional: ["finish", "vendor"],                                    numeric: new Set(["rate_per_sqin"]) },
  uv_coating_rates:       { required: ["type", "unit", "rate"],                                                optional: ["vendor"],                                              numeric: new Set(["rate"]) },
  relief_rates:           { required: ["type", "rate_per_sqin"],                                               optional: ["vendor"],                                              numeric: new Set(["rate_per_sqin"]) },
  magnet_rates:           { required: ["diameter_mm", "thickness_mm", "price_each"],                           optional: ["type", "vendor"],                                      numeric: new Set(["diameter_mm", "thickness_mm", "price_each"]) },
  washer_rates:           { required: ["name", "price_each"],                                                  optional: ["vendor"],                                              numeric: new Set(["price_each"]) },
  foam_rates:             { required: ["type", "thickness_mm", "sheet_width_in", "sheet_height_in", "cost_per_sheet"], optional: ["rate_per_mm", "vendor"],                       numeric: new Set(["thickness_mm", "sheet_width_in", "sheet_height_in", "cost_per_sheet", "rate_per_mm"]) },
  reverse_board_rates:    { required: ["thickness_mm", "cost_per_sheet"],                                      optional: ["vendor"],                                              numeric: new Set(["thickness_mm", "cost_per_sheet"]) },
  consumable_rates:       { required: ["name", "unit", "rate"],                                                optional: ["vendor"],                                              numeric: new Set(["rate"]) },
  labour_rates:           { required: ["name", "rate_per_month", "rate_per_day", "rate_per_hour"],             optional: ["vendor"],                                              numeric: new Set(["rate_per_month", "rate_per_day", "rate_per_hour"]) },
  ribbon_tag_rates:       { required: ["size_label", "price_each"],                                            optional: ["vendor"],                                              numeric: new Set(["price_each"]) },
  handle_rates:           { required: ["type", "price_each"],                                                  optional: ["vendor"],                                              numeric: new Set(["price_each"]) },
  lock_rates:             { required: ["type", "price_each"],                                                  optional: ["vendor"],                                              numeric: new Set(["price_each"]) },
  window_rates:           { required: ["name", "film_width_in", "film_height_in", "cost_per_sheet"],           optional: ["vendor"],                                              numeric: new Set(["film_width_in", "film_height_in", "cost_per_sheet"]) },
  misc_rates:             { required: ["name", "unit", "price"],                                               optional: ["width_in", "height_in", "thickness_mm", "vendor"],     numeric: new Set(["width_in", "height_in", "thickness_mm", "price"]) },
};

/** Validate one (table, field, value) triple. Returns an error string or null. */
export function validateRateValue(
  table: string,
  field: string,
  value: unknown,
): string | null {
  if (!ALLOWED[table]) return "Invalid table.";
  if (!ALLOWED[table].fields.has(field)) return `Field '${field}' is not editable on ${table}.`;
  if (field === "is_dummy") {
    if (typeof value !== "boolean") return "is_dummy must be a boolean.";
  } else if (TEXT_FIELDS.has(field)) {
    if (value !== null && typeof value !== "string") return `${field} must be a string or null.`;
    if (typeof value === "string" && value.length > 200) return `${field} must be 200 chars or less.`;
  } else {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      return "value must be a non-negative number.";
  }
  return null;
}

/**
 * Apply a validated rate update, stamping updated_at/updated_by exactly like a
 * direct admin edit. `byName` is the human shown in the "updated by" column.
 * Returns { updated_at, updated_by } on success or an error string.
 */
export async function applyRateUpdate(
  admin: SupabaseClient,
  table: string,
  id: string | number,
  field: string,
  value: unknown,
  byName: string,
): Promise<{ updated_at: string; updated_by: string | null } | { error: string }> {
  const invalid = validateRateValue(table, field, value);
  if (invalid) return { error: invalid };
  // Blank vendor on a printing table means "the default row" -> NULL, never "".
  value = normaliseRateValue(table, field, value);

  const { idCol } = ALLOWED[table];
  const updatedAt = new Date().toISOString();
  // Only rate tables carry `updated_by`; config tables would 400 on it.
  const updatedBy =
    field !== "is_dummy" && !NO_META_TABLES.has(table) ? byName : undefined;
  const { error } = await admin
    .from(table)
    .update({
      [field]: value,
      updated_at: updatedAt,
      ...(updatedBy != null ? { updated_by: updatedBy } : {}),
    })
    .eq(idCol, id);
  if (error) {
    console.error(`rate update (${table}.${field}):`, error);
    return { error: "Failed to update rate." };
  }
  return { updated_at: updatedAt, updated_by: updatedBy ?? null };
}
