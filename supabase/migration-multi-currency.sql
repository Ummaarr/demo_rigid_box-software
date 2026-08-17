-- Migration: multi-currency (2026-08-16) — per-market rate cards for trials.
--
-- Run ONCE in the Supabase SQL editor on the live DB (idempotent: safe to
-- re-run). Fresh installs get all of this from schema.sql (the v8 blocks).
-- Run supabase/seed-currency-templates.sql AFTER this to populate the
-- USD/GBP/AED template rows.
--
-- WHY: every price in this app was INR, displayed through one global cosmetic
-- skin (lib/brand.ts swaps the glyph to "$" without converting anything). A
-- trial lead evaluating from the US/UK/UAE therefore saw rupee figures under a
-- dollar sign. This adds a real per-market dimension: SHARED rate rows
-- (owner_id is null) fork into four template sets tagged INR/USD/GBP/AED, and
-- a trial account picks its market on first login, which decides which set
-- gets cloned into its private card.
--
-- NOTHING CHANGES FOR ADMIN/STAFF. Every existing row defaults to 'INR', the
-- master card they use is the INR set, and their display path is untouched.
-- Already-provisioned trial clones are equally unaffected (their rows also
-- default to INR, matching what they were actually priced in).
--
-- Sections:
--   1. profiles.trial_currency
--   2. currency column + rebuilt SHARED partial indexes, 20 regular rate tables
--   3. currency column + rebuilt SHARED indexes, the 2 vendor-nullable
--      printing tables (offset_printing_rates / digital_printing_rates)
--
-- NOT touched: margin_config and app_config (percentages / formula constants,
-- not prices — a 25% margin is 25% in every currency).

-- ---------------------------------------------------------------------------
-- 1. profiles
-- ---------------------------------------------------------------------------
-- NULL = this trial user hasn't picked a market yet, and therefore has NO rate
-- card at all (cloning is deferred until they choose). app/(app)/layout.tsx
-- shows them a blocking country picker instead of the app until this is set.
alter table public.profiles add column if not exists trial_currency text
  check (trial_currency in ('INR', 'USD', 'GBP', 'AED'));

-- ---------------------------------------------------------------------------
-- 2. The 20 regular rate tables.
--
-- Only the _key_shared half of v7's partial-index pair is rebuilt. The
-- _key_owned half stays exactly as it is: a trial user's clone only ever holds
-- one currency's rows, so (natural key, owner_id) is still unique for them.
-- Adding currency there would be harmless but misleading — it would imply a
-- single user can hold two currencies, which the app forbids.
-- ---------------------------------------------------------------------------
do $$
declare
  rec record;
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

-- ---------------------------------------------------------------------------
-- 2b. quotes: freeze the market a quote was priced in, alongside the items /
--     totals / GST lines it already snapshots, so re-rendering its PDF later
--     prints the same symbol it was issued with. NULL = pre-multi-currency or
--     admin/staff = the deployment's own BRAND dressing.
-- ---------------------------------------------------------------------------
alter table public.quotes add column if not exists currency text
  check (currency in ('INR', 'USD', 'GBP', 'AED'));

-- ---------------------------------------------------------------------------
-- 3. The two printing tables — currency joins the SHARED half of the
--    vendor x owner 2x2 set only, same reasoning as section 2.
-- ---------------------------------------------------------------------------
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
