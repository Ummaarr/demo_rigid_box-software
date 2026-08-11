-- Migration: white lining stock rates (client review 2026-07).
-- Run once in the Supabase dashboard SQL editor on an EXISTING database.
-- (Fresh databases get this from schema.sql + seed.sql directly.)
--
-- The inner lining now has 4 modes: none / white paper / printed paper /
-- special paper. "White paper" is plain lining stock priced SEPARATELY from
-- the printed-paper list — this table holds those rates.

create table if not exists public.white_paper_rates (
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
alter table public.white_paper_rates add column if not exists vendor text;
alter table public.white_paper_rates add column if not exists updated_by text;

-- RLS: authenticated read, admin write (same policy as every rate table).
alter table public.white_paper_rates enable row level security;
drop policy if exists "read for authenticated" on public.white_paper_rates;
create policy "read for authenticated" on public.white_paper_rates
  for select to authenticated using (true);
drop policy if exists "admin write" on public.white_paper_rates;
create policy "admin write" on public.white_paper_rates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- DUMMY seed (same size/GSM grid as paper_rates; replace with real rates via
-- the Admin rate screen when the client provides them).
insert into public.white_paper_rates (size_label, width_in, height_in, gsm, cost_per_sheet, is_dummy) values
  ('23x36', 23, 36, 120, 6,  true),
  ('23x36', 23, 36, 130, 7,  true),
  ('23x36', 23, 36, 157, 9,  true),
  ('23x36', 23, 36, 170, 10, true),
  ('25x36', 25, 36, 120, 7,  true),
  ('25x36', 25, 36, 130, 8,  true),
  ('25x36', 25, 36, 157, 10, true),
  ('25x36', 25, 36, 170, 11, true),
  ('30x40', 30, 40, 120, 10, true),
  ('30x40', 30, 40, 130, 11, true),
  ('30x40', 30, 40, 157, 13, true),
  ('30x40', 30, 40, 170, 14, true)
on conflict (size_label, gsm) do nothing;
