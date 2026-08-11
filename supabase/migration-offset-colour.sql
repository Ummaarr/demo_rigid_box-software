-- Migration: offset printing colour tier (client 6-Jul: "under printed wrapping
-- let us have 2 options — multicolour printing and single-colour printing —
-- applicable to offset printing only"). Existing rows become 'multi' (they are
-- the client's real doc rates); single-colour rows are DUMMY placeholders (a copy
-- of the multicolour numbers) until the client sends real single-colour pricing.
-- Run once in the Supabase dashboard SQL editor on an EXISTING database.
-- (Fresh databases get this from schema.sql + seed.sql.)

alter table public.offset_printing_rates
  add column if not exists colour text not null default 'multi';

-- Swap the old (size_label) uniqueness for (size_label, colour).
alter table public.offset_printing_rates
  drop constraint if exists offset_printing_rates_size_label_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'offset_printing_rates_size_label_colour_key'
  ) then
    alter table public.offset_printing_rates
      add constraint offset_printing_rates_size_label_colour_key unique (size_label, colour);
  end if;
end$$;

alter table public.offset_printing_rates
  drop constraint if exists offset_printing_rates_colour_check;
alter table public.offset_printing_rates
  add constraint offset_printing_rates_colour_check check (colour in ('multi', 'single'));

-- Seed single-colour DUMMY rows from the existing multicolour rows.
insert into public.offset_printing_rates
  (size_label, colour, width_in, height_in, first_1000, additional_1000, is_dummy)
select size_label, 'single', width_in, height_in, first_1000, additional_1000, true
from public.offset_printing_rates
where colour = 'multi'
on conflict (size_label, colour) do nothing;
