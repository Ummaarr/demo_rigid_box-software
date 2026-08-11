-- Migration: vendor + updated_by columns on all rate tables
-- ---------------------------------------------------------------------------
-- Run ONCE on the live Supabase project (SQL Editor) before deploying the
-- rate-column UI update. Idempotent — safe to re-run.
--
-- Fresh setups do NOT need this — schema.sql v3 block already adds these.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'board_rates','paper_rates','special_paper_rates',
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
