-- Migration: per-business sheet sizes (2026-08-18).
--
-- Run ONCE in the Supabase SQL editor on the live DB (idempotent: safe to
-- re-run). Fresh installs get all of this from schema.sql (the v9 blocks).
--
-- WHY: every rigid-box maker buys different stock, but the app shipped one
-- implicit board sheet (31x41 in) and three inch-labelled paper sizes. A maker
-- buying 70 x 100 cm sheets could not model their real costs at all, which is
-- the whole point of a trial account.
--
-- Two changes, both additive:
--
--   1. size_unit — the unit a sheet was ENTERED in, remembered per row so a
--      metric buyer reads back "70 x 100 cm" instead of "27.56 x 39.37 in".
--      Storage stays INCHES everywhere; this is display only. Defaulting to
--      'in' means every existing row renders exactly as it does today.
--
--   2. size_label on board_rates / reverse_board_rates, which becomes part of
--      their natural key. Board previously had NO way to name a sheet, and
--      lib/db/rates.ts resolves it by thickness alone through a helper that
--      THROWS when more than one row matches — so a second board size at the
--      same thickness was legal in SQL and fatal at estimate time. The label
--      is what lets an estimate say WHICH board sheet it wants.
--
-- NOTHING CHANGES FOR EXISTING DATA. Every row keeps its stored inches, gets
-- size_unit 'in', and board rows get a label derived from the dimensions they
-- already hold (in practice '31x41', the old column default). Saved estimates
-- are doubly safe: rates_snapshot already freezes the resolved board sheet, so
-- re-costing one never re-runs the lookup this changes.

-- ---------------------------------------------------------------------------
-- 1. size_unit on every table that carries a stock sheet dimension.
--
-- Note the three different naming conventions this covers — sheet_width_in /
-- sheet_height_in (board, reverse board, foam), width_in / height_in (paper
-- family, printing, misc) and film_width_in / film_height_in (window). The
-- unit column is named the same everywhere regardless.
--
-- Unique keys are deliberately NOT rebuilt for this: two rows differing only
-- by size_unit would be one physical sheet described twice, which the existing
-- keys already reject.
-- ---------------------------------------------------------------------------
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'board_rates', 'paper_rates', 'white_paper_rates', 'art_card_rates',
    'special_paper_rates', 'offset_printing_rates', 'digital_printing_rates',
    'foam_rates', 'reverse_board_rates', 'window_rates', 'misc_rates'
  ]
  loop
    execute format(
      $f$alter table public.%I add column if not exists size_unit text not null default 'in' check (size_unit in ('in','cm','mm'));$f$,
      tbl
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. size_label on the two board tables, then their natural key rebuilt to
--    (size_label, thickness_mm) — mirroring paper_rates' (size_label, gsm).
--
-- The old key was (thickness_mm, sheet_width_in, sheet_height_in): the size
-- was IN the key, so several sizes were already legal, but nothing could name
-- one. Keying on the label instead makes the estimate request able to ask for
-- a specific sheet, and keeps a business from holding two rows that differ
-- only by rounding on the same nominal stock.
-- ---------------------------------------------------------------------------
do $$
declare
  rec record;
  con record;
begin
  for rec in
    select * from (values
      ('board_rates'),
      ('reverse_board_rates')
    ) as t(tbl)
  loop
    execute format('alter table public.%I add column if not exists size_label text;', rec.tbl);

    -- Backfill from the dimensions the row already holds, rendering whole
    -- numbers without a trailing ".0" so the result reads like the labels a
    -- human types ('31x41', not '31.0x41.0').
    --
    -- The column names are spelled out rather than parameterised: both tables
    -- use sheet_width_in / sheet_height_in, and only the TABLE varies.
    execute format(
      $q$update public.%I set size_label =
             (case when sheet_width_in = round(sheet_width_in)
                   then round(sheet_width_in)::bigint::text
                   else sheet_width_in::text end)
             || 'x' ||
             (case when sheet_height_in = round(sheet_height_in)
                   then round(sheet_height_in)::bigint::text
                   else sheet_height_in::text end)
           where size_label is null;$q$,
      rec.tbl
    );

    execute format('alter table public.%I alter column size_label set not null;', rec.tbl);

    -- Drop any surviving UNIQUE constraint on the bare natural key, then both
    -- halves of the v7/v8 partial-index pair, before rebuilding on the label.
    -- Never touches the primary key (contype 'p', not 'u').
    for con in
      select conname from pg_constraint
      where conrelid = ('public.' || rec.tbl)::regclass and contype = 'u'
    loop
      execute format('alter table public.%I drop constraint %I;', rec.tbl, con.conname);
    end loop;

    execute format('drop index if exists public.%I;', rec.tbl || '_key_shared');
    execute format('drop index if exists public.%I;', rec.tbl || '_key_owned');

    execute format(
      'create unique index if not exists %I on public.%I (currency, size_label, thickness_mm) where owner_id is null;',
      rec.tbl || '_key_shared', rec.tbl
    );
    execute format(
      'create unique index if not exists %I on public.%I (size_label, thickness_mm, owner_id) where owner_id is not null;',
      rec.tbl || '_key_owned', rec.tbl
    );
  end loop;
end $$;
