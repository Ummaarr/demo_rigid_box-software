-- Migration: trial-role (2026-08-15) — short-lived lead-evaluation accounts.
--
-- Run ONCE in the Supabase SQL editor on the live DB (idempotent: safe to
-- re-run). Fresh installs get all of this from schema.sql.
--
-- Adds a third profiles.role, 'trial': isolated to its own clients/estimates/
-- quotes (already had a created_by column, just never enforced) and its own
-- private rate-card clone (every rate table + margin_config gains owner_id;
-- NULL = the shared master row used by admin/staff, unchanged; a real UUID =
-- one trial user's private row). RLS updated to match — this is
-- defense-in-depth only, the app's real enforcement is in the API routes
-- (lib/auth.ts, the rate query/write layer), added separately in code.
--
-- Sections:
--   1. profiles: widen role CHECK, add trial_rates_ack
--   2. is_trial() helper
--   3. owner_id + partial-unique-index migration, 20 regular rate tables
--   4. owner_id + partial-unique-index migration, the 2 vendor-nullable
--      printing tables (offset_printing_rates / digital_printing_rates)
--   5. margin_config: id becomes the real PK, owner_id added
--   6. RLS policy updates (rate tables, app_config, margin_config, clients,
--      estimates, quotes)

-- ---------------------------------------------------------------------------
-- 1. profiles
-- ---------------------------------------------------------------------------
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

alter table public.profiles add column if not exists trial_rates_ack boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. is_trial() helper
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3. owner_id + partial-unique-index migration — 20 regular rate tables
-- ---------------------------------------------------------------------------
do $$
declare
  rec record;
  con record;
begin
  for rec in
    select * from (values
      ('board_rates',         'thickness_mm, sheet_width_in, sheet_height_in'),
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
      ('reverse_board_rates', 'thickness_mm, sheet_width_in, sheet_height_in'),
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

-- ---------------------------------------------------------------------------
-- 4. offset_printing_rates / digital_printing_rates (vendor + owner, 2x2)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5. margin_config: id becomes the real PK, owner_id added
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 6. RLS policy updates
-- ---------------------------------------------------------------------------
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
    execute format('drop policy if exists "read for authenticated" on public.%I;', t);
    execute format('drop policy if exists "read own or shared" on public.%I;', t);
    execute format('create policy "read own or shared" on public.%I for select to authenticated using (owner_id is null or owner_id = auth.uid());', t);
    execute format('drop policy if exists "admin write" on public.%I;', t);
    execute format('drop policy if exists "owner or admin write" on public.%I;', t);
    execute format('create policy "owner or admin write" on public.%I for all to authenticated using (public.is_admin() or owner_id = auth.uid()) with check (public.is_admin() or owner_id = auth.uid());', t);
  end loop;
end $$;

drop policy if exists "admin only" on public.margin_config;
drop policy if exists "admin or owner" on public.margin_config;
create policy "admin or owner"
  on public.margin_config for all to authenticated
  using (public.is_admin() or owner_id = auth.uid())
  with check (public.is_admin() or owner_id = auth.uid());

drop policy if exists "read clients" on public.clients;
create policy "read clients" on public.clients for select to authenticated
  using (not public.is_trial() or created_by = auth.uid());

drop policy if exists "read estimates" on public.estimates;
create policy "read estimates" on public.estimates for select to authenticated
  using (not public.is_trial() or created_by = auth.uid());

drop policy if exists "read quotes" on public.quotes;
create policy "read quotes" on public.quotes for select to authenticated
  using (not public.is_trial() or created_by = auth.uid());
