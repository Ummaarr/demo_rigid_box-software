-- Migration: "Art Card" rate section becomes "Board" with a Type column.
-- Client 18-Jul. Run ONCE on an EXISTING database.
-- (Fresh databases get this from schema.sql + seed.sql.)
--
-- The section is LABELLED "Board" on the rate card; the table name stays
-- art_card_rates and the foam-cover material value stays 'art_card', so every
-- saved estimate snapshot keeps resolving exactly as before.

-- Board type (art card / duplex / grey board / …). Existing rows become
-- 'Art card', which is what they have always been.
alter table public.art_card_rates add column if not exists type text not null default 'Art card';

-- Type is part of the row identity now: the same sheet size + GSM can exist for
-- several board types. Every pre-migration row carries the same default type,
-- so widening the key can never collide on live data.
alter table public.art_card_rates drop constraint if exists art_card_rates_size_label_gsm_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'art_card_rates_type_size_label_gsm_key') then
    alter table public.art_card_rates
      add constraint art_card_rates_type_size_label_gsm_key unique (type, size_label, gsm);
  end if;
end $$;
