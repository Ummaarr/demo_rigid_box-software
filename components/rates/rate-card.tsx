"use client";

// Rate-card toolbar (client 18-Jul). Search box + a "Filter" button that
// reveals a labelled filter panel — the pattern the client asked for: every
// control named above the field, dropdowns for the enumerated values, a date
// range, and one "Clear Filters" reset.
//
// Owns the filter state and renders the sections that survive it. Row-level
// filtering happens inside each RateSection using the SAME matcher
// (lib/rates/filter), so a section can never be shown with zero visible rows or
// hidden while a row would have matched.

import { useMemo, useState } from "react";

import { RateSection, type SectionDef } from "@/components/rates/rate-section";
import {
  FilterActions,
  FilterBar,
  FilterField,
  FilterGrid,
  FilterReveal,
  FilterToggle,
} from "@/components/ui/filter-panel";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SearchInput } from "@/components/ui/search-input";
import {
  ALL,
  EMPTY_FILTERS,
  activeFilterCount,
  sectionPasses,
  vendorOptions,
  type RateFilters,
} from "@/lib/rates/filter";

export function RateCard({
  sections,
  role,
}: {
  sections: SectionDef[];
  role: "admin" | "staff" | "trial" | null;
}) {
  const [filters, setFilters] = useState<RateFilters>(EMPTY_FILTERS);
  const [open, setOpen] = useState(false);

  const patch = (p: Partial<RateFilters>) =>
    setFilters((f) => ({ ...f, ...p }));

  // Both option lists come from the sections themselves, so a new rate section
  // (or a newly typed-in vendor) needs no change here.
  const categories = useMemo(
    () => [...new Set(sections.map((s) => s.category))],
    [sections],
  );
  const vendors = useMemo(() => vendorOptions(sections), [sections]);

  const activeCount = activeFilterCount(filters);
  const visible = sections.filter((s) => sectionPasses(s, filters));

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar + panel share one un-gapped group, so a collapsed panel adds
          no stray spacing; the panel's own mt-4 supplies the gap when open. */}
      <div>
        <FilterBar
          search={
            <SearchInput
              size="lg"
              value={filters.query}
              onChange={(query) => patch({ query })}
              placeholder="Search rates…"
            />
          }
          actions={
            <FilterToggle open={open} onToggle={() => setOpen((v) => !v)} count={activeCount} />
          }
        />

        <FilterReveal open={open}>
          <FilterGrid>
            <FilterField label="Category">
              <NativeSelect
                value={filters.category}
                onChange={(e) => patch({ category: e.target.value })}
              >
                <option value={ALL}>All Categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </FilterField>

            <FilterField label="Rate Status">
              <NativeSelect
                value={filters.status}
                onChange={(e) =>
                  patch({ status: e.target.value as RateFilters["status"] })
                }
              >
                <option value="all">All Statuses</option>
                <option value="real">Real</option>
                <option value="dummy">Dummy</option>
              </NativeSelect>
            </FilterField>

            <FilterField label="Vendor">
              <NativeSelect
                value={filters.vendor}
                onChange={(e) => patch({ vendor: e.target.value })}
                disabled={vendors.length === 0}
              >
                <option value={ALL}>
                  {vendors.length === 0 ? "No vendors set" : "All Vendors"}
                </option>
                {vendors.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </NativeSelect>
            </FilterField>

            <FilterField label="Updated From">
              <Input
                type="date"
                className="h-8"
                value={filters.updatedFrom}
                onChange={(e) => patch({ updatedFrom: e.target.value })}
              />
            </FilterField>

            <FilterField label="Updated To">
              <Input
                type="date"
                className="h-8"
                value={filters.updatedTo}
                onChange={(e) => patch({ updatedTo: e.target.value })}
              />
            </FilterField>

            <FilterActions
              onClear={() => setFilters(EMPTY_FILTERS)}
              disabled={activeCount === 0 && filters.query === ""}
            />
          </FilterGrid>
        </FilterReveal>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No rates match the current search and filters.
        </p>
      ) : (
        <div className="grid gap-4">
          {visible.map((section) => (
            <RateSection
              key={section.id}
              section={section}
              role={role}
              filters={filters}
            />
          ))}
        </div>
      )}
    </div>
  );
}
