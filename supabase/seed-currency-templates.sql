-- Rigid Box Estimator — per-market rate templates (USD / GBP / AED)
--
-- Run AFTER schema.sql and seed.sql (and after migration-multi-currency.sql on
-- an already-deployed DB). Idempotent, like seed.sql.
--
-- WHAT THIS IS: seed.sql seeds the INR market — the shared master card admin
-- and staff use. This file adds the SAME catalogue three more times, priced for
-- the three export markets a trial lead can pick from at first login. A trial
-- who picks "United States" gets the USD rows cloned into their private card
-- (lib/db/clone-rate-card.ts), so they evaluate against plausible US costs
-- instead of rupee figures relabelled with a dollar sign.
--
-- Every row is a SHARED master row (owner_id null) tagged with its currency,
-- so each `on conflict` restates BOTH `currency` (now the first column of every
-- shared partial index) and `where owner_id is null`. See seed.sql's header for
-- why the predicate has to be repeated.
--
-- PRICING PROVENANCE — read this before quoting any of it as fact:
-- These are INDUSTRY-REPRESENTATIVE RESEARCH FIGURES, not supplier quotes.
-- Labour is anchored on real published wage data per market (US BLS packaging
-- operator rates, UK National Living Wage / packing-operative surveys, UAE
-- factory-worker salary data), which is why the three differ so sharply:
-- US/UK factory labour runs roughly 8-10x India's, while the UAE's blue-collar
-- base sits much closer to India's. Material, printing, finishing and hardware
-- figures are derived from those anchors plus converting-industry cost ratios,
-- since no single public price list covers this catalogue. They are marked
-- is_dummy = true for exactly that reason — the rate card badges them, and a
-- lead is expected to replace them with their own real costs, which is the
-- entire point of handing them a private editable card.
--
-- Units are IDENTICAL to seed.sql (inches, per sheet, per sq in, per 100 sq in,
-- offset first-1000/additional-1000, labour per month/day/hour) — this is a
-- like-for-like price swap, not a schema change.

-- ===========================================================================
-- UNITED STATES (USD)
-- ===========================================================================
insert into public.board_rates (currency, size_label, thickness_mm, cost_per_sheet, is_dummy) values
  ('USD', '31x41', 1.2, 0.72, true),
  ('USD', '31x41', 1.5, 0.90, true),
  ('USD', '31x41', 1.8, 1.08, true),
  ('USD', '31x41', 2.0, 1.20, true),
  ('USD', '31x41', 2.5, 1.50, true),
  ('USD', '31x41', 3.0, 1.80, true)
on conflict (currency, size_label, thickness_mm) where owner_id is null do nothing;

insert into public.paper_rates (currency, size_label, width_in, height_in, gsm, cost_per_sheet, is_dummy) values
  ('USD', '23x36', 23, 36, 120, 0.32, true),
  ('USD', '23x36', 23, 36, 130, 0.36, true),
  ('USD', '23x36', 23, 36, 157, 0.44, true),
  ('USD', '23x36', 23, 36, 170, 0.48, true),
  ('USD', '25x36', 25, 36, 120, 0.36, true),
  ('USD', '25x36', 25, 36, 130, 0.40, true),
  ('USD', '25x36', 25, 36, 157, 0.48, true),
  ('USD', '25x36', 25, 36, 170, 0.52, true),
  ('USD', '30x40', 30, 40, 120, 0.48, true),
  ('USD', '30x40', 30, 40, 130, 0.52, true),
  ('USD', '30x40', 30, 40, 157, 0.64, true),
  ('USD', '30x40', 30, 40, 170, 0.68, true)
on conflict (currency, size_label, gsm) where owner_id is null do nothing;

insert into public.white_paper_rates (currency, size_label, width_in, height_in, gsm, cost_per_sheet, is_dummy) values
  ('USD', '23x36', 23, 36, 120, 0.24, true),
  ('USD', '23x36', 23, 36, 130, 0.28, true),
  ('USD', '23x36', 23, 36, 157, 0.36, true),
  ('USD', '23x36', 23, 36, 170, 0.40, true),
  ('USD', '25x36', 25, 36, 120, 0.28, true),
  ('USD', '25x36', 25, 36, 130, 0.32, true),
  ('USD', '25x36', 25, 36, 157, 0.40, true),
  ('USD', '25x36', 25, 36, 170, 0.44, true),
  ('USD', '30x40', 30, 40, 120, 0.40, true),
  ('USD', '30x40', 30, 40, 130, 0.44, true),
  ('USD', '30x40', 30, 40, 157, 0.52, true),
  ('USD', '30x40', 30, 40, 170, 0.56, true)
on conflict (currency, size_label, gsm) where owner_id is null do nothing;

insert into public.art_card_rates (currency, type, size_label, width_in, height_in, gsm, cost_per_sheet, is_dummy) values
  ('USD', 'Art card', '23x36', 23, 36, 120, 0.40, true),
  ('USD', 'Art card', '23x36', 23, 36, 130, 0.44, true),
  ('USD', 'Art card', '23x36', 23, 36, 157, 0.52, true),
  ('USD', 'Art card', '23x36', 23, 36, 170, 0.56, true),
  ('USD', 'Art card', '25x36', 25, 36, 120, 0.44, true),
  ('USD', 'Art card', '25x36', 25, 36, 130, 0.48, true),
  ('USD', 'Art card', '25x36', 25, 36, 157, 0.56, true),
  ('USD', 'Art card', '25x36', 25, 36, 170, 0.60, true),
  ('USD', 'Art card', '30x40', 30, 40, 120, 0.56, true),
  ('USD', 'Art card', '30x40', 30, 40, 130, 0.60, true),
  ('USD', 'Art card', '30x40', 30, 40, 157, 0.72, true),
  ('USD', 'Art card', '30x40', 30, 40, 170, 0.76, true)
on conflict (currency, type, size_label, gsm) where owner_id is null do nothing;

insert into public.special_paper_rates (currency, name, size_label, width_in, height_in, gsm, cost_per_sheet, is_dummy) values
  ('USD', 'Keycolor Black',  '23x36', 23, 36, 120, 2.25, true),
  ('USD', 'Wibalin Natural', '25x36', 25, 36, 115, 2.70, true)
on conflict (currency, name, size_label) where owner_id is null do nothing;

insert into public.offset_printing_rates (currency, size_label, colour, width_in, height_in, first_1000, additional_1000, is_dummy) values
  ('USD', '18x25', 'multi',  18, 25, 180, 54, true),
  ('USD', '20x30', 'multi',  20, 30, 228, 66, true),
  ('USD', '22x25', 'multi',  22, 25, 228, 66, true),
  ('USD', '20x28', 'multi',  20, 28, 228, 66, true),
  ('USD', '25x36', 'multi',  25, 36, 324, 78, true),
  ('USD', '23x36', 'multi',  23, 36, 324, 78, true),
  ('USD', '28x40', 'multi',  28, 40, 420, 96, true),
  ('USD', '18x25', 'single', 18, 25, 180, 54, true),
  ('USD', '20x30', 'single', 20, 30, 228, 66, true),
  ('USD', '22x25', 'single', 22, 25, 228, 66, true),
  ('USD', '20x28', 'single', 20, 28, 228, 66, true),
  ('USD', '25x36', 'single', 25, 36, 324, 78, true),
  ('USD', '23x36', 'single', 23, 36, 324, 78, true),
  ('USD', '28x40', 'single', 28, 40, 420, 96, true)
on conflict (currency, size_label, colour) where vendor is null and owner_id is null do nothing;

insert into public.digital_printing_rates (currency, size_label, width_in, height_in, cost_per_sheet, is_dummy) values
  ('USD', '13x19', 13, 19, 0.90, true),
  ('USD', '13x23', 13, 23, 0.90, true),
  ('USD', '13x23 (both sides)', 13, 23, 1.15, true),
  ('USD', '13x30', 13, 30, 1.35, true)
on conflict (currency, size_label) where vendor is null and owner_id is null do nothing;

insert into public.lamination_rates (currency, type, rate_per_100sqin, is_dummy) values
  ('USD', 'matte',      1.20, true),
  ('USD', 'glossy',     1.10, true),
  ('USD', 'thermal',    2.60, true),
  ('USD', 'soft_touch', 4.00, true)
on conflict (currency, type) where owner_id is null do nothing;

insert into public.foiling_rates (currency, color, finish, rate_per_sqin, is_dummy) values
  ('USD', 'gold',   'glossy', 0.12, true),
  ('USD', 'gold',   'matte',  0.12, true),
  ('USD', 'silver', 'glossy', 0.12, true),
  ('USD', 'silver', 'matte',  0.12, true),
  ('USD', 'copper', 'glossy', 0.12, true),
  ('USD', 'copper', 'matte',  0.12, true),
  ('USD', 'others', 'glossy', 0.12, true),
  ('USD', 'others', 'matte',  0.12, true)
on conflict (currency, color, finish) where owner_id is null do nothing;

insert into public.uv_coating_rates (currency, type, rate, unit, is_dummy) values
  ('USD', 'full_uv',  1.00, 'per_100sqin', true),
  ('USD', 'spot',     0.12, 'per_sqin',    true),
  ('USD', 'drip_off', 1.80, 'per_100sqin', true),
  ('USD', 'aquas',    0.85, 'per_100sqin', true)
on conflict (currency, type) where owner_id is null do nothing;

insert into public.relief_rates (currency, type, rate_per_sqin, is_dummy) values
  ('USD', 'embossing', 1.10, true),
  ('USD', 'debossing', 1.10, true)
on conflict (currency, type) where owner_id is null do nothing;

insert into public.magnet_rates (currency, diameter_mm, thickness_mm, price_each, is_dummy) values
  ('USD', 10, 1.5, 0.18, true),
  ('USD', 10, 2.0, 0.22, true),
  ('USD', 15, 1.5, 0.28, true),
  ('USD', 15, 2.0, 0.35, true)
on conflict (currency, diameter_mm, thickness_mm) where owner_id is null do nothing;

insert into public.washer_rates (currency, name, price_each, is_dummy) values
  ('USD', '10mm', 0.12, true),
  ('USD', '15mm', 0.18, true)
on conflict (currency, name) where owner_id is null do nothing;

insert into public.foam_rates (currency, type, thickness_mm, sheet_width_in, sheet_height_in, cost_per_sheet, rate_per_mm, is_dummy) values
  ('USD', 'XLPE', 5,  40, 80, 10.00, 1.65, true),
  ('USD', 'XLPE', 10, 40, 80, 16.50, 1.65, true),
  ('USD', 'EPE',  5,  40, 80, 7.70,  1.20, true),
  ('USD', 'EPE',  10, 40, 80, 12.10, 1.20, true),
  ('USD', 'PU',   10, 40, 80, 20.00, 1.75, true),
  ('USD', 'PU',   20, 40, 80, 35.00, 1.75, true)
on conflict (currency, type, thickness_mm) where owner_id is null do nothing;

insert into public.reverse_board_rates (currency, size_label, thickness_mm, cost_per_sheet, is_dummy) values
  ('USD', '31x41', 1.2, 0.72, true),
  ('USD', '31x41', 1.5, 0.90, true),
  ('USD', '31x41', 1.8, 1.08, true),
  ('USD', '31x41', 2.0, 1.20, true),
  ('USD', '31x41', 2.5, 1.50, true),
  ('USD', '31x41', 3.0, 1.80, true)
on conflict (currency, size_label, thickness_mm) where owner_id is null do nothing;

insert into public.consumable_rates (currency, name, rate, unit, is_dummy) values
  ('USD', 'tape', 0.20, 'per_tray_or_lid', true)
on conflict (currency, name) where owner_id is null do nothing;

insert into public.labour_rates (currency, name, rate_per_month, rate_per_day, rate_per_hour, is_dummy) values
  ('USD', 'Designer',  5600, 224, 28, true),
  ('USD', 'Cutting',   4800, 192, 24, true),
  ('USD', 'Grooving',  4400, 176, 22, true),
  ('USD', 'Punching',  5000, 200, 25, true),
  ('USD', 'Floorwork', 3600, 144, 18, true),
  ('USD', 'Universal', 6000, 240, 30, true)
on conflict (currency, name) where owner_id is null do nothing;

insert into public.ribbon_tag_rates (currency, size_label, price_each, is_dummy) values
  ('USD', '10mm', 0.25, true)
on conflict (currency, size_label) where owner_id is null do nothing;

insert into public.handle_rates (currency, type, price_each, is_dummy) values
  ('USD', 'Metal bar',     4.00, true),
  ('USD', 'Rope',          1.80, true),
  ('USD', 'Leather strap', 7.50, true)
on conflict (currency, type) where owner_id is null do nothing;

insert into public.lock_rates (currency, type, price_each, is_dummy) values
  ('USD', 'Magnetic clasp', 1.80, true),
  ('USD', 'Metal hook',     1.40, true),
  ('USD', 'Push lock',      3.20, true)
on conflict (currency, type) where owner_id is null do nothing;

insert into public.window_rates (currency, name, film_width_in, film_height_in, cost_per_sheet, is_dummy) values
  ('USD', 'PVC film', 40, 50, 2.00, true),
  ('USD', 'PET film', 40, 50, 2.80, true)
on conflict (currency, name) where owner_id is null do nothing;

insert into public.misc_rates (currency, name, unit, price, is_dummy) values
  ('USD', 'Satin cloth',  'per metre', 3.00, true),
  ('USD', 'Velvet',       'per metre', 6.00, true),
  ('USD', 'Cloth buckle', 'each',      0.60, true)
on conflict (currency, name) where owner_id is null do nothing;

-- ===========================================================================
-- UNITED KINGDOM (GBP)
-- ===========================================================================
insert into public.board_rates (currency, size_label, thickness_mm, cost_per_sheet, is_dummy) values
  ('GBP', '31x41', 1.2, 0.60, true),
  ('GBP', '31x41', 1.5, 0.75, true),
  ('GBP', '31x41', 1.8, 0.90, true),
  ('GBP', '31x41', 2.0, 1.00, true),
  ('GBP', '31x41', 2.5, 1.25, true),
  ('GBP', '31x41', 3.0, 1.50, true)
on conflict (currency, size_label, thickness_mm) where owner_id is null do nothing;

insert into public.paper_rates (currency, size_label, size_unit, width_in, height_in, gsm, cost_per_sheet, is_dummy) values
  ('GBP', '23x36', 'in', 23, 36, 120, 0.25, true),
  ('GBP', '23x36', 'in', 23, 36, 130, 0.30, true),
  ('GBP', '23x36', 'in', 23, 36, 157, 0.35, true),
  ('GBP', '23x36', 'in', 23, 36, 170, 0.40, true),
  ('GBP', '25x36', 'in', 25, 36, 120, 0.30, true),
  ('GBP', '25x36', 'in', 25, 36, 130, 0.32, true),
  ('GBP', '25x36', 'in', 25, 36, 157, 0.38, true),
  ('GBP', '25x36', 'in', 25, 36, 170, 0.42, true),
  ('GBP', '30x40', 'in', 30, 40, 120, 0.40, true),
  ('GBP', '30x40', 'in', 30, 40, 130, 0.42, true),
  ('GBP', '30x40', 'in', 30, 40, 157, 0.50, true),
  ('GBP', '30x40', 'in', 30, 40, 170, 0.55, true),
  -- Metric stock. UK mills sell 70x100 and 50x70 cm; the
  -- inches below are those sheets converted, and size_unit 'cm' is what
  -- makes them read back as centimetres on the rate card.
  ('GBP', '70x100', 'cm', 27.5591, 39.3701, 120, 0.44, true),
  ('GBP', '70x100', 'cm', 27.5591, 39.3701, 130, 0.47, true),
  ('GBP', '70x100', 'cm', 27.5591, 39.3701, 157, 0.55, true),
  ('GBP', '70x100', 'cm', 27.5591, 39.3701, 170, 0.61, true),
  ('GBP', '50x70', 'cm', 19.685, 27.5591, 120, 0.22, true),
  ('GBP', '50x70', 'cm', 19.685, 27.5591, 130, 0.24, true),
  ('GBP', '50x70', 'cm', 19.685, 27.5591, 157, 0.28, true),
  ('GBP', '50x70', 'cm', 19.685, 27.5591, 170, 0.31, true)
on conflict (currency, size_label, gsm) where owner_id is null do nothing;

insert into public.white_paper_rates (currency, size_label, width_in, height_in, gsm, cost_per_sheet, is_dummy) values
  ('GBP', '23x36', 23, 36, 120, 0.20, true),
  ('GBP', '23x36', 23, 36, 130, 0.22, true),
  ('GBP', '23x36', 23, 36, 157, 0.28, true),
  ('GBP', '23x36', 23, 36, 170, 0.32, true),
  ('GBP', '25x36', 25, 36, 120, 0.22, true),
  ('GBP', '25x36', 25, 36, 130, 0.25, true),
  ('GBP', '25x36', 25, 36, 157, 0.32, true),
  ('GBP', '25x36', 25, 36, 170, 0.35, true),
  ('GBP', '30x40', 30, 40, 120, 0.32, true),
  ('GBP', '30x40', 30, 40, 130, 0.35, true),
  ('GBP', '30x40', 30, 40, 157, 0.42, true),
  ('GBP', '30x40', 30, 40, 170, 0.45, true)
on conflict (currency, size_label, gsm) where owner_id is null do nothing;

insert into public.art_card_rates (currency, type, size_label, width_in, height_in, gsm, cost_per_sheet, is_dummy) values
  ('GBP', 'Art card', '23x36', 23, 36, 120, 0.32, true),
  ('GBP', 'Art card', '23x36', 23, 36, 130, 0.35, true),
  ('GBP', 'Art card', '23x36', 23, 36, 157, 0.42, true),
  ('GBP', 'Art card', '23x36', 23, 36, 170, 0.45, true),
  ('GBP', 'Art card', '25x36', 25, 36, 120, 0.35, true),
  ('GBP', 'Art card', '25x36', 25, 36, 130, 0.38, true),
  ('GBP', 'Art card', '25x36', 25, 36, 157, 0.45, true),
  ('GBP', 'Art card', '25x36', 25, 36, 170, 0.48, true),
  ('GBP', 'Art card', '30x40', 30, 40, 120, 0.45, true),
  ('GBP', 'Art card', '30x40', 30, 40, 130, 0.48, true),
  ('GBP', 'Art card', '30x40', 30, 40, 157, 0.58, true),
  ('GBP', 'Art card', '30x40', 30, 40, 170, 0.61, true)
on conflict (currency, type, size_label, gsm) where owner_id is null do nothing;

insert into public.special_paper_rates (currency, name, size_label, width_in, height_in, gsm, cost_per_sheet, is_dummy) values
  ('GBP', 'Keycolor Black',  '23x36', 23, 36, 120, 1.80, true),
  ('GBP', 'Wibalin Natural', '25x36', 25, 36, 115, 2.15, true)
on conflict (currency, name, size_label) where owner_id is null do nothing;

insert into public.offset_printing_rates (currency, size_label, colour, width_in, height_in, first_1000, additional_1000, is_dummy) values
  ('GBP', '18x25', 'multi',  18, 25, 144, 43, true),
  ('GBP', '20x30', 'multi',  20, 30, 182, 53, true),
  ('GBP', '22x25', 'multi',  22, 25, 182, 53, true),
  ('GBP', '20x28', 'multi',  20, 28, 182, 53, true),
  ('GBP', '25x36', 'multi',  25, 36, 259, 62, true),
  ('GBP', '23x36', 'multi',  23, 36, 259, 62, true),
  ('GBP', '28x40', 'multi',  28, 40, 336, 77, true),
  ('GBP', '18x25', 'single', 18, 25, 144, 43, true),
  ('GBP', '20x30', 'single', 20, 30, 182, 53, true),
  ('GBP', '22x25', 'single', 22, 25, 182, 53, true),
  ('GBP', '20x28', 'single', 20, 28, 182, 53, true),
  ('GBP', '25x36', 'single', 25, 36, 259, 62, true),
  ('GBP', '23x36', 'single', 23, 36, 259, 62, true),
  ('GBP', '28x40', 'single', 28, 40, 336, 77, true)
on conflict (currency, size_label, colour) where vendor is null and owner_id is null do nothing;

insert into public.digital_printing_rates (currency, size_label, width_in, height_in, cost_per_sheet, is_dummy) values
  ('GBP', '13x19', 13, 19, 0.75, true),
  ('GBP', '13x23', 13, 23, 0.75, true),
  ('GBP', '13x23 (both sides)', 13, 23, 0.90, true),
  ('GBP', '13x30', 13, 30, 1.10, true)
on conflict (currency, size_label) where vendor is null and owner_id is null do nothing;

insert into public.lamination_rates (currency, type, rate_per_100sqin, is_dummy) values
  ('GBP', 'matte',      1.00, true),
  ('GBP', 'glossy',     0.90, true),
  ('GBP', 'thermal',    2.10, true),
  ('GBP', 'soft_touch', 3.20, true)
on conflict (currency, type) where owner_id is null do nothing;

insert into public.foiling_rates (currency, color, finish, rate_per_sqin, is_dummy) values
  ('GBP', 'gold',   'glossy', 0.10, true),
  ('GBP', 'gold',   'matte',  0.10, true),
  ('GBP', 'silver', 'glossy', 0.10, true),
  ('GBP', 'silver', 'matte',  0.10, true),
  ('GBP', 'copper', 'glossy', 0.10, true),
  ('GBP', 'copper', 'matte',  0.10, true),
  ('GBP', 'others', 'glossy', 0.10, true),
  ('GBP', 'others', 'matte',  0.10, true)
on conflict (currency, color, finish) where owner_id is null do nothing;

insert into public.uv_coating_rates (currency, type, rate, unit, is_dummy) values
  ('GBP', 'full_uv',  0.80, 'per_100sqin', true),
  ('GBP', 'spot',     0.10, 'per_sqin',    true),
  ('GBP', 'drip_off', 1.45, 'per_100sqin', true),
  ('GBP', 'aquas',    0.70, 'per_100sqin', true)
on conflict (currency, type) where owner_id is null do nothing;

insert into public.relief_rates (currency, type, rate_per_sqin, is_dummy) values
  ('GBP', 'embossing', 0.90, true),
  ('GBP', 'debossing', 0.90, true)
on conflict (currency, type) where owner_id is null do nothing;

insert into public.magnet_rates (currency, diameter_mm, thickness_mm, price_each, is_dummy) values
  ('GBP', 10, 1.5, 0.14, true),
  ('GBP', 10, 2.0, 0.18, true),
  ('GBP', 15, 1.5, 0.22, true),
  ('GBP', 15, 2.0, 0.28, true)
on conflict (currency, diameter_mm, thickness_mm) where owner_id is null do nothing;

insert into public.washer_rates (currency, name, price_each, is_dummy) values
  ('GBP', '10mm', 0.10, true),
  ('GBP', '15mm', 0.14, true)
on conflict (currency, name) where owner_id is null do nothing;

insert into public.foam_rates (currency, type, thickness_mm, sheet_width_in, sheet_height_in, cost_per_sheet, rate_per_mm, is_dummy) values
  ('GBP', 'XLPE', 5,  40, 80, 8.00,  1.30, true),
  ('GBP', 'XLPE', 10, 40, 80, 13.20, 1.30, true),
  ('GBP', 'EPE',  5,  40, 80, 6.20,  1.00, true),
  ('GBP', 'EPE',  10, 40, 80, 9.70,  1.00, true),
  ('GBP', 'PU',   10, 40, 80, 16.00, 1.40, true),
  ('GBP', 'PU',   20, 40, 80, 28.00, 1.40, true)
on conflict (currency, type, thickness_mm) where owner_id is null do nothing;

insert into public.reverse_board_rates (currency, size_label, thickness_mm, cost_per_sheet, is_dummy) values
  ('GBP', '31x41', 1.2, 0.60, true),
  ('GBP', '31x41', 1.5, 0.75, true),
  ('GBP', '31x41', 1.8, 0.90, true),
  ('GBP', '31x41', 2.0, 1.00, true),
  ('GBP', '31x41', 2.5, 1.25, true),
  ('GBP', '31x41', 3.0, 1.50, true)
on conflict (currency, size_label, thickness_mm) where owner_id is null do nothing;

insert into public.consumable_rates (currency, name, rate, unit, is_dummy) values
  ('GBP', 'tape', 0.15, 'per_tray_or_lid', true)
on conflict (currency, name) where owner_id is null do nothing;

insert into public.labour_rates (currency, name, rate_per_month, rate_per_day, rate_per_hour, is_dummy) values
  ('GBP', 'Designer',  4000, 160, 20,   true),
  ('GBP', 'Cutting',   3000, 120, 15,   true),
  ('GBP', 'Grooving',  2800, 112, 14,   true),
  ('GBP', 'Punching',  3100, 124, 15.5, true),
  ('GBP', 'Floorwork', 2500, 100, 12.5, true),
  ('GBP', 'Universal', 3600, 144, 18,   true)
on conflict (currency, name) where owner_id is null do nothing;

insert into public.ribbon_tag_rates (currency, size_label, price_each, is_dummy) values
  ('GBP', '10mm', 0.20, true)
on conflict (currency, size_label) where owner_id is null do nothing;

insert into public.handle_rates (currency, type, price_each, is_dummy) values
  ('GBP', 'Metal bar',     3.20, true),
  ('GBP', 'Rope',          1.45, true),
  ('GBP', 'Leather strap', 6.00, true)
on conflict (currency, type) where owner_id is null do nothing;

insert into public.lock_rates (currency, type, price_each, is_dummy) values
  ('GBP', 'Magnetic clasp', 1.45, true),
  ('GBP', 'Metal hook',     1.15, true),
  ('GBP', 'Push lock',      2.60, true)
on conflict (currency, type) where owner_id is null do nothing;

insert into public.window_rates (currency, name, film_width_in, film_height_in, cost_per_sheet, is_dummy) values
  ('GBP', 'PVC film', 40, 50, 1.60, true),
  ('GBP', 'PET film', 40, 50, 2.25, true)
on conflict (currency, name) where owner_id is null do nothing;

insert into public.misc_rates (currency, name, unit, price, is_dummy) values
  ('GBP', 'Satin cloth',  'per metre', 2.40, true),
  ('GBP', 'Velvet',       'per metre', 4.80, true),
  ('GBP', 'Cloth buckle', 'each',      0.50, true)
on conflict (currency, name) where owner_id is null do nothing;

-- ===========================================================================
-- UNITED ARAB EMIRATES (AED)
-- ===========================================================================
insert into public.board_rates (currency, size_label, thickness_mm, cost_per_sheet, is_dummy) values
  ('AED', '31x41', 1.2, 1.55, true),
  ('AED', '31x41', 1.5, 1.95, true),
  ('AED', '31x41', 1.8, 2.35, true),
  ('AED', '31x41', 2.0, 2.60, true),
  ('AED', '31x41', 2.5, 3.25, true),
  ('AED', '31x41', 3.0, 3.90, true)
on conflict (currency, size_label, thickness_mm) where owner_id is null do nothing;

insert into public.paper_rates (currency, size_label, size_unit, width_in, height_in, gsm, cost_per_sheet, is_dummy) values
  ('AED', '23x36', 'in', 23, 36, 120, 0.55, true),
  ('AED', '23x36', 'in', 23, 36, 130, 0.65, true),
  ('AED', '23x36', 'in', 23, 36, 157, 0.75, true),
  ('AED', '23x36', 'in', 23, 36, 170, 0.85, true),
  ('AED', '25x36', 'in', 25, 36, 120, 0.65, true),
  ('AED', '25x36', 'in', 25, 36, 130, 0.70, true),
  ('AED', '25x36', 'in', 25, 36, 157, 0.85, true),
  ('AED', '25x36', 'in', 25, 36, 170, 0.90, true),
  ('AED', '30x40', 'in', 30, 40, 120, 0.85, true),
  ('AED', '30x40', 'in', 30, 40, 130, 0.90, true),
  ('AED', '30x40', 'in', 30, 40, 157, 1.10, true),
  ('AED', '30x40', 'in', 30, 40, 170, 1.20, true),
  -- Metric stock. Gulf mills sell 70x100 and 50x70 cm; the
  -- inches below are those sheets converted, and size_unit 'cm' is what
  -- makes them read back as centimetres on the rate card.
  ('AED', '70x100', 'cm', 27.5591, 39.3701, 120, 2.1, true),
  ('AED', '70x100', 'cm', 27.5591, 39.3701, 130, 2.25, true),
  ('AED', '70x100', 'cm', 27.5591, 39.3701, 157, 2.65, true),
  ('AED', '70x100', 'cm', 27.5591, 39.3701, 170, 2.9, true),
  ('AED', '50x70', 'cm', 19.685, 27.5591, 120, 1.05, true),
  ('AED', '50x70', 'cm', 19.685, 27.5591, 130, 1.13, true),
  ('AED', '50x70', 'cm', 19.685, 27.5591, 157, 1.33, true),
  ('AED', '50x70', 'cm', 19.685, 27.5591, 170, 1.45, true)
on conflict (currency, size_label, gsm) where owner_id is null do nothing;

insert into public.white_paper_rates (currency, size_label, width_in, height_in, gsm, cost_per_sheet, is_dummy) values
  ('AED', '23x36', 23, 36, 120, 0.40, true),
  ('AED', '23x36', 23, 36, 130, 0.50, true),
  ('AED', '23x36', 23, 36, 157, 0.65, true),
  ('AED', '23x36', 23, 36, 170, 0.70, true),
  ('AED', '25x36', 25, 36, 120, 0.50, true),
  ('AED', '25x36', 25, 36, 130, 0.55, true),
  ('AED', '25x36', 25, 36, 157, 0.70, true),
  ('AED', '25x36', 25, 36, 170, 0.75, true),
  ('AED', '30x40', 30, 40, 120, 0.70, true),
  ('AED', '30x40', 30, 40, 130, 0.75, true),
  ('AED', '30x40', 30, 40, 157, 0.90, true),
  ('AED', '30x40', 30, 40, 170, 1.00, true)
on conflict (currency, size_label, gsm) where owner_id is null do nothing;

insert into public.art_card_rates (currency, type, size_label, width_in, height_in, gsm, cost_per_sheet, is_dummy) values
  ('AED', 'Art card', '23x36', 23, 36, 120, 0.70, true),
  ('AED', 'Art card', '23x36', 23, 36, 130, 0.75, true),
  ('AED', 'Art card', '23x36', 23, 36, 157, 0.90, true),
  ('AED', 'Art card', '23x36', 23, 36, 170, 1.00, true),
  ('AED', 'Art card', '25x36', 25, 36, 120, 0.75, true),
  ('AED', 'Art card', '25x36', 25, 36, 130, 0.85, true),
  ('AED', 'Art card', '25x36', 25, 36, 157, 1.00, true),
  ('AED', 'Art card', '25x36', 25, 36, 170, 1.05, true),
  ('AED', 'Art card', '30x40', 30, 40, 120, 1.00, true),
  ('AED', 'Art card', '30x40', 30, 40, 130, 1.05, true),
  ('AED', 'Art card', '30x40', 30, 40, 157, 1.25, true),
  ('AED', 'Art card', '30x40', 30, 40, 170, 1.35, true)
on conflict (currency, type, size_label, gsm) where owner_id is null do nothing;

insert into public.special_paper_rates (currency, name, size_label, width_in, height_in, gsm, cost_per_sheet, is_dummy) values
  ('AED', 'Keycolor Black',  '23x36', 23, 36, 120, 2.50, true),
  ('AED', 'Wibalin Natural', '25x36', 25, 36, 115, 3.00, true)
on conflict (currency, name, size_label) where owner_id is null do nothing;

insert into public.offset_printing_rates (currency, size_label, colour, width_in, height_in, first_1000, additional_1000, is_dummy) values
  ('AED', '18x25', 'multi',  18, 25, 360, 108, true),
  ('AED', '20x30', 'multi',  20, 30, 456, 132, true),
  ('AED', '22x25', 'multi',  22, 25, 456, 132, true),
  ('AED', '20x28', 'multi',  20, 28, 456, 132, true),
  ('AED', '25x36', 'multi',  25, 36, 648, 156, true),
  ('AED', '23x36', 'multi',  23, 36, 648, 156, true),
  ('AED', '28x40', 'multi',  28, 40, 840, 192, true),
  ('AED', '18x25', 'single', 18, 25, 360, 108, true),
  ('AED', '20x30', 'single', 20, 30, 456, 132, true),
  ('AED', '22x25', 'single', 22, 25, 456, 132, true),
  ('AED', '20x28', 'single', 20, 28, 456, 132, true),
  ('AED', '25x36', 'single', 25, 36, 648, 156, true),
  ('AED', '23x36', 'single', 23, 36, 648, 156, true),
  ('AED', '28x40', 'single', 28, 40, 840, 192, true)
on conflict (currency, size_label, colour) where vendor is null and owner_id is null do nothing;

insert into public.digital_printing_rates (currency, size_label, width_in, height_in, cost_per_sheet, is_dummy) values
  ('AED', '13x19', 13, 19, 1.75, true),
  ('AED', '13x23', 13, 23, 1.75, true),
  ('AED', '13x23 (both sides)', 13, 23, 2.25, true),
  ('AED', '13x30', 13, 30, 2.65, true)
on conflict (currency, size_label) where vendor is null and owner_id is null do nothing;

insert into public.lamination_rates (currency, type, rate_per_100sqin, is_dummy) values
  ('AED', 'matte',      1.30, true),
  ('AED', 'glossy',     1.15, true),
  ('AED', 'thermal',    2.85, true),
  ('AED', 'soft_touch', 4.30, true)
on conflict (currency, type) where owner_id is null do nothing;

insert into public.foiling_rates (currency, color, finish, rate_per_sqin, is_dummy) values
  ('AED', 'gold',   'glossy', 0.08, true),
  ('AED', 'gold',   'matte',  0.08, true),
  ('AED', 'silver', 'glossy', 0.08, true),
  ('AED', 'silver', 'matte',  0.08, true),
  ('AED', 'copper', 'glossy', 0.08, true),
  ('AED', 'copper', 'matte',  0.08, true),
  ('AED', 'others', 'glossy', 0.08, true),
  ('AED', 'others', 'matte',  0.08, true)
on conflict (currency, color, finish) where owner_id is null do nothing;

insert into public.uv_coating_rates (currency, type, rate, unit, is_dummy) values
  ('AED', 'full_uv',  0.70, 'per_100sqin', true),
  ('AED', 'spot',     0.08, 'per_sqin',    true),
  ('AED', 'drip_off', 1.30, 'per_100sqin', true),
  ('AED', 'aquas',    0.60, 'per_100sqin', true)
on conflict (currency, type) where owner_id is null do nothing;

insert into public.relief_rates (currency, type, rate_per_sqin, is_dummy) values
  ('AED', 'embossing', 0.80, true),
  ('AED', 'debossing', 0.80, true)
on conflict (currency, type) where owner_id is null do nothing;

insert into public.magnet_rates (currency, diameter_mm, thickness_mm, price_each, is_dummy) values
  ('AED', 10, 1.5, 0.60, true),
  ('AED', 10, 2.0, 0.75, true),
  ('AED', 15, 1.5, 1.00, true),
  ('AED', 15, 2.0, 1.25, true)
on conflict (currency, diameter_mm, thickness_mm) where owner_id is null do nothing;

insert into public.washer_rates (currency, name, price_each, is_dummy) values
  ('AED', '10mm', 0.20, true),
  ('AED', '15mm', 0.30, true)
on conflict (currency, name) where owner_id is null do nothing;

insert into public.foam_rates (currency, type, thickness_mm, sheet_width_in, sheet_height_in, cost_per_sheet, rate_per_mm, is_dummy) values
  ('AED', 'XLPE', 5,  40, 80, 21.50, 3.60, true),
  ('AED', 'XLPE', 10, 40, 80, 36.00, 3.60, true),
  ('AED', 'EPE',  5,  40, 80, 16.80, 2.65, true),
  ('AED', 'EPE',  10, 40, 80, 26.50, 2.65, true),
  ('AED', 'PU',   10, 40, 80, 43.00, 3.85, true),
  ('AED', 'PU',   20, 40, 80, 77.00, 3.85, true)
on conflict (currency, type, thickness_mm) where owner_id is null do nothing;

insert into public.reverse_board_rates (currency, size_label, thickness_mm, cost_per_sheet, is_dummy) values
  ('AED', '31x41', 1.2, 1.55, true),
  ('AED', '31x41', 1.5, 1.95, true),
  ('AED', '31x41', 1.8, 2.35, true),
  ('AED', '31x41', 2.0, 2.60, true),
  ('AED', '31x41', 2.5, 3.25, true),
  ('AED', '31x41', 3.0, 3.90, true)
on conflict (currency, size_label, thickness_mm) where owner_id is null do nothing;

insert into public.consumable_rates (currency, name, rate, unit, is_dummy) values
  ('AED', 'tape', 0.40, 'per_tray_or_lid', true)
on conflict (currency, name) where owner_id is null do nothing;

insert into public.labour_rates (currency, name, rate_per_month, rate_per_day, rate_per_hour, is_dummy) values
  ('AED', 'Designer',  7000, 280, 35, true),
  ('AED', 'Cutting',   4000, 160, 20, true),
  ('AED', 'Grooving',  3600, 144, 18, true),
  ('AED', 'Punching',  4200, 168, 21, true),
  ('AED', 'Floorwork', 2400, 96,  12, true),
  ('AED', 'Universal', 5000, 200, 25, true)
on conflict (currency, name) where owner_id is null do nothing;

insert into public.ribbon_tag_rates (currency, size_label, price_each, is_dummy) values
  ('AED', '10mm', 0.75, true)
on conflict (currency, size_label) where owner_id is null do nothing;

insert into public.handle_rates (currency, type, price_each, is_dummy) values
  ('AED', 'Metal bar',     6.50,  true),
  ('AED', 'Rope',          3.00,  true),
  ('AED', 'Leather strap', 12.50, true)
on conflict (currency, type) where owner_id is null do nothing;

insert into public.lock_rates (currency, type, price_each, is_dummy) values
  ('AED', 'Magnetic clasp', 3.00, true),
  ('AED', 'Metal hook',     2.30, true),
  ('AED', 'Push lock',      5.30, true)
on conflict (currency, type) where owner_id is null do nothing;

insert into public.window_rates (currency, name, film_width_in, film_height_in, cost_per_sheet, is_dummy) values
  ('AED', 'PVC film', 40, 50, 3.30, true),
  ('AED', 'PET film', 40, 50, 4.60, true)
on conflict (currency, name) where owner_id is null do nothing;

insert into public.misc_rates (currency, name, unit, price, is_dummy) values
  ('AED', 'Satin cloth',  'per metre', 5.00,  true),
  ('AED', 'Velvet',       'per metre', 10.00, true),
  ('AED', 'Cloth buckle', 'each',      1.00,  true)
on conflict (currency, name) where owner_id is null do nothing;
