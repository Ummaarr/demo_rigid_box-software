import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { BRAND } from "@/lib/brand";

export interface ColDef {
  field: string;
  label: string;
  /** "date" formats the value as a short localised date; default is plain text. */
  type?: "date";
}

/**
 * Category filter chips on the rate card (client 18-Jul). The chip row is
 * derived from the sections in order, so this list also fixes the chip order.
 */
export type RateCategory =
  | "Materials"
  | "Printing"
  | "Finishing"
  | "Hardware"
  | "Inserts"
  | "Other"
  | "Labour"
  | "Configuration";

export interface RateSectionData {
  id: string;
  label: string;
  /** Groups sections under the rate card's category filter chips. */
  category: RateCategory;
  table: string;
  idField: "id" | "key";
  keyCols: ColDef[];
  editCols: ColDef[];
  /** Text-editable columns (vendor, notes). Value is a string, not a number. */
  textEditCols?: ColDef[];
  /** Key column fields that the admin can edit inline (click-to-edit like editCols). */
  editableKeys?: string[];
  /** Billing unit shown in the section header (client 4-Jul: "mention unit for all items"). */
  unitLabel?: string;
  /** Add-on sections carry a reference photo per row (image_path column). */
  hasImage?: boolean;
  /** Template for adding a new row. Keys = field names; values = default values shown in the add form. */
  newRowTemplate?: Record<string, string | number>;
  rows: Record<string, unknown>[];
}

// Columns shown on every rate section: who last changed it and when.
const META_COLS: ColDef[] = [
  { field: "updated_by", label: "Updated by" },
  { field: "updated_at", label: "Updated", type: "date" },
];
// Vendor is editable text — the supplier this rate came from.
const VENDOR_COL: ColDef = { field: "vendor", label: "Vendor" };

export async function loadAllRates(
  supabase: SupabaseClient,
  role: "admin" | "staff" | "trial" | null = "admin",
  // null = the shared master card (admin/staff — unchanged behaviour); a
  // trial user's id = read ONLY their own private clone. Always derive from
  // the session via ownerScopeFor() in lib/auth.ts, never a client value.
  ownerId: string | null = null,
  // The symbol shown in this card's unit labels ("$ / sheet"). Defaults to the
  // deployment's own dressing, so admin/staff are unchanged; a trial account
  // passes its own market's symbol (see currencyMetaFor in lib/currency-meta).
  currencySymbol: string = BRAND.currencySymbol,
): Promise<RateSectionData[]> {
  const sym = currencySymbol;
  // Every rate table (not app_config) carries owner_id (trial-role isolation
  // — see supabase/migration-trial-role.sql). Generic in the builder type so
  // each query keeps its own row typing; the internal cast is only needed
  // because .is/.eq aren't expressible on a bare type parameter.
  const own = <T,>(q: T): T =>
    ownerId == null
      ? (q as unknown as { is: (c: string, v: null) => T }).is("owner_id", null)
      : (q as unknown as { eq: (c: string, v: string) => T }).eq("owner_id", ownerId);

  const [
    boardRes,
    paperRes,
    whitePaperRes,
    artCardRes,
    specialPaperRes,
    offsetRes,
    digitalRes,
    laminationRes,
    foilingRes,
    uvRes,
    reliefRes,
    magnetRes,
    washerRes,
    foamRes,
    reverseBoardRes,
    consumableRes,
    labourRes,
    ribbonTagRes,
    handleRes,
    lockRes,
    windowRes,
    appConfigRes,
    marginConfigRes,
    miscRes,
  ] = await Promise.all([
    own(supabase.from("board_rates").select("*").order("thickness_mm")),
    own(supabase
      .from("paper_rates")
      .select("*")
      .order("size_label")
      .order("gsm")),
    own(supabase
      .from("white_paper_rates")
      .select("*")
      .order("size_label")
      .order("gsm")),
    own(supabase
      .from("art_card_rates")
      .select("*")
      .order("size_label")
      .order("gsm")),
    own(supabase.from("special_paper_rates").select("*").order("name")),
    own(supabase.from("offset_printing_rates").select("*").order("size_label")),
    own(supabase.from("digital_printing_rates").select("*").order("size_label")),
    own(supabase.from("lamination_rates").select("*").order("type")),
    own(supabase.from("foiling_rates").select("*").order("color")),
    own(supabase.from("uv_coating_rates").select("*").order("type")),
    own(supabase.from("relief_rates").select("*").order("type")),
    own(supabase
      .from("magnet_rates")
      .select("*")
      .order("diameter_mm")
      .order("thickness_mm")),
    own(supabase.from("washer_rates").select("*").order("name")),
    own(supabase
      .from("foam_rates")
      .select("*")
      .order("type")
      .order("thickness_mm")),
    own(supabase.from("reverse_board_rates").select("*").order("thickness_mm")),
    own(supabase.from("consumable_rates").select("*").order("name")),
    own(supabase.from("labour_rates").select("*").order("name")),
    own(supabase.from("ribbon_tag_rates").select("*").order("size_label")),
    own(supabase.from("handle_rates").select("*").order("type")),
    own(supabase.from("lock_rates").select("*").order("type")),
    own(supabase.from("window_rates").select("*").order("name")),
    // app_config: global formula config, no owner_id column — unfiltered.
    supabase.from("app_config").select("*").order("key"),
    own(supabase.from("margin_config").select("*").order("key")),
    // Round 3 — tolerate a pre-migration DB (missing table => section omitted).
    own(supabase.from("misc_rates").select("*").order("name")),
  ]);

  // Board `type` (client 18-Jul) — probe for the column so a live DB that
  // hasn't run migration-board-type.sql yet still renders the section (without
  // the Type column) instead of erroring. Same pattern as offset `colour`.
  // The probe also means the section query can't `.order("type")` (that would
  // error pre-migration and swallow every row), so board rows are grouped by
  // type here instead.
  const boardTypeProbe = await supabase.from("art_card_rates").select("type").limit(1);
  const hasBoardType = !boardTypeProbe.error;
  const boardRows = ((artCardRes.data ?? []) as Record<string, unknown>[])
    .slice()
    .sort((a, b) => String(a.type ?? "").localeCompare(String(b.type ?? "")));

  function rows(res: {
    data: unknown[] | null;
  }): Record<string, unknown>[] {
    return (res.data ?? []) as Record<string, unknown>[];
  }

  // Appends vendor (text-editable) and the meta read-only cols (updated_by,
  // updated_at) to a section definition. All rate tables now carry these columns.
  //
  // `vendorIsKey` (round 10) opts a section out of the trailing vendor column
  // because vendor is part of its unique key there (the two printing tables) —
  // it belongs among the keyCols so the rows read as distinct quotes, and
  // rendering it twice would let one copy silently disagree with the other.
  function withMeta(
    section: Omit<RateSectionData, "textEditCols"> & { textEditCols?: ColDef[] },
    vendorIsKey = false,
  ): RateSectionData {
    return {
      ...section,
      keyCols: [...section.keyCols, ...META_COLS],
      textEditCols: vendorIsKey
        ? (section.textEditCols ?? [])
        : [...(section.textEditCols ?? []), VENDOR_COL],
    };
  }

  const sections: RateSectionData[] = [
    withMeta({ id: "board", label: "Kappa Board", category: "Materials", table: "board_rates", idField: "id", unitLabel: `${sym} per sheet`,
      keyCols: [
        { field: "size_label", label: "Size" },
        { field: "sheet_width_in", label: "Sheet W" }, { field: "sheet_height_in", label: "Sheet H" },
        { field: "thickness_mm", label: "Thickness (mm)" },
      ],
      editCols: [{ field: "cost_per_sheet", label: `${sym} / sheet` }],
      editableKeys: ["size_label", "sheet_width_in", "sheet_height_in", "thickness_mm"],
      newRowTemplate: { size_label: "", sheet_width_in: 31, sheet_height_in: 41, thickness_mm: 2, cost_per_sheet: 0 },
      rows: rows(boardRes) }),

    // Renamed "Printed Paper" -> "Art Paper" (client 4-Jul); table unchanged.
    withMeta({ id: "paper", label: "Art Paper", category: "Materials", table: "paper_rates", idField: "id", unitLabel: `${sym} per sheet`,
      keyCols: [
        { field: "size_label", label: "Size" },
        { field: "width_in", label: "Sheet W" }, { field: "height_in", label: "Sheet H" },
        { field: "gsm", label: "GSM" },
      ],
      editCols: [{ field: "cost_per_sheet", label: `${sym} / sheet` }],
      editableKeys: ["size_label", "width_in", "height_in", "gsm"],
      newRowTemplate: { size_label: "", width_in: 0, height_in: 0, gsm: 120, cost_per_sheet: 0 },
      rows: rows(paperRes) }),

    withMeta({ id: "white_paper", label: "White Lining Paper", category: "Materials", table: "white_paper_rates", idField: "id", unitLabel: `${sym} per sheet`,
      // name = paper type (client 8-Jul: white paper needs a paper-type column).
      keyCols: [
        { field: "name", label: "Paper type" },
        { field: "size_label", label: "Size" },
        { field: "width_in", label: "Sheet W" }, { field: "height_in", label: "Sheet H" },
        { field: "gsm", label: "GSM" },
      ],
      editCols: [{ field: "cost_per_sheet", label: `${sym} / sheet` }],
      editableKeys: ["name", "size_label", "width_in", "height_in", "gsm"],
      newRowTemplate: { name: "White paper", size_label: "", width_in: 0, height_in: 0, gsm: 120, cost_per_sheet: 0 },
      rows: rows(whitePaperRes) }),

    // "Art Card" -> "Board" (client 18-Jul): the section now holds every board
    // stock, distinguished by `type`. Label + column only — the table stays
    // art_card_rates and the cover material value stays 'art_card', so saved
    // estimates resolve unchanged. Type is dropped from the columns entirely on
    // a pre-migration-board-type DB.
    withMeta({ id: "art_card", label: "Board", category: "Materials", table: "art_card_rates", idField: "id", unitLabel: `${sym} per sheet`,
      keyCols: [
        ...(hasBoardType ? [{ field: "type", label: "Type" }] : []),
        { field: "size_label", label: "Size" },
        { field: "width_in", label: "Sheet W" }, { field: "height_in", label: "Sheet H" },
        { field: "gsm", label: "GSM" },
      ],
      editCols: [{ field: "cost_per_sheet", label: `${sym} / sheet` }],
      editableKeys: [...(hasBoardType ? ["type"] : []), "size_label", "width_in", "height_in", "gsm"],
      newRowTemplate: {
        ...(hasBoardType ? { type: "Art card" } : {}),
        size_label: "", width_in: 0, height_in: 0, gsm: 120, cost_per_sheet: 0,
      },
      rows: boardRows }),

    withMeta({ id: "special_paper", label: "Special Paper", category: "Materials", table: "special_paper_rates", idField: "id", unitLabel: `${sym} per sheet`,
      keyCols: [
        { field: "name", label: "Name" }, { field: "size_label", label: "Size" },
        { field: "width_in", label: "Sheet W" }, { field: "height_in", label: "Sheet H" },
        { field: "gsm", label: "GSM" },
      ],
      editCols: [{ field: "cost_per_sheet", label: `${sym} / sheet` }],
      editableKeys: ["name", "size_label", "width_in", "height_in", "gsm"],
      newRowTemplate: { name: "", size_label: "", width_in: 0, height_in: 0, gsm: 120, cost_per_sheet: 0 },
      rows: rows(specialPaperRes) }),

    // Vendor is a KEY column on both printing sections (round 10): the unique
    // key is (size_label, colour, vendor) / (size_label, vendor), so the same
    // size can be quoted by several printers. Blank vendor = the default row.
    withMeta({ id: "offset", label: "Offset Printing", category: "Printing", table: "offset_printing_rates", idField: "id", unitLabel: `${sym} first 1000 / +1000 sheets`,
      keyCols: [
        { field: "size_label", label: "Size" },
        { field: "colour", label: "Colour" },
        { field: "vendor", label: "Vendor" },
        { field: "width_in", label: "Sheet W" }, { field: "height_in", label: "Sheet H" },
      ],
      editCols: [{ field: "first_1000", label: `First 1000 (${sym})` }, { field: "additional_1000", label: `+1000 (${sym})` }],
      editableKeys: ["size_label", "colour", "vendor", "width_in", "height_in"],
      newRowTemplate: { size_label: "", colour: "multi", vendor: "", width_in: 0, height_in: 0, first_1000: 0, additional_1000: 0 },
      rows: rows(offsetRes) }, true),

    withMeta({ id: "digital", label: "Digital Printing", category: "Printing", table: "digital_printing_rates", idField: "id", unitLabel: `${sym} per sheet`,
      keyCols: [
        { field: "size_label", label: "Size" },
        { field: "vendor", label: "Vendor" },
        { field: "width_in", label: "Sheet W" }, { field: "height_in", label: "Sheet H" },
      ],
      editCols: [{ field: "cost_per_sheet", label: `${sym} / sheet` }],
      editableKeys: ["size_label", "vendor", "width_in", "height_in"],
      newRowTemplate: { size_label: "", vendor: "", width_in: 0, height_in: 0, cost_per_sheet: 0 },
      rows: rows(digitalRes) }, true),

    withMeta({ id: "lamination", label: "Lamination", category: "Finishing", table: "lamination_rates", idField: "id", unitLabel: `${sym} per 100 sq in`,
      keyCols: [{ field: "type", label: "Type" }],
      editCols: [{ field: "rate_per_100sqin", label: `${sym} / 100 sq in` }],
      editableKeys: ["type"],
      newRowTemplate: { type: "", rate_per_100sqin: 0 },
      rows: rows(laminationRes) }),

    withMeta({ id: "foiling", label: "Foiling", category: "Finishing", table: "foiling_rates", idField: "id", unitLabel: `${sym} per sq in`,
      // finish (client 4-Jul): matte/glossy per colour — prices identical today.
      keyCols: [{ field: "color", label: "Colour" }, { field: "finish", label: "Finish" }],
      editCols: [{ field: "rate_per_sqin", label: `${sym} / sq in` }],
      editableKeys: ["color", "finish"],
      newRowTemplate: { color: "", finish: "glossy", rate_per_sqin: 0 },
      rows: rows(foilingRes) }),

    withMeta({ id: "uv", label: "UV Coating", category: "Finishing", table: "uv_coating_rates", idField: "id", unitLabel: `${sym} per unit shown`,
      keyCols: [{ field: "type", label: "Type" }, { field: "unit", label: "Unit" }],
      editCols: [{ field: "rate", label: `Rate (${sym})` }],
      editableKeys: ["type", "unit"],
      newRowTemplate: { type: "", unit: "per_100sqin", rate: 0 },
      rows: rows(uvRes) }),

    withMeta({ id: "relief", label: "Relief (Emboss / Deboss)", category: "Finishing", table: "relief_rates", idField: "id", unitLabel: `${sym} per sq in`,
      keyCols: [{ field: "type", label: "Type" }],
      editCols: [{ field: "rate_per_sqin", label: `${sym} / sq in` }],
      editableKeys: ["type"],
      newRowTemplate: { type: "", rate_per_sqin: 0 },
      rows: rows(reliefRes) }),

    withMeta({ id: "magnets", label: "Magnets", category: "Hardware", table: "magnet_rates", idField: "id", unitLabel: `${sym} each`,
      // type column (client 4-Jul: "add a column for magnets that says Type").
      keyCols: [{ field: "type", label: "Type" }, { field: "diameter_mm", label: "Dia. (mm)" }, { field: "thickness_mm", label: "Thick. (mm)" }],
      editCols: [{ field: "price_each", label: `${sym} / each` }],
      editableKeys: ["type", "diameter_mm", "thickness_mm"],
      newRowTemplate: { type: "round", diameter_mm: 0, thickness_mm: 0, price_each: 0 },
      rows: rows(magnetRes) }),

    withMeta({ id: "washers", label: "Washers", category: "Hardware", table: "washer_rates", idField: "id", unitLabel: `${sym} each`,
      keyCols: [{ field: "name", label: "Size" }],
      editCols: [{ field: "price_each", label: `${sym} / each` }],
      editableKeys: ["name"],
      newRowTemplate: { name: "", price_each: 0 },
      rows: rows(washerRes) }),

    withMeta({ id: "foam", label: "Foam Inserts", category: "Inserts", table: "foam_rates", idField: "id", unitLabel: `${sym} per mm (or ${sym} per sheet fallback)`,
      keyCols: [
        { field: "type", label: "Type" }, { field: "thickness_mm", label: "Thick. (mm)" },
        { field: "sheet_width_in", label: "Sheet W" }, { field: "sheet_height_in", label: "Sheet H" },
      ],
      // rate_per_mm (client 2-Jul): when set (> 0) sheet price = rate x thickness;
      // cost_per_sheet is the flat fallback for rows without a per-mm rate.
      editCols: [
        { field: "rate_per_mm", label: `${sym} / mm` },
        { field: "cost_per_sheet", label: `${sym} / sheet (fallback)` },
      ],
      editableKeys: ["type", "thickness_mm", "sheet_width_in", "sheet_height_in"],
      newRowTemplate: { type: "XLPE", thickness_mm: 10, sheet_width_in: 0, sheet_height_in: 0, rate_per_mm: 0, cost_per_sheet: 0 },
      rows: rows(foamRes) }),

    withMeta({ id: "reverse_board", label: "Reverse Board (insert)", category: "Inserts", table: "reverse_board_rates", idField: "id", unitLabel: `${sym} per sheet`,
      keyCols: [
        { field: "size_label", label: "Size" },
        { field: "sheet_width_in", label: "Sheet W" }, { field: "sheet_height_in", label: "Sheet H" },
        { field: "thickness_mm", label: "Thickness (mm)" },
      ],
      editCols: [{ field: "cost_per_sheet", label: `${sym} / sheet` }],
      editableKeys: ["size_label", "sheet_width_in", "sheet_height_in", "thickness_mm"],
      newRowTemplate: { size_label: "", sheet_width_in: 31, sheet_height_in: 41, thickness_mm: 0, cost_per_sheet: 0 },
      rows: rows(reverseBoardRes) }),

    withMeta({ id: "ribbon_tag", label: "Ribbon Tags", category: "Hardware", table: "ribbon_tag_rates", idField: "id", unitLabel: `${sym} each`,
      keyCols: [{ field: "size_label", label: "Size" }],
      editCols: [{ field: "price_each", label: `${sym} / each` }],
      editableKeys: ["size_label"],
      newRowTemplate: { size_label: "", price_each: 0 },
      rows: rows(ribbonTagRes) }),

    withMeta({ id: "handles", label: "Handles", category: "Hardware", table: "handle_rates", idField: "id", unitLabel: `${sym} each`,
      keyCols: [{ field: "type", label: "Type" }],
      editCols: [{ field: "price_each", label: `${sym} / each` }],
      editableKeys: ["type"],
      newRowTemplate: { type: "", price_each: 0 },
      hasImage: true, rows: rows(handleRes) }),

    withMeta({ id: "locks", label: "Locks", category: "Hardware", table: "lock_rates", idField: "id", unitLabel: `${sym} each`,
      keyCols: [{ field: "type", label: "Type" }],
      editCols: [{ field: "price_each", label: `${sym} / each` }],
      editableKeys: ["type"],
      newRowTemplate: { type: "", price_each: 0 },
      hasImage: true, rows: rows(lockRes) }),

    withMeta({ id: "windows", label: "Window Film", category: "Inserts", table: "window_rates", idField: "id", unitLabel: `${sym} per film sheet`,
      keyCols: [
        { field: "name", label: "Film" },
        { field: "film_width_in", label: "Sheet W" }, { field: "film_height_in", label: "Sheet H" },
      ],
      editCols: [{ field: "cost_per_sheet", label: `${sym} / sheet` }],
      editableKeys: ["name", "film_width_in", "film_height_in"],
      newRowTemplate: { name: "", film_width_in: 0, film_height_in: 0, cost_per_sheet: 0 },
      hasImage: true, rows: rows(windowRes) }),

    // Miscellaneous materials (round 3 — satin, velvet, cloth buckles, …).
    // Omitted entirely on a live DB that hasn't run migration-round3.sql yet.
    ...(miscRes.error ? [] : [
      withMeta({ id: "misc", label: "Miscellaneous", category: "Other", table: "misc_rates", idField: "id", unitLabel: `${sym} per unit shown`,
        keyCols: [
          { field: "name", label: "Item" }, { field: "unit", label: "Unit" },
          { field: "width_in", label: "L (in)" }, { field: "height_in", label: "W (in)" },
          { field: "thickness_mm", label: "Thick. (mm)" },
        ],
        editCols: [{ field: "price", label: `Price (${sym})` }],
        editableKeys: ["name", "unit", "width_in", "height_in", "thickness_mm"],
        newRowTemplate: { name: "", unit: "each", width_in: 0, height_in: 0, thickness_mm: 0, price: 0 },
        hasImage: true, rows: rows(miscRes) }),
    ]),

    withMeta({ id: "consumables", label: "Consumables", category: "Other", table: "consumable_rates", idField: "id", unitLabel: `${sym} per unit shown`,
      keyCols: [{ field: "name", label: "Item" }, { field: "unit", label: "Unit" }],
      editCols: [{ field: "rate", label: `Rate (${sym})` }],
      editableKeys: ["name", "unit"],
      newRowTemplate: { name: "", unit: "", rate: 0 },
      rows: rows(consumableRes) }),

    withMeta({ id: "labour", label: "Labour Roles", category: "Labour", table: "labour_rates", idField: "id", unitLabel: `${sym} per month / day / hour`,
      keyCols: [{ field: "name", label: "Role" }],
      editCols: [
        { field: "rate_per_month", label: `${sym} / month` },
        { field: "rate_per_day", label: `${sym} / day` },
        { field: "rate_per_hour", label: `${sym} / hour` },
      ],
      editableKeys: ["name"],
      newRowTemplate: { name: "", rate_per_month: 0, rate_per_day: 0, rate_per_hour: 0 },
      rows: rows(labourRes) }),

    // Config tables — no vendor/updated_by columns; not wrapped with withMeta.
    { id: "app_config", label: "App Configuration", category: "Configuration", table: "app_config", idField: "key",
      keyCols: [{ field: "key", label: "Setting" }, { field: "unit", label: "Unit" }, { field: "description", label: "Description" }],
      editCols: [{ field: "value", label: "Value" }],
      rows: rows(appConfigRes) },

    // idField "id" (not "key" — round trial-role): once a trial user's own
    // margin_config row can share a `key` value with the master row, `key`
    // alone no longer identifies a row uniquely. See schema.sql's v7 block.
    { id: "margin", label: "Margin", category: "Configuration", table: "margin_config", idField: "id",
      keyCols: [{ field: "key", label: "Setting" }, { field: "description", label: "Description" }],
      editCols: [{ field: "value", label: "Value (%)" }],
      rows: rows(marginConfigRes) },
  ];

  // app_config drives global costing and stays admin-only for everyone else
  // (staff AND trial — it's shared formula config, not something a trial
  // user's own sandbox should be able to change). Margin is admin-only by
  // hard rule for STAFF specifically — a trial user keeps their own margin
  // section (their own cloned row, their own markup input, not a secret).
  // Both stripped SERVER-SIDE before the data ever reaches the browser.
  return sections.filter((s) => {
    if (s.id === "app_config") return role === "admin";
    if (s.id === "margin") return role === "admin" || role === "trial";
    return true;
  });
}
