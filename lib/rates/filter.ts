// Rate-card search + filter matching (client 18-Jul: "search bar for the rate
// card, filters for categories", then the labelled filter-panel pattern).
//
// Shared by the toolbar (which decides whether a whole SECTION still has
// anything to show) and each RateSection (which decides which ROWS to render),
// so a section can never be shown with zero visible rows, or hidden while one
// of its rows would have matched.
//
// Client-safe: no server-only imports.

import { inDateRange, localDateKey } from "@/lib/utils";

/** Sentinel for the "no restriction" option on the dropdown filters. */
export const ALL = "All";

export interface RateFilters {
  /** Free-text search across the columns a section renders. */
  query: string;
  /** Section category, or ALL. */
  category: string;
  /** Dummy / real rate status. */
  status: "all" | "real" | "dummy";
  /** Vendor name, or ALL. */
  vendor: string;
  /** Inclusive updated-on range, "YYYY-MM-DD" (the native date input format). */
  updatedFrom: string;
  updatedTo: string;
}

export const EMPTY_FILTERS: RateFilters = {
  query: "",
  category: ALL,
  status: "all",
  vendor: ALL,
  updatedFrom: "",
  updatedTo: "",
};

/** Minimal shape of a rate section — structurally satisfied by SectionDef. */
export interface FilterableSection {
  label: string;
  category: string;
  hasDummy: boolean;
  keyCols: { field: string; type?: string }[];
  editCols: { field: string }[];
  textEditCols?: { field: string }[];
  rows: Record<string, unknown>[];
}

/** Normalise a query for comparison. Empty string = "no search active". */
export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

/**
 * Fields the search matches a row against: exactly the columns a section
 * renders (minus dates — nobody searches by raw timestamp). Keeping this in one
 * place is what stops section-level and row-level filtering from disagreeing.
 */
export function searchableFields(s: FilterableSection): string[] {
  return [...s.keyCols, ...s.editCols, ...(s.textEditCols ?? [])]
    .filter((c) => (c as { type?: string }).type !== "date")
    .map((c) => c.field);
}

/** True when any row-level filter is set (i.e. not just the category chip). */
export function hasRowFilters(f: RateFilters): boolean {
  return (
    normalizeQuery(f.query) !== "" ||
    f.status !== "all" ||
    f.vendor !== ALL ||
    f.updatedFrom !== "" ||
    f.updatedTo !== ""
  );
}

/** How many filters are narrowing the view — shown on the Filter button. */
export function activeFilterCount(f: RateFilters): number {
  return (
    (f.category !== ALL ? 1 : 0) +
    (f.status !== "all" ? 1 : 0) +
    (f.vendor !== ALL ? 1 : 0) +
    (f.updatedFrom !== "" ? 1 : 0) +
    (f.updatedTo !== "" ? 1 : 0)
  );
}

/** True when a row's text matches the query across the given fields. */
export function rowMatches(
  row: Record<string, unknown>,
  fields: string[],
  query: string,
): boolean {
  if (!query) return true;
  return fields.some((f) => {
    const v = row[f];
    return v != null && String(v).toLowerCase().includes(query);
  });
}

/** Distinct vendors across every section, for the Vendor dropdown. */
export function vendorOptions(sections: FilterableSection[]): string[] {
  const seen = new Set<string>();
  for (const s of sections) {
    for (const r of s.rows) {
      const v = r.vendor;
      if (typeof v === "string" && v.trim()) seen.add(v.trim());
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export interface RowContext {
  fields: string[];
  hasDummy: boolean;
  /**
   * The query hit the SECTION NAME, so every row in it counts as a text match —
   * searching "foam" means "show me the foam section", not "rows saying foam".
   */
  queryHitAll: boolean;
}

/** True when a row survives every active filter. */
export function rowPasses(
  row: Record<string, unknown>,
  ctx: RowContext,
  f: RateFilters,
): boolean {
  const q = normalizeQuery(f.query);
  if (q && !ctx.queryHitAll && !rowMatches(row, ctx.fields, q)) return false;

  if (f.status !== "all") {
    // Config sections carry no dummy/real status, so they cannot satisfy a
    // status filter — they drop out rather than pretending to be "real".
    if (!ctx.hasDummy) return false;
    const isDummy = row.is_dummy === true;
    if (f.status === "dummy" ? !isDummy : isDummy) return false;
  }

  if (f.vendor !== ALL && String(row.vendor ?? "") !== f.vendor) return false;

  if (!inDateRange(localDateKey(row.updated_at), f.updatedFrom, f.updatedTo))
    return false;

  return true;
}

/** Row context for a section under the current filters. */
export function rowContext(s: FilterableSection, f: RateFilters): RowContext {
  const q = normalizeQuery(f.query);
  return {
    fields: searchableFields(s),
    hasDummy: s.hasDummy,
    queryHitAll: q !== "" && s.label.toLowerCase().includes(q),
  };
}

/** True when a section should stay on screen. */
export function sectionPasses(s: FilterableSection, f: RateFilters): boolean {
  if (f.category !== ALL && s.category !== f.category) return false;
  // Category alone never hides an EMPTY section — an admin narrowing to a
  // category still needs to see a rate table with no rows yet to add one.
  if (!hasRowFilters(f)) return true;
  const ctx = rowContext(s, f);
  return s.rows.some((r) => rowPasses(r, ctx, f));
}
