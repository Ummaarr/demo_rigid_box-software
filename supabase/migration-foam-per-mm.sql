-- Migration: foam priced per mm thickness (client review 2026-07-02).
-- Run once in the Supabase dashboard SQL editor on an EXISTING database.
-- (Fresh databases get this from schema.sql + seed.sql directly.)
--
-- Rule: like kappa board, foam gets a per-mm rate; sheet price =
-- rate_per_mm x thickness_mm. cost_per_sheet stays as the flat fallback for
-- rows without a per-mm rate (the app uses rate_per_mm only when > 0).

alter table public.foam_rates
  add column if not exists rate_per_mm numeric check (rate_per_mm >= 0);

-- DUMMY per-mm rates (one per foam type) — replace with the client's real
-- numbers via the Admin rate screen when they arrive.
update public.foam_rates set rate_per_mm = 15 where type = 'XLPE' and rate_per_mm is null;
update public.foam_rates set rate_per_mm = 11 where type = 'EPE'  and rate_per_mm is null;
update public.foam_rates set rate_per_mm = 16 where type = 'PU'   and rate_per_mm is null;
