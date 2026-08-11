-- Migration: round 3 (2026-07-10) — client-feedback backlog close-out.
-- Run ONCE in the Supabase SQL editor on the live DB (idempotent: safe to re-run).
-- Fresh installs get all of this from schema.sql + seed.sql; this file exists to
-- upgrade the existing live database.
--
-- Sections:
--   1. estimates: name + status columns, box_type CHECK gains 'tray_only'
--   2. quotes + quote_counters + next_quote_no() (persistent quotes, FY numbering)
--   3. clients.type (lead / customer)
--   4. misc_rates (miscellaneous materials rate card, with image support)
--   5. white_paper_rates.name (paper type column)
--   6. magnet_rates.type
--   7. foiling_rates.finish (matte / glossy) + matte twin rows
--   8. rate_change_requests (staff propose -> admin approve workflow)

-- ---------------------------------------------------------------------------
-- 1. estimates: name + status; allow the new 'tray_only' box type
-- ---------------------------------------------------------------------------
alter table public.estimates add column if not exists name text;
alter table public.estimates add column if not exists status text not null default 'draft'
  check (status in ('draft','sent','accepted','revised'));

-- The box_type CHECK was created inline (auto-named); find and replace it.
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'estimates'
      and con.contype = 'c'
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

-- estimates gained a status column, so status updates must be allowed (RLS).
-- Specs/rates snapshots stay immutable — all writes go through API routes that
-- only ever update `status`; this policy is defense-in-depth like the others.
drop policy if exists "update estimate status" on public.estimates;
create policy "update estimate status" on public.estimates
  for update to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 2. Persistent quotes + FY-sequence numbering (<prefix>/26-27/001)
-- ---------------------------------------------------------------------------
create table if not exists public.quotes (
  id                   uuid primary key default gen_random_uuid(),
  quote_no             text not null unique,
  client_id            uuid references public.clients on delete set null,
  bill_to              jsonb not null,          -- {company, contact} snapshot at issue time
  estimate_ids         uuid[] not null,         -- provenance only (no FK: quotes keep their own items snapshot)
  items                jsonb not null,          -- QuoteItem[] exactly as rendered on the PDF
  sub_total            numeric not null,
  additional_sub_total numeric not null default 0,
  gst                  jsonb not null,          -- GstLine[]
  grand_total          numeric not null,
  terms                jsonb not null,          -- string[] as printed
  status               text not null default 'sent'
                         check (status in ('draft','sent','accepted','rejected','revised')),
  created_by           uuid references auth.users on delete set null,
  created_at           timestamptz not null default now()
);

alter table public.quotes enable row level security;
drop policy if exists "read quotes" on public.quotes;
create policy "read quotes" on public.quotes for select to authenticated using (true);
drop policy if exists "create quotes" on public.quotes;
create policy "create quotes" on public.quotes for insert to authenticated with check (true);
drop policy if exists "update quotes" on public.quotes;
create policy "update quotes" on public.quotes for update to authenticated using (true) with check (true);
drop policy if exists "admin delete quotes" on public.quotes;
create policy "admin delete quotes" on public.quotes for delete to authenticated using (public.is_admin());

-- One counter row per Indian financial year (label like '26-27'); atomic increment.
create table if not exists public.quote_counters (
  fy_label text primary key,
  last_no  integer not null default 0
);
alter table public.quote_counters enable row level security;
-- No policies: server-only via the service role (which bypasses RLS).

create or replace function public.next_quote_no(p_fy text)
returns integer
language sql
as $$
  insert into public.quote_counters as qc (fy_label, last_no) values (p_fy, 1)
  on conflict (fy_label) do update set last_no = qc.last_no + 1
  returning last_no;
$$;

-- ---------------------------------------------------------------------------
-- 3. clients.type — Lead vs Customer (client 4-Jul)
-- ---------------------------------------------------------------------------
alter table public.clients add column if not exists type text not null default 'lead'
  check (type in ('lead','customer'));

-- ---------------------------------------------------------------------------
-- 4. misc_rates — miscellaneous materials (satin, velvet, cloth buckles, …).
-- Feeds the rate card "Miscellaneous" section AND the estimate form's misc
-- add-on dropdown (price there stays a manual open input; these are defaults).
-- ---------------------------------------------------------------------------
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
  is_dummy     boolean not null default true,
  updated_at   timestamptz not null default now(),
  updated_by   text
);

alter table public.misc_rates enable row level security;
drop policy if exists "read for authenticated" on public.misc_rates;
create policy "read for authenticated" on public.misc_rates for select to authenticated using (true);
drop policy if exists "admin write" on public.misc_rates;
create policy "admin write" on public.misc_rates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

insert into public.misc_rates (name, unit, price, is_dummy) values
  ('Satin cloth',  'per metre', 40, true), -- DUMMY — replace with real rate
  ('Velvet',       'per metre', 80, true), -- DUMMY — replace with real rate
  ('Cloth buckle', 'each',       6, true)  -- DUMMY — replace with real rate
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 5. white_paper_rates.name — paper type column (client 8-Jul)
-- ---------------------------------------------------------------------------
alter table public.white_paper_rates add column if not exists name text not null default 'White paper';

-- ---------------------------------------------------------------------------
-- 6. magnet_rates.type (client 4-Jul: "add a column for magnets that says Type")
-- ---------------------------------------------------------------------------
alter table public.magnet_rates add column if not exists type text not null default 'round';

-- ---------------------------------------------------------------------------
-- 7. foiling_rates.finish — matte / glossy (client 4-Jul; prices same for now).
-- The old unique(color) must widen to unique(color, finish) before adding the
-- matte twins of the existing (glossy) rows.
-- ---------------------------------------------------------------------------
alter table public.foiling_rates add column if not exists finish text not null default 'glossy'
  check (finish in ('matte','glossy'));

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'foiling_rates_color_key' and conrelid = 'public.foiling_rates'::regclass
  ) then
    alter table public.foiling_rates drop constraint foiling_rates_color_key;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'foiling_rates_color_finish_key' and conrelid = 'public.foiling_rates'::regclass
  ) then
    alter table public.foiling_rates add constraint foiling_rates_color_finish_key unique (color, finish);
  end if;
end $$;

insert into public.foiling_rates (color, finish, rate_per_sqin, is_dummy, vendor, updated_by)
select color, 'matte', rate_per_sqin, is_dummy, vendor, updated_by
from public.foiling_rates where finish = 'glossy'
on conflict (color, finish) do nothing;

-- ---------------------------------------------------------------------------
-- 8. rate_change_requests — staff propose a rate change, admin approves in-app
-- ---------------------------------------------------------------------------
create table if not exists public.rate_change_requests (
  id               bigint generated always as identity primary key,
  table_name       text not null,
  row_id           text not null,          -- rate-table PKs are bigint; config keys are text
  row_label        text,                   -- human-readable row description at propose time
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

alter table public.rate_change_requests enable row level security;
drop policy if exists "read rate requests" on public.rate_change_requests;
create policy "read rate requests" on public.rate_change_requests for select to authenticated using (true);
drop policy if exists "create rate requests" on public.rate_change_requests;
create policy "create rate requests" on public.rate_change_requests for insert to authenticated with check (true);
drop policy if exists "admin decide rate requests" on public.rate_change_requests;
create policy "admin decide rate requests" on public.rate_change_requests
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
