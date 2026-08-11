-- Migration: art card stock rates (client 2-Jul: foam-cover material choice
-- "art paper / art card / special paper" — art paper = paper_rates, art card =
-- this new table). Run once in the Supabase dashboard SQL editor on an
-- EXISTING database. (Fresh databases get this from schema.sql + seed.sql.)

create table if not exists public.art_card_rates (
  id             bigint generated always as identity primary key,
  size_label     text not null,
  width_in       numeric not null,
  height_in      numeric not null,
  gsm            integer not null,
  cost_per_sheet numeric not null check (cost_per_sheet >= 0),
  is_dummy       boolean not null default true,
  updated_at     timestamptz not null default now(),
  unique (size_label, gsm)
);
alter table public.art_card_rates add column if not exists vendor text;
alter table public.art_card_rates add column if not exists updated_by text;

-- RLS: authenticated read, admin write (same policy as every rate table).
alter table public.art_card_rates enable row level security;
drop policy if exists "read for authenticated" on public.art_card_rates;
create policy "read for authenticated" on public.art_card_rates
  for select to authenticated using (true);
drop policy if exists "admin write" on public.art_card_rates;
create policy "admin write" on public.art_card_rates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- DUMMY seed (replace with real rates via the Admin rate screen).
insert into public.art_card_rates (size_label, width_in, height_in, gsm, cost_per_sheet, is_dummy) values
  ('23x36', 23, 36, 120, 10, true),
  ('23x36', 23, 36, 130, 11, true),
  ('23x36', 23, 36, 157, 13, true),
  ('23x36', 23, 36, 170, 14, true),
  ('25x36', 25, 36, 120, 11, true),
  ('25x36', 25, 36, 130, 12, true),
  ('25x36', 25, 36, 157, 14, true),
  ('25x36', 25, 36, 170, 15, true),
  ('30x40', 30, 40, 120, 14, true),
  ('30x40', 30, 40, 130, 15, true),
  ('30x40', 30, 40, 157, 18, true),
  ('30x40', 30, 40, 170, 19, true)
on conflict (size_label, gsm) do nothing;
