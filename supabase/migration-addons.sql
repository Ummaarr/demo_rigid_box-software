-- Migration: Handles / Locks / Window add-ons (doc 2026-06-19)
-- ---------------------------------------------------------------------------
-- Run this ONCE on an ALREADY-PROVISIONED Supabase project (SQL Editor) before
-- (or with) deploying the Batch-1 code. Idempotent: safe to re-run.
--
-- Fresh setups do NOT need this — schema.sql + seed.sql already include these
-- tables. This file only exists to upgrade a live DB created before the add-ons.
-- ---------------------------------------------------------------------------

create table if not exists public.handle_rates (
  id         bigint generated always as identity primary key,
  type       text not null unique,
  price_each numeric not null check (price_each >= 0),
  image_path text,
  is_dummy   boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.lock_rates (
  id         bigint generated always as identity primary key,
  type       text not null unique,
  price_each numeric not null check (price_each >= 0),
  image_path text,
  is_dummy   boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.window_rates (
  id             bigint generated always as identity primary key,
  name           text not null unique,
  film_width_in  numeric not null,
  film_height_in numeric not null,
  cost_per_sheet numeric not null check (cost_per_sheet >= 0),
  image_path     text,
  is_dummy       boolean not null default true,
  updated_at     timestamptz not null default now()
);

-- RLS: authenticated may read; only admins may write (same as every rate table).
do $$
declare t text;
begin
  foreach t in array array['handle_rates','lock_rates','window_rates']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "read for authenticated" on public.%I;', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true);', t);
    execute format('drop policy if exists "admin write" on public.%I;', t);
    execute format('create policy "admin write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin());', t);
  end loop;
end $$;

-- Dummy rows (replace prices + add photos via the Rates screen).
insert into public.handle_rates (type, price_each, is_dummy) values
  ('Metal bar', 12, true), ('Rope', 6, true), ('Leather strap', 18, true)
on conflict (type) do nothing;

insert into public.lock_rates (type, price_each, is_dummy) values
  ('Magnetic clasp', 9, true), ('Metal hook', 7, true), ('Push lock', 15, true)
on conflict (type) do nothing;

insert into public.window_rates (name, film_width_in, film_height_in, cost_per_sheet, is_dummy) values
  ('PVC film', 40, 50, 60, true), ('PET film', 40, 50, 85, true)
on conflict (name) do nothing;

-- Storage bucket for rate-card reference photos (Batch 2). Private — served via
-- API routes using the service-role key (browser never touches Supabase direct).
insert into storage.buckets (id, name, public)
values ('rate-images', 'rate-images', false)
on conflict (id) do nothing;

-- Board + reverse board are priced per mm of thickness. Reverse board IS kappa
-- board, so it carries the same per-mm rate. Placeholder rate: 20/mm — set your
-- own on the rate card, or edit the multiplier below before running this.
insert into public.reverse_board_rates (thickness_mm, cost_per_sheet, is_dummy) values
  (1.2, 24.00, true), (1.8, 36.00, true), (2.5, 50.00, true), (3.0, 60.00, true)
on conflict (thickness_mm, sheet_width_in, sheet_height_in) do nothing;
update public.board_rates         set cost_per_sheet = thickness_mm * 20;
update public.reverse_board_rates set cost_per_sheet = thickness_mm * 20;
