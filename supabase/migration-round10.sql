-- Migration: round 10 (2026-08-05) — client feedback of 5-Aug.
--
-- Run ONCE in the Supabase SQL editor on the live DB (idempotent: safe to
-- re-run). Fresh installs get all of this from schema.sql.
--
-- Sections:
--   1. offset_printing_rates: unique (size_label, colour) -> (…, vendor)
--   2. digital_printing_rates: unique (size_label) -> (size_label, vendor)
--   3. quotes.notes (the template's "Additional Notes" free-text block)
--
-- 1+2 make the printing VENDOR part of the rate identity, so the same sheet
-- size can be quoted by several printers at different prices ("Printing: have
-- the option to choose a printing vendor").
--
-- `vendor` ALREADY EXISTS on both tables (schema.sql's v3 do-block adds it to
-- every rate table) — only the UNIQUE keys widen here. No data is rewritten.
--
-- EXISTING ROWS KEEP their vendor as-is. NULL means "the un-named / default
-- row". The resolver never filters on vendor when a snapshot names none, and
-- orders NULLS FIRST, so every saved estimate — and every re-run of one —
-- keeps resolving to exactly the row it resolved to before. (Verified against
-- the live DB: all 13 offset keys resolve to the same row id as before.)

-- ---------------------------------------------------------------------------
-- 1. offset_printing_rates
-- ---------------------------------------------------------------------------
-- The old key was declared inline, so its name is auto-generated. Find and
-- drop it by definition rather than guessing the name (same approach as
-- migration-round3.sql's box_type CHECK).
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'offset_printing_rates'
      and con.contype = 'u'
      and pg_get_constraintdef(con.oid) = 'UNIQUE (size_label, colour)'
  loop
    execute format('alter table public.offset_printing_rates drop constraint %I;', c.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conname = 'offset_printing_rates_size_colour_vendor_key'
  ) then
    alter table public.offset_printing_rates
      add constraint offset_printing_rates_size_colour_vendor_key
      unique (size_label, colour, vendor);
  end if;
end $$;

-- UNIQUE treats NULLs as DISTINCT, so the constraint above would happily allow
-- TWO un-named rows for one size+colour — the single ambiguity the legacy
-- (vendor-less) lookup must never face, since it would then resolve
-- arbitrarily. A partial index pins it. Portable; no PG15 NULLS NOT DISTINCT.
create unique index if not exists offset_printing_rates_size_colour_novendor_key
  on public.offset_printing_rates (size_label, colour) where vendor is null;

-- ---------------------------------------------------------------------------
-- 2. digital_printing_rates
-- ---------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'digital_printing_rates'
      and con.contype = 'u'
      and pg_get_constraintdef(con.oid) = 'UNIQUE (size_label)'
  loop
    execute format('alter table public.digital_printing_rates drop constraint %I;', c.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conname = 'digital_printing_rates_size_vendor_key'
  ) then
    alter table public.digital_printing_rates
      add constraint digital_printing_rates_size_vendor_key
      unique (size_label, vendor);
  end if;
end $$;

create unique index if not exists digital_printing_rates_size_novendor_key
  on public.digital_printing_rates (size_label) where vendor is null;

-- ---------------------------------------------------------------------------
-- 3. quotes.notes — free-text "Additional Notes" block on the quotation.
--    The client's own template (docs/quotation-template.md) has always listed
--    it; the new preview-and-edit screen is where it finally gets entered.
--    Nullable: every existing quote simply has none.
-- ---------------------------------------------------------------------------
alter table public.quotes add column if not exists notes text;
