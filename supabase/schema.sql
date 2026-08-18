-- Rigid Box Estimator — Database Schema
-- Run this in the Supabase dashboard SQL editor (SQL Editor > New query > paste > Run).
-- Idempotent: safe to re-run. This file is the source of truth for the schema so
-- the app can be handed to the client's Supabase account by re-running it on a fresh project.
--
-- Layout:
--   1. Helper function (is_admin)
--   2. profiles (auth roles)
--   3. Rate tables (one per costing domain) — every rate is a row, never hardcoded
--   4. Config tables (app_config + margin_config)
--   5. Core entities (clients, estimates)
--   6. Row Level Security policies
--
-- Rate rows carry is_dummy = true when the value is a placeholder awaiting the
-- client's real number. Seed values + which are real live in seed.sql.

-- ===========================================================================
-- 1. profiles: one row per auth user, holds their role (admin | staff)
-- ===========================================================================
create table if not exists public.profiles (
  id         uuid references auth.users on delete cascade primary key,
  role       text not null check (role in ('admin', 'staff')),
  full_name  text,
  created_at timestamptz not null default now()
);

-- v7 (trial-role): 'trial' = a short-lived lead-evaluation account, isolated
-- to its own clients/estimates/quotes and its own private rate-card clone
-- (see the owner_id additions below). Widen the CHECK by content, not by a
-- guessed name (same technique as estimates_box_type_check further down).
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.profiles'::regclass and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I;', c.conname);
  end loop;
  alter table public.profiles add constraint profiles_role_check
    check (role in ('admin', 'staff', 'trial'));
end $$;

-- Has this trial user acknowledged the "review your rates" banner? Only
-- meaningful for role = 'trial'; unused by admin/staff.
alter table public.profiles add column if not exists trial_rates_ack boolean not null default false;

-- v8 (multi-currency): which market a trial user picked on first login — NULL
-- means "hasn't picked yet" (they land on a blocking country-picker instead of
-- the app, since there is no rate card to clone until this is set). Only
-- meaningful for role = 'trial'; unused by admin/staff, who are always INR.
-- Cannot be changed once set (see app/api/trial/set-currency) — same
-- "delete and recreate instead" rule as role.
alter table public.profiles add column if not exists trial_currency text
  check (trial_currency in ('INR', 'USD', 'GBP', 'AED'));

-- ===========================================================================
-- 2. Helpers: is_admin() / is_trial() — used by RLS policies.
--    Defined AFTER profiles because a SQL function body is validated at
--    creation time and references public.profiles.
-- ===========================================================================
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_trial()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'trial'
  );
$$;

-- ===========================================================================
-- 3. Rate tables
-- ===========================================================================

-- Kappa board (standard sheet 31 x 41 in). Prices DUMMY until client provides.
create table if not exists public.board_rates (
  id              bigint generated always as identity primary key,
  thickness_mm    numeric not null,
  -- Names the stock sheet, so an estimate can ask for a SPECIFIC one. Board is
  -- resolved by thickness in lib/db/rates.ts through a helper that throws on a
  -- multi-row match, so without a label a second size at the same thickness is
  -- legal in SQL and fatal at estimate time. See migration-sheet-sizes.sql.
  size_label      text not null,
  sheet_width_in  numeric not null default 31,
  sheet_height_in numeric not null default 41,
  -- The unit this sheet was ENTERED in. Display only — the _in columns above
  -- remain the storage contract.
  size_unit       text not null default 'in' check (size_unit in ('in','cm','mm')),
  cost_per_sheet  numeric not null check (cost_per_sheet >= 0),
  is_dummy        boolean not null default true,
  updated_at      timestamptz not null default now(),
  unique (size_label, thickness_mm)
);

-- Printed wrapping / lining paper stock (by size + GSM). DUMMY.
create table if not exists public.paper_rates (
  id             bigint generated always as identity primary key,
  size_label     text not null,
  width_in       numeric not null,
  height_in      numeric not null,
  gsm            integer not null,
  cost_per_sheet numeric not null check (cost_per_sheet >= 0),
  size_unit       text not null default 'in' check (size_unit in ('in','cm','mm')),
  is_dummy       boolean not null default true,
  updated_at     timestamptz not null default now(),
  unique (size_label, gsm)
);

-- White lining stock (plain inner lining — client 2026-07: separate rate from
-- printed paper). Same shape as paper_rates. DUMMY until client provides.
create table if not exists public.white_paper_rates (
  id             bigint generated always as identity primary key,
  name           text not null default 'White paper',
  size_label     text not null,
  width_in       numeric not null,
  height_in      numeric not null,
  gsm            integer not null,
  cost_per_sheet numeric not null check (cost_per_sheet >= 0),
  size_unit       text not null default 'in' check (size_unit in ('in','cm','mm')),
  is_dummy       boolean not null default true,
  updated_at     timestamptz not null default now(),
  unique (size_label, gsm)
);
-- v5 (round 3): paper-type name column for existing DBs.
alter table public.white_paper_rates add column if not exists name text not null default 'White paper';

-- Board stock (client 2-Jul: foam-cover material choice "art paper / art
-- card / special paper" — art paper = paper_rates, board = this). DUMMY.
-- Labelled "Board" on the rate card (client 18-Jul); the table name and the
-- 'art_card' cover-material value are unchanged so old snapshots still resolve.
create table if not exists public.art_card_rates (
  id             bigint generated always as identity primary key,
  type           text not null default 'Art card',
  size_label     text not null,
  width_in       numeric not null,
  height_in      numeric not null,
  gsm            integer not null,
  cost_per_sheet numeric not null check (cost_per_sheet >= 0),
  size_unit       text not null default 'in' check (size_unit in ('in','cm','mm')),
  is_dummy       boolean not null default true,
  updated_at     timestamptz not null default now(),
  unique (type, size_label, gsm)
);

-- v6 (client 18-Jul): existing DBs gain the board `type` column, and the row
-- identity widens to (type, size_label, gsm) so the same sheet size + GSM can
-- exist for several board types. Every pre-v6 row defaults to 'Art card', so
-- widening the key can never collide on live data.
alter table public.art_card_rates add column if not exists type text not null default 'Art card';
alter table public.art_card_rates drop constraint if exists art_card_rates_size_label_gsm_key;
-- SKIPPED once v7 (owner_id) has run: v7 replaces this bare key with a pair of
-- partial indexes, and re-adding it here on a re-run would abort the whole
-- script the moment a trial user's clone shares a key with the master row.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'art_card_rates' and column_name = 'owner_id'
  ) and not exists (
    select 1 from pg_constraint where conname = 'art_card_rates_type_size_label_gsm_key'
  ) then
    alter table public.art_card_rates
      add constraint art_card_rates_type_size_label_gsm_key unique (type, size_label, gsm);
  end if;
end $$;

-- Special (non-printed) paper — Option 2 wrapping. DUMMY.
create table if not exists public.special_paper_rates (
  id             bigint generated always as identity primary key,
  name           text not null,
  size_label     text not null,
  width_in       numeric not null,
  height_in      numeric not null,
  gsm            integer,
  cost_per_sheet numeric not null check (cost_per_sheet >= 0),
  size_unit       text not null default 'in' check (size_unit in ('in','cm','mm')),
  is_dummy       boolean not null default true,
  updated_at     timestamptz not null default now(),
  unique (name, size_label)
);

-- Offset printing — tiered (first 1000 sheets, then per additional 1000). REAL.
-- `colour` (client 6-Jul): multicolour vs single-colour, one row per (size,colour).
create table if not exists public.offset_printing_rates (
  id              bigint generated always as identity primary key,
  size_label      text not null,
  colour          text not null default 'multi' check (colour in ('multi', 'single')),
  width_in        numeric not null,
  height_in       numeric not null,
  first_1000      numeric not null check (first_1000 >= 0),
  additional_1000 numeric not null check (additional_1000 >= 0),
  size_unit       text not null default 'in' check (size_unit in ('in','cm','mm')),
  is_dummy        boolean not null default false,
  updated_at      timestamptz not null default now()
  -- NOTE: the unique key is (size_label, colour, VENDOR) — round 10, so one
  -- size can be quoted by several printers. It is declared AFTER the v3
  -- vendor/updated_by block below, because `vendor` does not exist yet here.
);

-- Digital printing — per sheet. REAL (13x19 standard).
create table if not exists public.digital_printing_rates (
  id             bigint generated always as identity primary key,
  size_label     text not null,
  width_in       numeric not null,
  height_in      numeric not null,
  cost_per_sheet numeric not null check (cost_per_sheet >= 0),
  size_unit       text not null default 'in' check (size_unit in ('in','cm','mm')),
  is_dummy       boolean not null default false,
  updated_at     timestamptz not null default now()
  -- unique (size_label, vendor) is declared after the v3 block below.
);

-- Lamination — rate per 100 sq inch. REAL.
create table if not exists public.lamination_rates (
  id                bigint generated always as identity primary key,
  type              text not null unique,
  rate_per_100sqin  numeric not null check (rate_per_100sqin >= 0),
  is_dummy          boolean not null default false,
  updated_at        timestamptz not null default now()
);

-- Foiling — rate per sq inch (formula: rate x area). REAL base 0.05.
-- finish (client 4-Jul): matte vs glossy, one row per (color, finish); prices
-- currently identical across finishes.
create table if not exists public.foiling_rates (
  id             bigint generated always as identity primary key,
  color          text not null,
  finish         text not null default 'glossy' check (finish in ('matte','glossy')),
  rate_per_sqin  numeric not null check (rate_per_sqin >= 0),
  is_dummy       boolean not null default false,
  updated_at     timestamptz not null default now(),
  constraint foiling_rates_color_finish_key unique (color, finish)
);
-- v5 (round 3): widen unique(color) -> unique(color, finish) on existing DBs.
alter table public.foiling_rates add column if not exists finish text not null default 'glossy'
  check (finish in ('matte','glossy'));
-- The add half is SKIPPED once v7 (owner_id) has run — see the note on the
-- art_card_rates block above; v7 owns this table's uniqueness from then on.
do $$
begin
  if exists (select 1 from pg_constraint
             where conname = 'foiling_rates_color_key' and conrelid = 'public.foiling_rates'::regclass) then
    alter table public.foiling_rates drop constraint foiling_rates_color_key;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'foiling_rates' and column_name = 'owner_id'
  ) and not exists (select 1 from pg_constraint
                 where conname = 'foiling_rates_color_finish_key' and conrelid = 'public.foiling_rates'::regclass) then
    alter table public.foiling_rates add constraint foiling_rates_color_finish_key unique (color, finish);
  end if;
end $$;

-- UV coating — unit varies by type (per 100 sq in vs per sq in). REAL.
create table if not exists public.uv_coating_rates (
  id         bigint generated always as identity primary key,
  type       text not null unique,
  rate       numeric not null check (rate >= 0),
  unit       text not null check (unit in ('per_100sqin', 'per_sqin')),
  is_dummy   boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Magnets (by diameter + thickness). DUMMY.
create table if not exists public.magnet_rates (
  id           bigint generated always as identity primary key,
  type         text not null default 'round',
  diameter_mm  numeric not null,
  thickness_mm numeric not null,
  price_each   numeric not null check (price_each >= 0),
  is_dummy     boolean not null default true,
  updated_at   timestamptz not null default now(),
  unique (diameter_mm, thickness_mm)
);
-- v5 (round 3): magnet type column for existing DBs.
alter table public.magnet_rates add column if not exists type text not null default 'round';

-- Washers (auto-included 1:1 with magnets). DUMMY.
create table if not exists public.washer_rates (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  price_each numeric not null check (price_each >= 0),
  is_dummy   boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Foam inserts (by type + thickness). DUMMY.
-- rate_per_mm (like board's per-mm rate): when set (> 0) the sheet
-- price = rate_per_mm x thickness_mm; cost_per_sheet is the flat fallback.
create table if not exists public.foam_rates (
  id              bigint generated always as identity primary key,
  type            text not null check (type in ('XLPE', 'EPE', 'PU')),
  thickness_mm    numeric not null,
  sheet_width_in  numeric not null,
  sheet_height_in numeric not null,
  cost_per_sheet  numeric not null check (cost_per_sheet >= 0),
  rate_per_mm     numeric check (rate_per_mm >= 0),
  size_unit       text not null default 'in' check (size_unit in ('in','cm','mm')),
  is_dummy        boolean not null default true,
  updated_at      timestamptz not null default now(),
  unique (type, thickness_mm)
);
-- v4: per-mm rate added after v1 tables shipped.
alter table public.foam_rates add column if not exists rate_per_mm numeric check (rate_per_mm >= 0);

-- Reverse-board insert stock (by thickness). DUMMY.
create table if not exists public.reverse_board_rates (
  id              bigint generated always as identity primary key,
  thickness_mm    numeric not null,
  -- Names the stock sheet, so an estimate can ask for a SPECIFIC one. Board is
  -- resolved by thickness in lib/db/rates.ts through a helper that throws on a
  -- multi-row match, so without a label a second size at the same thickness is
  -- legal in SQL and fatal at estimate time. See migration-sheet-sizes.sql.
  size_label      text not null,
  sheet_width_in  numeric not null default 31,
  sheet_height_in numeric not null default 41,
  -- The unit this sheet was ENTERED in. Display only — the _in columns above
  -- remain the storage contract.
  size_unit       text not null default 'in' check (size_unit in ('in','cm','mm')),
  cost_per_sheet  numeric not null check (cost_per_sheet >= 0),
  is_dummy        boolean not null default true,
  updated_at      timestamptz not null default now(),
  unique (size_label, thickness_mm)
);

-- Fixed consumables: tape (REAL 2/tray), glue + metlock (DUMMY).
create table if not exists public.consumable_rates (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  rate       numeric not null check (rate >= 0),
  unit       text not null,
  is_dummy   boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Labour by role (month / day / hour rates). Each estimate picks role + unit
-- (hour|day) + quantity. REAL rates from client doc. (per_day = month/25,
-- per_hour = day/8.)
create table if not exists public.labour_rates (
  id            bigint generated always as identity primary key,
  name          text not null unique,
  rate_per_day  numeric not null check (rate_per_day >= 0),
  is_dummy      boolean not null default true,
  updated_at    timestamptz not null default now()
);
-- v2: added month + hour rates (table may already exist from v1).
alter table public.labour_rates add column if not exists rate_per_hour numeric;
alter table public.labour_rates add column if not exists rate_per_month numeric;

-- Ribbon tag insert (auto for drawer / double decker). 10mm standard or custom.
create table if not exists public.ribbon_tag_rates (
  id         bigint generated always as identity primary key,
  size_label text not null unique,
  price_each numeric not null check (price_each >= 0),
  is_dummy   boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Relief printing (embossing / debossing) — rate per sq inch. REAL (0.50).
create table if not exists public.relief_rates (
  id            bigint generated always as identity primary key,
  type          text not null unique,
  rate_per_sqin numeric not null check (rate_per_sqin >= 0),
  is_dummy      boolean not null default false,
  updated_at    timestamptz not null default now()
);

-- Handles (manual customisation, priced by type). DUMMY.
-- image_path holds a reference photo for the rate card (client-requested; wired in Batch 2).
create table if not exists public.handle_rates (
  id         bigint generated always as identity primary key,
  type       text not null unique,
  price_each numeric not null check (price_each >= 0),
  image_path text,
  is_dummy   boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Locks (manual customisation, priced by type). DUMMY.
create table if not exists public.lock_rates (
  id         bigint generated always as identity primary key,
  type       text not null unique,
  price_each numeric not null check (price_each >= 0),
  image_path text,
  is_dummy   boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Window film (e.g. PVC/PET) — nested on a film sheet like foam. DUMMY.
create table if not exists public.window_rates (
  id             bigint generated always as identity primary key,
  name           text not null unique,
  film_width_in  numeric not null,
  film_height_in numeric not null,
  cost_per_sheet numeric not null check (cost_per_sheet >= 0),
  image_path     text,
  size_unit       text not null default 'in' check (size_unit in ('in','cm','mm')),
  is_dummy       boolean not null default true,
  updated_at     timestamptz not null default now()
);

-- Miscellaneous materials (round 3 — satin, velvet, cloth buckles, …). Feeds
-- the rate card "Miscellaneous" section and default prices for the estimate
-- form's misc add-on dropdown (the add-on price itself stays a manual input).
create table if not exists public.misc_rates (
  id           bigint generated always as identity primary key,
  name         text not null unique,
  unit         text not null default 'each',
  width_in     numeric check (width_in >= 0),
  height_in    numeric check (height_in >= 0),
  thickness_mm numeric check (thickness_mm >= 0),
  price        numeric not null check (price >= 0),
  vendor       text,
  image_path   text,
  size_unit       text not null default 'in' check (size_unit in ('in','cm','mm')),
  is_dummy     boolean not null default true,
  updated_at   timestamptz not null default now(),
  updated_by   text
);

-- v3: vendor (supplier name) + updated_by (who last changed the rate) on all rate
-- tables. MUST stay after the last `create table` above — it alters tables by name,
-- so on a fresh database an earlier position aborts the whole script with
-- `relation "public.ribbon_tag_rates" does not exist`.
-- (misc_rates ships with vendor/updated_by inline, so it is not in this list.)
do $$
declare t text;
begin
  foreach t in array array[
    'board_rates','paper_rates','white_paper_rates','art_card_rates','special_paper_rates',
    'offset_printing_rates','digital_printing_rates',
    'lamination_rates','foiling_rates','uv_coating_rates',
    'magnet_rates','washer_rates','foam_rates',
    'reverse_board_rates','consumable_rates','labour_rates',
    'ribbon_tag_rates','relief_rates',
    'handle_rates','lock_rates','window_rates'
  ]
  loop
    execute format('alter table public.%I add column if not exists vendor text;', t);
    execute format('alter table public.%I add column if not exists updated_by text;', t);
  end loop;
end $$;

-- v4 (round 10): printing vendor is part of the rate identity, so one sheet
-- size can be quoted by several printers at different prices. MUST stay after
-- the v3 block — these keys reference `vendor`, which v3 creates.
-- NULL vendor = the un-named / default row. UNIQUE treats NULLs as DISTINCT,
-- so each table also gets a PARTIAL index guaranteeing at most one such row
-- per size — otherwise a vendor-less lookup (any pre-round-10 snapshot) could
-- resolve arbitrarily. Kept in sync with supabase/migration-printing-vendor.sql.
-- Both halves are SKIPPED once v7 (owner_id) has run — v7 replaces these keys
-- with the full vendor x owner 2x2 index set below, and re-adding them on a
-- re-run would abort the script once any trial clone exists.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'offset_printing_rates' and column_name = 'owner_id'
  ) then
    if not exists (select 1 from pg_constraint where conname = 'offset_printing_rates_size_colour_vendor_key') then
      alter table public.offset_printing_rates
        add constraint offset_printing_rates_size_colour_vendor_key unique (size_label, colour, vendor);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'digital_printing_rates_size_vendor_key') then
      alter table public.digital_printing_rates
        add constraint digital_printing_rates_size_vendor_key unique (size_label, vendor);
    end if;
    create unique index if not exists offset_printing_rates_size_colour_novendor_key
      on public.offset_printing_rates (size_label, colour) where vendor is null;
    create unique index if not exists digital_printing_rates_size_novendor_key
      on public.digital_printing_rates (size_label) where vendor is null;
  end if;
end $$;

-- v7 (trial-role): owner_id scopes a rate row to NULL (the shared master
-- card, used by admin/staff — unchanged behaviour) or a specific trial
-- user's private clone. A plain composite unique(..., owner_id) would NOT
-- stop two master rows sharing a key (SQL treats NULL <> NULL), so every
-- natural key below is replaced with a pair of PARTIAL unique indexes —
-- same reasoning as the vendor partial-index pair just above, generalised
-- with a data-driven loop since the key differs per table. Kept in sync with
-- supabase/migration-trial-role.sql.
do $$
declare
  rec record;
  con record;
begin
  for rec in
    select * from (values
      ('board_rates',         'size_label, thickness_mm'),
      ('paper_rates',         'size_label, gsm'),
      ('white_paper_rates',   'size_label, gsm'),
      ('art_card_rates',      'type, size_label, gsm'),
      ('special_paper_rates', 'name, size_label'),
      ('lamination_rates',    'type'),
      ('foiling_rates',       'color, finish'),
      ('uv_coating_rates',    'type'),
      ('magnet_rates',        'diameter_mm, thickness_mm'),
      ('washer_rates',        'name'),
      ('foam_rates',          'type, thickness_mm'),
      ('reverse_board_rates', 'size_label, thickness_mm'),
      ('consumable_rates',    'name'),
      ('labour_rates',        'name'),
      ('ribbon_tag_rates',    'size_label'),
      ('relief_rates',        'type'),
      ('handle_rates',        'type'),
      ('lock_rates',          'type'),
      ('window_rates',        'name'),
      ('misc_rates',          'name')
    ) as t(tbl, cols)
  loop
    execute format(
      'alter table public.%I add column if not exists owner_id uuid references auth.users(id) on delete cascade;',
      rec.tbl
    );

    -- Drop whatever UNIQUE constraint currently enforces the bare natural
    -- key (auto-named or explicitly named) — it's about to be replaced.
    -- Never touches the primary key (contype 'p', not 'u').
    for con in
      select conname from pg_constraint
      where conrelid = ('public.' || rec.tbl)::regclass and contype = 'u'
    loop
      execute format('alter table public.%I drop constraint %I;', rec.tbl, con.conname);
    end loop;

    execute format(
      'create unique index if not exists %I on public.%I (%s) where owner_id is null;',
      rec.tbl || '_key_shared', rec.tbl, rec.cols
    );
    execute format(
      'create unique index if not exists %I on public.%I (%s, owner_id) where owner_id is not null;',
      rec.tbl || '_key_owned', rec.tbl, rec.cols
    );
  end loop;
end $$;

-- offset_printing_rates / digital_printing_rates have a SECOND nullable
-- dimension (vendor) on top of owner_id, so they need the full 2x2
-- combination instead of the generic 2-way split above.
alter table public.offset_printing_rates add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.digital_printing_rates add column if not exists owner_id uuid references auth.users(id) on delete cascade;

-- Drop EVERY unique constraint on these two tables, not just the round-10
-- ones by name: depending on which migrations a database has seen it may also
-- still carry the older auto-named `unique (size_label, colour)` /
-- `unique (size_label)` keys. Leaving one behind silently blocks a trial
-- user's clone (the second copy of each print size collides with it), which
-- surfaces only as "Failed to set up the trial rate card".
do $$
declare con record;
begin
  for con in
    select conrelid::regclass::text as tbl, conname
    from pg_constraint
    where conrelid in ('public.offset_printing_rates'::regclass,
                       'public.digital_printing_rates'::regclass)
      and contype = 'u'
  loop
    execute format('alter table %s drop constraint %I;', con.tbl, con.conname);
  end loop;
end $$;
drop index if exists public.offset_printing_rates_size_colour_novendor_key;
drop index if exists public.digital_printing_rates_size_novendor_key;

create unique index if not exists offset_printing_rates_v_o_key
  on public.offset_printing_rates (size_label, colour, vendor, owner_id)
  where vendor is not null and owner_id is not null;
create unique index if not exists offset_printing_rates_v_shared_key
  on public.offset_printing_rates (size_label, colour, vendor)
  where vendor is not null and owner_id is null;
create unique index if not exists offset_printing_rates_novendor_owned_key
  on public.offset_printing_rates (size_label, colour, owner_id)
  where vendor is null and owner_id is not null;
create unique index if not exists offset_printing_rates_novendor_shared_key
  on public.offset_printing_rates (size_label, colour)
  where vendor is null and owner_id is null;

create unique index if not exists digital_printing_rates_v_o_key
  on public.digital_printing_rates (size_label, vendor, owner_id)
  where vendor is not null and owner_id is not null;
create unique index if not exists digital_printing_rates_v_shared_key
  on public.digital_printing_rates (size_label, vendor)
  where vendor is not null and owner_id is null;
create unique index if not exists digital_printing_rates_novendor_owned_key
  on public.digital_printing_rates (size_label, owner_id)
  where vendor is null and owner_id is not null;
create unique index if not exists digital_printing_rates_novendor_shared_key
  on public.digital_printing_rates (size_label)
  where vendor is null and owner_id is null;

-- v8 (multi-currency): currency scopes a rate row the same way owner_id scopes
-- it by user. SHARED (owner_id is null) rows fork into four per-market
-- template sets (INR/USD/GBP/AED) — a trial user's own clone only ever holds
-- ONE currency's worth of rows (chosen once at first login, see
-- app/api/trial/set-currency), so the _key_owned indexes from v7 need no
-- change; only the _key_shared half of each pair gains currency. Every
-- existing row defaults to 'INR', so admin/staff's real data and every
-- already-provisioned INR trial clone are untouched. Same data-driven-loop
-- technique as v7, over the same 20-table list. Kept in sync with
-- supabase/migration-multi-currency.sql.
do $$
declare
  rec record;
begin
  for rec in
    select * from (values
      ('board_rates',         'size_label, thickness_mm'),
      ('paper_rates',         'size_label, gsm'),
      ('white_paper_rates',   'size_label, gsm'),
      ('art_card_rates',      'type, size_label, gsm'),
      ('special_paper_rates', 'name, size_label'),
      ('lamination_rates',    'type'),
      ('foiling_rates',       'color, finish'),
      ('uv_coating_rates',    'type'),
      ('magnet_rates',        'diameter_mm, thickness_mm'),
      ('washer_rates',        'name'),
      ('foam_rates',          'type, thickness_mm'),
      ('reverse_board_rates', 'size_label, thickness_mm'),
      ('consumable_rates',    'name'),
      ('labour_rates',        'name'),
      ('ribbon_tag_rates',    'size_label'),
      ('relief_rates',        'type'),
      ('handle_rates',        'type'),
      ('lock_rates',          'type'),
      ('window_rates',        'name'),
      ('misc_rates',          'name')
    ) as t(tbl, cols)
  loop
    execute format(
      $f$alter table public.%I add column if not exists currency text not null default 'INR' check (currency in ('INR','USD','GBP','AED'));$f$,
      rec.tbl
    );

    execute format('drop index if exists public.%I;', rec.tbl || '_key_shared');
    execute format(
      'create unique index if not exists %I on public.%I (currency, %s) where owner_id is null;',
      rec.tbl || '_key_shared', rec.tbl, rec.cols
    );
  end loop;
end $$;

-- offset_printing_rates / digital_printing_rates: currency joins the two
-- SHARED variants of the vendor x owner 2x2 index set only (the ones with
-- `where ... and owner_id is null`); the OWNED variants are untouched.
alter table public.offset_printing_rates add column if not exists currency text not null default 'INR' check (currency in ('INR','USD','GBP','AED'));
alter table public.digital_printing_rates add column if not exists currency text not null default 'INR' check (currency in ('INR','USD','GBP','AED'));

drop index if exists public.offset_printing_rates_v_shared_key;
drop index if exists public.offset_printing_rates_novendor_shared_key;
drop index if exists public.digital_printing_rates_v_shared_key;
drop index if exists public.digital_printing_rates_novendor_shared_key;

create unique index if not exists offset_printing_rates_v_shared_key
  on public.offset_printing_rates (currency, size_label, colour, vendor)
  where vendor is not null and owner_id is null;
create unique index if not exists offset_printing_rates_novendor_shared_key
  on public.offset_printing_rates (currency, size_label, colour)
  where vendor is null and owner_id is null;

create unique index if not exists digital_printing_rates_v_shared_key
  on public.digital_printing_rates (currency, size_label, vendor)
  where vendor is not null and owner_id is null;
create unique index if not exists digital_printing_rates_novendor_shared_key
  on public.digital_printing_rates (currency, size_label)
  where vendor is null and owner_id is null;

-- ===========================================================================
-- 4. Config tables
-- ===========================================================================

-- Scalar config readable by all authenticated users (overhead %, folding
-- allowance, lid depth default, MOQ, lining reduction).
create table if not exists public.app_config (
  key         text primary key,
  value       numeric not null,
  unit        text,
  description text,
  is_dummy    boolean not null default false,
  updated_at  timestamptz not null default now()
);

-- Margin lives ALONE so RLS can keep it admin-only — Staff must never see margin.
create table if not exists public.margin_config (
  key         text primary key,
  value       numeric not null,
  description text,
  is_dummy    boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- v7 (trial-role): a trial user gets their own private margin_config clone
-- (their margin is just their own markup input on their own estimate, not
-- the company's real default). `key` alone can no longer be the primary key
-- once master + per-owner rows may share the same key value — id becomes the
-- real PK; key stays unique WITHIN an owner scope via the same partial-index
-- pattern used for the rate tables above.
alter table public.margin_config add column if not exists id uuid not null default gen_random_uuid();
alter table public.margin_config add column if not exists owner_id uuid references auth.users(id) on delete cascade;
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'margin_config_pkey' and conrelid = 'public.margin_config'::regclass and contype = 'p'
  ) then
    alter table public.margin_config drop constraint margin_config_pkey;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'margin_config_id_pkey' and conrelid = 'public.margin_config'::regclass and contype = 'p'
  ) then
    alter table public.margin_config add constraint margin_config_id_pkey primary key (id);
  end if;
end $$;
create unique index if not exists margin_config_key_shared_key
  on public.margin_config (key) where owner_id is null;
create unique index if not exists margin_config_key_owned_key
  on public.margin_config (key, owner_id) where owner_id is not null;

-- ===========================================================================
-- 5. Core entities
-- ===========================================================================

create table if not exists public.clients (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  type           text not null default 'lead' check (type in ('lead','customer')),
  contact_person text,
  phone          text,
  email          text,
  address        text,
  created_by     uuid references auth.users on delete set null,
  created_at     timestamptz not null default now()
);
-- v5 (round 3): lead/customer type for existing DBs.
alter table public.clients add column if not exists type text not null default 'lead'
  check (type in ('lead','customer'));

-- An estimate freezes its inputs (specs_snapshot) and ALL rates used
-- (rates_snapshot) so it never changes when rates are later updated.
-- name = optional user-entered label; status tracks the quote lifecycle
-- (draft -> sent -> accepted; 'revised' is set automatically on the source
-- estimate when a re-run (?from=<id>) estimate is saved).
create table if not exists public.estimates (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid references public.clients on delete set null,
  name           text,
  box_type       text not null,
  status         text not null default 'draft' check (status in ('draft','sent','accepted','revised')),
  quantity       integer not null check (quantity > 0),
  specs_snapshot jsonb not null,
  rates_snapshot jsonb not null,
  cost_breakdown jsonb,
  price_per_box  numeric,
  total_price    numeric,
  created_by     uuid references auth.users on delete set null,
  created_at     timestamptz not null default now()
);
-- v5 (round 3): name + status for existing DBs; box_type CHECK now lives as a
-- named constraint (replaced below) so new box types are one-line changes.
alter table public.estimates add column if not exists name text;
alter table public.estimates add column if not exists status text not null default 'draft'
  check (status in ('draft','sent','accepted','revised'));
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.estimates'::regclass and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%box_type%'
  loop
    execute format('alter table public.estimates drop constraint %I;', c.conname);
  end loop;
  alter table public.estimates add constraint estimates_box_type_check
    check (box_type in (
      'telescopic','magnetic','shoulder','drawer_sliding',
      'matchbox_sliding','hinge_lid','collapsible_rigid','double_decker',
      'tray_only'));
end $$;

-- A saved quote snapshots everything printed on the PDF (items, terms, totals,
-- bill-to) so it stays stable even if estimates/clients/rates change later.
-- estimate_ids is provenance only (no FK): deleting an estimate never breaks a quote.
create table if not exists public.quotes (
  id                   uuid primary key default gen_random_uuid(),
  quote_no             text not null unique,
  client_id            uuid references public.clients on delete set null,
  bill_to              jsonb not null,
  estimate_ids         uuid[] not null,
  items                jsonb not null,
  sub_total            numeric not null,
  additional_sub_total numeric not null default 0,
  gst                  jsonb not null,
  grand_total          numeric not null,
  terms                jsonb not null,
  -- Free-text "Additional Notes" block (round 10) — from the client's own
  -- quotation template; entered on the preview-and-edit screen.
  notes                text,
  status               text not null default 'sent'
                         check (status in ('draft','sent','accepted','rejected','revised')),
  created_by           uuid references auth.users on delete set null,
  created_at           timestamptz not null default now()
);

-- v8 (multi-currency): which market this quote was priced in, frozen with the
-- rest of the snapshot so re-rendering its PDF years later still prints the
-- right symbol. NULL = issued before multi-currency, or by admin/staff, both
-- of which render with the deployment's own BRAND dressing.
alter table public.quotes add column if not exists currency text
  check (currency in ('INR', 'USD', 'GBP', 'AED'));

-- One counter row per Indian financial year (label like '26-27'); the function
-- increments atomically so concurrent quote saves can never collide.
create table if not exists public.quote_counters (
  fy_label text primary key,
  last_no  integer not null default 0
);

create or replace function public.next_quote_no(p_fy text)
returns integer
language sql
as $$
  insert into public.quote_counters as qc (fy_label, last_no) values (p_fy, 1)
  on conflict (fy_label) do update set last_no = qc.last_no + 1
  returning last_no;
$$;

-- Rate-change requests (round 3): staff propose a rate edit, admin approves or
-- rejects in-app. Applying an approved change goes through the same validated
-- update path as a direct admin edit.
create table if not exists public.rate_change_requests (
  id               bigint generated always as identity primary key,
  table_name       text not null,
  row_id           text not null,
  row_label        text,
  field            text not null,
  old_value        text,
  new_value        text not null,
  proposed_by      uuid references auth.users on delete set null,
  proposed_by_name text,
  proposed_at      timestamptz not null default now(),
  status           text not null default 'pending'
                     check (status in ('pending','approved','rejected')),
  decided_by_name  text,
  decided_at       timestamptz
);

-- ===========================================================================
-- 6. Row Level Security
-- ===========================================================================
-- All real access is server-side via the service_role key (which bypasses RLS).
-- These policies are defense-in-depth.

-- profiles: a user may read only their own row.
alter table public.profiles enable row level security;
drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

-- Rate tables: authenticated can READ shared (owner_id is null) or their OWN
-- (owner_id = auth.uid()) rows; admins can write shared rows, a user can
-- write only rows they own. Applied in a loop to keep the policy identical
-- and DRY across every table. app_config is handled separately below — it
-- has no owner concept and stays global.
do $$
declare t text;
begin
  foreach t in array array[
    'board_rates','paper_rates','white_paper_rates','art_card_rates','special_paper_rates','offset_printing_rates',
    'digital_printing_rates','lamination_rates','foiling_rates','uv_coating_rates',
    'relief_rates','magnet_rates','washer_rates','ribbon_tag_rates','foam_rates',
    'reverse_board_rates','consumable_rates','labour_rates',
    'handle_rates','lock_rates','window_rates','misc_rates'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "read for authenticated" on public.%I;', t);
    execute format('drop policy if exists "read own or shared" on public.%I;', t);
    execute format('create policy "read own or shared" on public.%I for select to authenticated using (owner_id is null or owner_id = auth.uid());', t);
    execute format('drop policy if exists "admin write" on public.%I;', t);
    execute format('drop policy if exists "owner or admin write" on public.%I;', t);
    execute format('create policy "owner or admin write" on public.%I for all to authenticated using (public.is_admin() or owner_id = auth.uid()) with check (public.is_admin() or owner_id = auth.uid());', t);
  end loop;
end $$;

-- app_config: unchanged — global formula config (folding allowance, wastage
-- %, etc.), no owner concept, every role reads the same values.
alter table public.app_config enable row level security;
drop policy if exists "read for authenticated" on public.app_config;
create policy "read for authenticated" on public.app_config for select to authenticated using (true);
drop policy if exists "admin write" on public.app_config;
create policy "admin write" on public.app_config for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- margin_config: admin reads/writes the shared master row; a trial user
-- reads/writes only their own owned row. Staff match neither branch, so they
-- still see nothing (unchanged).
alter table public.margin_config enable row level security;
drop policy if exists "admin only" on public.margin_config;
drop policy if exists "admin or owner" on public.margin_config;
create policy "admin or owner"
  on public.margin_config for all to authenticated
  using (public.is_admin() or owner_id = auth.uid())
  with check (public.is_admin() or owner_id = auth.uid());

-- clients: authenticated can read + create + update; only admins delete.
-- A trial account only ever reads rows IT created; admin/staff still read
-- everything (support visibility / shared internal use, unchanged).
alter table public.clients enable row level security;
drop policy if exists "read clients" on public.clients;
create policy "read clients" on public.clients for select to authenticated
  using (not public.is_trial() or created_by = auth.uid());
drop policy if exists "create clients" on public.clients;
create policy "create clients" on public.clients for insert to authenticated with check (true);
drop policy if exists "update clients" on public.clients;
create policy "update clients" on public.clients for update to authenticated using (true) with check (true);
drop policy if exists "admin delete clients" on public.clients;
create policy "admin delete clients" on public.clients for delete to authenticated using (public.is_admin());

-- estimates: authenticated can read + create; snapshots are immutable but the
-- STATUS column is updatable (round 3) — the API routes only ever update status.
-- Only admins may delete. Same trial-scoped read as clients, above.
alter table public.estimates enable row level security;
drop policy if exists "read estimates" on public.estimates;
create policy "read estimates" on public.estimates for select to authenticated
  using (not public.is_trial() or created_by = auth.uid());
drop policy if exists "create estimates" on public.estimates;
create policy "create estimates" on public.estimates for insert to authenticated with check (true);
drop policy if exists "update estimate status" on public.estimates;
create policy "update estimate status" on public.estimates
  for update to authenticated using (true) with check (true);
drop policy if exists "admin delete estimates" on public.estimates;
create policy "admin delete estimates" on public.estimates for delete to authenticated using (public.is_admin());

-- quotes: authenticated read + create + update (status); only admins delete.
-- Same trial-scoped read as clients/estimates, above.
alter table public.quotes enable row level security;
drop policy if exists "read quotes" on public.quotes;
create policy "read quotes" on public.quotes for select to authenticated
  using (not public.is_trial() or created_by = auth.uid());
drop policy if exists "create quotes" on public.quotes;
create policy "create quotes" on public.quotes for insert to authenticated with check (true);
drop policy if exists "update quotes" on public.quotes;
create policy "update quotes" on public.quotes for update to authenticated using (true) with check (true);
drop policy if exists "admin delete quotes" on public.quotes;
create policy "admin delete quotes" on public.quotes for delete to authenticated using (public.is_admin());

-- quote_counters: server-only (service role bypasses RLS; no policies).
alter table public.quote_counters enable row level security;

-- rate_change_requests: authenticated read + propose; only admins decide.
alter table public.rate_change_requests enable row level security;
drop policy if exists "read rate requests" on public.rate_change_requests;
create policy "read rate requests" on public.rate_change_requests for select to authenticated using (true);
drop policy if exists "create rate requests" on public.rate_change_requests;
create policy "create rate requests" on public.rate_change_requests for insert to authenticated with check (true);
drop policy if exists "admin decide rate requests" on public.rate_change_requests;
create policy "admin decide rate requests" on public.rate_change_requests
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ===========================================================================
-- 7. Storage — rate-card reference images (handles / locks / windows)
-- ===========================================================================
-- Private bucket. The app reads/writes it ONLY through API routes using the
-- service-role key (the browser never touches Supabase directly). The
-- *_rates.image_path columns hold the object path within this bucket.
insert into storage.buckets (id, name, public)
values ('rate-images', 'rate-images', false)
on conflict (id) do nothing;

-- ===========================================================================
-- Creating the first admin (manual, one-time):
--   1. Authentication > Users > Add user  (set email + password)
--   2. Copy that user's UID
--   3. Run, replacing the UID and name:
--
--   insert into public.profiles (id, role, full_name)
--   values ('PASTE-USER-UID-HERE', 'admin', 'Admin Name');
-- ===========================================================================
