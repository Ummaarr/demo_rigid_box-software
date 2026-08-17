import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_BOARD_TYPE } from "@/types";

// The distinct rate "options" the estimate form needs to populate its dropdowns
// (which paper sizes/GSMs, printing sizes, finishing types, foam/magnet/labour
// rows exist). Driven by the DB so adding a rate row in Phase 7 makes it
// selectable with no code change.
export interface RateOptions {
  // Board sheet size per thickness — the live nesting preview needs the stock
  // sheet dimensions (default 31x41; may differ per thickness) to nest blanks.
  board: { thickness_mm: number; sheetWidth_in: number; sheetHeight_in: number }[];
  paper: { sizeLabel: string; gsms: number[] }[];
  // White lining stock (plain inner lining — its own rate table, client 2026-07).
  whitePaper: { sizeLabel: string; gsms: number[] }[];
  // Board stock (foam-cover material option, client 2-Jul). `type` (client
  // 18-Jul) is part of the identity — one entry per (type, size).
  artCard: { type: string; sizeLabel: string; gsms: number[] }[];
  // Special paper includes sheet size so the form can display it (editable override per estimate).
  // gsm is display-only (client review 2026-06-27: "Need GSM for special paper also"); may be null.
  specialPaper: { name: string; sizeLabel: string; sheetWidth_in: number; sheetHeight_in: number; gsm: number | null }[];
  offsetSizes: string[];
  // Whether single-colour offset rows exist yet (client 6-Jul). False on a live
  // DB that hasn't run migration-offset-colour.sql — the form then disables the
  // single-colour option (same pattern as white paper / art card).
  offsetSingleColour: boolean;
  digitalSizes: string[];
  /**
   * Printing vendors per size (round 10, client 5-Aug). One entry per rate row
   * that NAMES a vendor; un-named (NULL/blank) rows are the default and are
   * omitted. Empty = nobody has entered a vendor, so the form hides the picker.
   */
  printVendors: {
    type: "offset" | "digital";
    sizeLabel: string;
    colour?: "multi" | "single";
    vendor: string;
  }[];
  lamination: string[];
  foiling: string[];
  // Whether matte/glossy foil rows exist yet (round 3). False pre-migration —
  // the form then hides the finish picker (same pattern as offsetSingleColour).
  foilingFinishes: boolean;
  // UV carries the billing unit so the form can split whole-sheet vs per-sq-inch (spot UV).
  uv: { type: string; unit: "per_100sqin" | "per_sqin" }[];
  relief: string[];
  // Foam carries sheet dimensions so the form can show them (read-only; used for nesting).
  foam: { type: string; thickness_mm: number; sheetWidth_in: number; sheetHeight_in: number }[];
  reverseBoardThicknesses: number[];
  // Reverse-board sheet size per thickness (for the live nesting preview).
  reverseBoard: { thickness_mm: number; sheetWidth_in: number; sheetHeight_in: number }[];
  magnets: { diameter_mm: number; thickness_mm: number }[];
  washers: string[];
  ribbonTags: string[];
  // Add-ons carry id + hasImage so the form can show a photo picker (client review
  // 2026-06: handles/locks have no names/numbers, only verifiable against a picture).
  handles: { id: number; type: string; hasImage: boolean }[];
  locks: { id: number; type: string; hasImage: boolean }[];
  // Window film carries sheet dimensions (for the live nesting preview of the film).
  windows: { id: number; name: string; hasImage: boolean; filmWidth_in: number; filmHeight_in: number }[];
  labourRoles: string[];
  // Miscellaneous materials (round 3) — feed the misc add-on dropdown with
  // default prices. Empty on a live DB pre-migration-round3.sql.
  misc: { id: number; name: string; unit: string; price: number }[];
}

export async function loadRateOptions(
  supabase: SupabaseClient,
  // null = the shared master card (admin/staff — unchanged behaviour); a
  // trial user's id = ONLY their own private clone. Always derive from the
  // session via ownerScopeFor() in lib/auth.ts, never a client value.
  ownerId: string | null = null,
): Promise<RateOptions> {
  // Every rate table below carries owner_id (trial-role isolation — see
  // supabase/migration-trial-role.sql). Generic in the builder type so each
  // query keeps its own row typing; the internal cast is only needed because
  // .is/.eq aren't expressible on a bare type parameter.
  const own = <T,>(q: T): T =>
    ownerId == null
      ? (q as unknown as { is: (c: string, v: null) => T }).is("owner_id", null)
      : (q as unknown as { eq: (c: string, v: string) => T }).eq("owner_id", ownerId);

  const [
    board,
    paper,
    whitePaper,
    artCard,
    special,
    offset,
    offsetSingle,
    digital,
    lam,
    foil,
    uv,
    relief,
    foam,
    reverseBoard,
    magnets,
    washers,
    ribbon,
    handles,
    locks,
    windows,
    labour,
    misc,
    foilFinish,
  ] = await Promise.all([
    own(supabase.from("board_rates").select("thickness_mm,sheet_width_in,sheet_height_in").order("thickness_mm")),
    own(supabase.from("paper_rates").select("size_label,gsm").order("size_label").order("gsm")),
    own(supabase.from("white_paper_rates").select("size_label,gsm").order("size_label").order("gsm")),
    own(supabase.from("art_card_rates").select("type,size_label,gsm").order("size_label").order("gsm")),
    own(supabase.from("special_paper_rates").select("name,size_label,width_in,height_in,gsm").order("name")),
    own(supabase.from("offset_printing_rates").select("size_label, colour, vendor").order("size_label")),
    // Defensive: a live DB pre-migration-offset-colour has no `colour` column,
    // so this errors — treated as "single-colour not available yet" below.
    own(supabase.from("offset_printing_rates").select("size_label").eq("colour", "single").limit(1)),
    own(supabase.from("digital_printing_rates").select("size_label, vendor").order("size_label")),
    own(supabase.from("lamination_rates").select("type").order("type")),
    own(supabase.from("foiling_rates").select("color").order("color")),
    own(supabase.from("uv_coating_rates").select("type,unit").order("type")),
    own(supabase.from("relief_rates").select("type").order("type")),
    own(supabase.from("foam_rates").select("type,thickness_mm,sheet_width_in,sheet_height_in").order("type").order("thickness_mm")),
    own(supabase.from("reverse_board_rates").select("thickness_mm,sheet_width_in,sheet_height_in").order("thickness_mm")),
    own(supabase.from("magnet_rates").select("diameter_mm,thickness_mm").order("diameter_mm").order("thickness_mm")),
    own(supabase.from("washer_rates").select("name").order("name")),
    own(supabase.from("ribbon_tag_rates").select("size_label").order("size_label")),
    own(supabase.from("handle_rates").select("id,type,image_path").order("type")),
    own(supabase.from("lock_rates").select("id,type,image_path").order("type")),
    own(supabase.from("window_rates").select("id,name,image_path,film_width_in,film_height_in").order("name")),
    own(supabase.from("labour_rates").select("name").order("name")),
    // Round 3: both tolerate a pre-migration-round3 DB (missing table/column).
    own(supabase.from("misc_rates").select("id,name,unit,price").order("name")),
    own(supabase.from("foiling_rates").select("finish").eq("finish", "matte").limit(1)),
  ]);

  // whitePaper and artCard are deliberately NOT in this list: a live DB that
  // hasn't run migration-white-paper.sql / migration-art-card.sql yet has no
  // such tables — the form must still load (it disables those options when
  // their lists are empty).
  for (const r of [board, paper, special, offset, digital, lam, foil, uv, relief, foam, reverseBoard, magnets, washers, ribbon, handles, locks, windows, labour]) {
    if (r.error) throw new Error(`rate options load failed: ${r.error.message}`);
  }

  // Group paper GSMs under each size (same for white lining stock).
  const groupBySize = (rows: { size_label: string; gsm: number }[] | null) => {
    const bySize = new Map<string, number[]>();
    for (const row of rows ?? []) {
      const arr = bySize.get(row.size_label) ?? [];
      arr.push(Number(row.gsm));
      bySize.set(row.size_label, arr);
    }
    return [...bySize.entries()].map(([sizeLabel, gsms]) => ({ sizeLabel, gsms }));
  };

  // Board stock, grouped by (type, size). A live DB that hasn't run
  // migration-board-type.sql yet has no `type` column, so the select above
  // errored — retry without it and label every row with the legacy default so
  // the foam-cover picker keeps working. (An absent TABLE errors on both, which
  // correctly yields an empty list.)
  const artCardRows: { type: string; size_label: string; gsm: number }[] = artCard.error
    ? await (async () => {
        const legacy = await own(supabase
          .from("art_card_rates").select("size_label,gsm").order("size_label").order("gsm"));
        return legacy.error
          ? []
          : (legacy.data ?? []).map((r) => ({
              type: DEFAULT_BOARD_TYPE, size_label: r.size_label, gsm: Number(r.gsm),
            }));
      })()
    : (artCard.data ?? []).map((r) => ({
        type: String(r.type ?? DEFAULT_BOARD_TYPE), size_label: r.size_label, gsm: Number(r.gsm),
      }));
  const artCardGrouped = (() => {
    const byKey = new Map<string, { type: string; sizeLabel: string; gsms: number[] }>();
    for (const r of artCardRows) {
      const key = `${r.type}|${r.size_label}`;
      const entry = byKey.get(key) ?? { type: r.type, sizeLabel: r.size_label, gsms: [] };
      entry.gsms.push(r.gsm);
      byKey.set(key, entry);
    }
    return [...byKey.values()].sort((a, b) => a.type.localeCompare(b.type));
  })();

  return {
    board: (board.data ?? []).map((r) => ({
      thickness_mm: Number(r.thickness_mm),
      sheetWidth_in: Number(r.sheet_width_in),
      sheetHeight_in: Number(r.sheet_height_in),
    })),
    paper: groupBySize(paper.data),
    whitePaper: whitePaper.error ? [] : groupBySize(whitePaper.data),
    artCard: artCardGrouped,
    specialPaper: (special.data ?? []).map((r) => ({
      name: r.name,
      sizeLabel: r.size_label,
      sheetWidth_in: Number(r.width_in),
      sheetHeight_in: Number(r.height_in),
      gsm: r.gsm == null ? null : Number(r.gsm),
    })),
    // Dedupe: post-migration each size has a multi + a single row (same label).
    offsetSizes: [...new Set((offset.data ?? []).map((r) => r.size_label))],
    offsetSingleColour: !offsetSingle.error && (offsetSingle.data?.length ?? 0) > 0,
    // Round 10: vendor is part of the key, so a size can appear once per
    // vendor — dedupe (offsetSizes already did; digital mapped 1:1).
    digitalSizes: [...new Set((digital.data ?? []).map((r) => r.size_label))],
    // Which vendors quote which print size (round 10). Rows with no vendor are
    // the un-named default and are NOT listed — an empty array means nobody has
    // named a vendor yet, and the form hides the picker entirely (same pattern
    // as offsetSingleColour / foilingFinishes).
    printVendors: [
      ...(offset.data ?? [])
        .filter((r) => (r.vendor ?? "").trim() !== "")
        .map((r) => ({
          type: "offset" as const,
          sizeLabel: r.size_label as string,
          colour: (r.colour as "multi" | "single") ?? "multi",
          vendor: (r.vendor as string).trim(),
        })),
      ...(digital.data ?? [])
        .filter((r) => (r.vendor ?? "").trim() !== "")
        .map((r) => ({
          type: "digital" as const,
          sizeLabel: r.size_label as string,
          vendor: (r.vendor as string).trim(),
        })),
    ],
    lamination: (lam.data ?? []).map((r) => r.type),
    // Dedupe: post-round-3 each colour has a glossy + a matte row.
    foiling: [...new Set((foil.data ?? []).map((r) => r.color))],
    foilingFinishes: !foilFinish.error && (foilFinish.data?.length ?? 0) > 0,
    uv: (uv.data ?? []).map((r) => ({ type: r.type, unit: r.unit as "per_100sqin" | "per_sqin" })),
    relief: (relief.data ?? []).map((r) => r.type),
    foam: (foam.data ?? []).map((r) => ({
      type: r.type,
      thickness_mm: Number(r.thickness_mm),
      sheetWidth_in: Number(r.sheet_width_in),
      sheetHeight_in: Number(r.sheet_height_in),
    })),
    reverseBoardThicknesses: (reverseBoard.data ?? []).map((r) => Number(r.thickness_mm)),
    reverseBoard: (reverseBoard.data ?? []).map((r) => ({
      thickness_mm: Number(r.thickness_mm),
      sheetWidth_in: Number(r.sheet_width_in),
      sheetHeight_in: Number(r.sheet_height_in),
    })),
    magnets: (magnets.data ?? []).map((r) => ({ diameter_mm: Number(r.diameter_mm), thickness_mm: Number(r.thickness_mm) })),
    washers: (washers.data ?? []).map((r) => r.name),
    ribbonTags: (ribbon.data ?? []).map((r) => r.size_label),
    handles: (handles.data ?? []).map((r) => ({
      id: Number(r.id),
      type: r.type,
      hasImage: r.image_path != null,
    })),
    locks: (locks.data ?? []).map((r) => ({
      id: Number(r.id),
      type: r.type,
      hasImage: r.image_path != null,
    })),
    windows: (windows.data ?? []).map((r) => ({
      id: Number(r.id),
      name: r.name,
      hasImage: r.image_path != null,
      filmWidth_in: Number(r.film_width_in),
      filmHeight_in: Number(r.film_height_in),
    })),
    labourRoles: (labour.data ?? []).map((r) => r.name),
    misc: misc.error
      ? []
      : (misc.data ?? []).map((r) => ({
          id: Number(r.id),
          name: r.name,
          unit: r.unit,
          price: Number(r.price),
        })),
  };
}
