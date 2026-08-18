-- Rigid Box Estimator — Seed Data
-- Run AFTER schema.sql, in the Supabase dashboard SQL editor. Idempotent
-- (on conflict do nothing) so re-running never overwrites rates you've edited.
--
-- EVERY rate row seeded here is a SHARED master row (owner_id null) — the card
-- admin and staff use, and the one a new trial account's private clone is
-- copied from. Each `on conflict` therefore restates `where owner_id is null`:
-- schema.sql's v7 block replaced the plain unique keys with PARTIAL indexes,
-- and Postgres only matches a partial index when the statement repeats its
-- predicate. Dropping that clause makes the insert fail outright, so keep it
-- on any new rate-table insert added below.
--
-- v8 (multi-currency) added `currency` as the FIRST column of every shared
-- partial index, so each target below also leads with `currency`. These rows
-- omit the column and take its 'INR' default: this file seeds the INR market
-- only. USD/GBP/AED template sets live in seed-currency-templates.sql, run
-- after this one. app_config and margin_config are currency-agnostic
-- (percentages and formula constants) and keep their original targets.
--
-- EVERY rate below is an INVENTED PLACEHOLDER. None of it is real commercial
-- pricing. The numbers are internally consistent and plausible so the engine
-- produces sensible output out of the box, but all of them should be replaced
-- with your own via the Admin rate screen (no code changes needed).
--
-- is_dummy = true -> placeholder; the rate card badges these, so you can see at
--                    a glance what still needs a real number.
-- Structure matters more than values: every rate field must exist as a row, so
-- edit numbers in place rather than deleting rows.

-- ---------------------------------------------------------------------------
-- Kappa board — PLACEHOLDER. Board is priced per mm of thickness, so
-- cost_per_sheet = thickness x rate_per_mm (here 20/mm, on a 31x41 sheet).
-- ---------------------------------------------------------------------------
insert into public.board_rates (size_label, thickness_mm, cost_per_sheet, is_dummy) values
  ('31x41', 1.2, 24.00, true),
  ('31x41', 1.5, 30.00, true),
  ('31x41', 1.8, 36.00, true),
  ('31x41', 2.0, 40.00, true),
  ('31x41', 2.5, 50.00, true),
  ('31x41', 3.0, 60.00, true)
on conflict (currency, size_label, thickness_mm) where owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Printed paper stock — DUMMY (sizes 23x36, 25x36, 30x40 at 120/130/157/170 GSM)
-- ---------------------------------------------------------------------------
insert into public.paper_rates (size_label, width_in, height_in, gsm, cost_per_sheet, is_dummy) values
  ('23x36', 23, 36, 120, 8,  true),
  ('23x36', 23, 36, 130, 9,  true),
  ('23x36', 23, 36, 157, 11, true),
  ('23x36', 23, 36, 170, 12, true),
  ('25x36', 25, 36, 120, 9,  true),
  ('25x36', 25, 36, 130, 10, true),
  ('25x36', 25, 36, 157, 12, true),
  ('25x36', 25, 36, 170, 13, true),
  ('30x40', 30, 40, 120, 12, true),
  ('30x40', 30, 40, 130, 13, true),
  ('30x40', 30, 40, 157, 16, true),
  ('30x40', 30, 40, 170, 17, true)
on conflict (currency, size_label, gsm) where owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- White lining stock — DUMMY (client 2026-07: plain inner lining priced
-- separately from printed paper; same size/GSM grid so legacy plain inners map
-- cleanly). Replace with real rates via the Admin rate screen.
-- ---------------------------------------------------------------------------
insert into public.white_paper_rates (size_label, width_in, height_in, gsm, cost_per_sheet, is_dummy) values
  ('23x36', 23, 36, 120, 6,  true), -- DUMMY — replace with real rate
  ('23x36', 23, 36, 130, 7,  true), -- DUMMY — replace with real rate
  ('23x36', 23, 36, 157, 9,  true), -- DUMMY — replace with real rate
  ('23x36', 23, 36, 170, 10, true), -- DUMMY — replace with real rate
  ('25x36', 25, 36, 120, 7,  true), -- DUMMY — replace with real rate
  ('25x36', 25, 36, 130, 8,  true), -- DUMMY — replace with real rate
  ('25x36', 25, 36, 157, 10, true), -- DUMMY — replace with real rate
  ('25x36', 25, 36, 170, 11, true), -- DUMMY — replace with real rate
  ('30x40', 30, 40, 120, 10, true), -- DUMMY — replace with real rate
  ('30x40', 30, 40, 130, 11, true), -- DUMMY — replace with real rate
  ('30x40', 30, 40, 157, 13, true), -- DUMMY — replace with real rate
  ('30x40', 30, 40, 170, 14, true)  -- DUMMY — replace with real rate
on conflict (currency, size_label, gsm) where owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Board stock ("Board" rate section) — DUMMY (client 2-Jul: foam-cover material
-- option; heavier than art paper so priced a little above paper_rates
-- placeholders). `type` (client 18-Jul) distinguishes board types; art card is
-- the only one seeded — add duplex / grey board / … from the rate card.
-- ---------------------------------------------------------------------------
insert into public.art_card_rates (type, size_label, width_in, height_in, gsm, cost_per_sheet, is_dummy) values
  ('Art card', '23x36', 23, 36, 120, 10, true), -- DUMMY — replace with real rate
  ('Art card', '23x36', 23, 36, 130, 11, true), -- DUMMY — replace with real rate
  ('Art card', '23x36', 23, 36, 157, 13, true), -- DUMMY — replace with real rate
  ('Art card', '23x36', 23, 36, 170, 14, true), -- DUMMY — replace with real rate
  ('Art card', '25x36', 25, 36, 120, 11, true), -- DUMMY — replace with real rate
  ('Art card', '25x36', 25, 36, 130, 12, true), -- DUMMY — replace with real rate
  ('Art card', '25x36', 25, 36, 157, 14, true), -- DUMMY — replace with real rate
  ('Art card', '25x36', 25, 36, 170, 15, true), -- DUMMY — replace with real rate
  ('Art card', '30x40', 30, 40, 120, 14, true), -- DUMMY — replace with real rate
  ('Art card', '30x40', 30, 40, 130, 15, true), -- DUMMY — replace with real rate
  ('Art card', '30x40', 30, 40, 157, 18, true), -- DUMMY — replace with real rate
  ('Art card', '30x40', 30, 40, 170, 19, true)  -- DUMMY — replace with real rate
on conflict (currency, type, size_label, gsm) where owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Special paper — DUMMY (examples; client to provide real catalogue)
-- ---------------------------------------------------------------------------
insert into public.special_paper_rates (name, size_label, width_in, height_in, gsm, cost_per_sheet, is_dummy) values
  ('Keycolor Black',    '23x36', 23, 36, 120, 25, true),
  ('Wibalin Natural',   '25x36', 25, 36, 115, 30, true)
on conflict (currency, name, size_label) where owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Offset printing — PLACEHOLDER (price for the first 1000 sheets / per
-- additional 1000), tiered by sheet size. Single-colour currently mirrors
-- multicolour; split them once you have real per-colour pricing.
-- ---------------------------------------------------------------------------
insert into public.offset_printing_rates (size_label, colour, width_in, height_in, first_1000, additional_1000, is_dummy) values
  ('18x25', 'multi',  18, 25, 3000, 900,  true),
  ('20x30', 'multi',  20, 30, 3800, 1100, true),
  ('22x25', 'multi',  22, 25, 3800, 1100, true),
  ('20x28', 'multi',  20, 28, 3800, 1100, true),
  ('25x36', 'multi',  25, 36, 5400, 1300, true),
  ('23x36', 'multi',  23, 36, 5400, 1300, true),
  ('28x40', 'multi',  28, 40, 7000, 1600, true),
  -- Single-colour — mirrors multicolour until real per-colour pricing exists.
  ('18x25', 'single', 18, 25, 3000, 900,  true),
  ('20x30', 'single', 20, 30, 3800, 1100, true),
  ('22x25', 'single', 22, 25, 3800, 1100, true),
  ('20x28', 'single', 20, 28, 3800, 1100, true),
  ('25x36', 'single', 25, 36, 5400, 1300, true),
  ('23x36', 'single', 23, 36, 5400, 1300, true),
  ('28x40', 'single', 28, 40, 7000, 1600, true)
-- Round 10: the unique key is (size_label, colour, vendor) and these seed rows
-- carry no vendor, so the inference target is the PARTIAL index over the
-- un-named rows (the predicate must be restated for Postgres to match it).
on conflict (currency, size_label, colour) where vendor is null and owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Digital printing — PLACEHOLDER (flat rate per sheet). Both-sides 13x23 is a
-- separate selectable row (the schema has no per-side column).
-- ---------------------------------------------------------------------------
insert into public.digital_printing_rates (size_label, width_in, height_in, cost_per_sheet, is_dummy) values
  ('13x19', 13, 19, 22, true),
  ('13x23', 13, 23, 22, true),
  ('13x23 (both sides)', 13, 23, 28, true),
  ('13x30', 13, 30, 33, true)
-- Round 10: see the offset note above — partial index over un-named rows.
on conflict (currency, size_label) where vendor is null and owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Relief printing (embossing / debossing) — PLACEHOLDER (rate x sq inch)
-- ---------------------------------------------------------------------------
insert into public.relief_rates (type, rate_per_sqin, is_dummy) values
  ('embossing', 0.60, true),
  ('debossing', 0.60, true)
on conflict (currency, type) where owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Ribbon tag — DUMMY (10mm standard; custom size = custom price on the form)
-- ---------------------------------------------------------------------------
insert into public.ribbon_tag_rates (size_label, price_each, is_dummy) values
  ('10mm', 1.50, true)
on conflict (currency, size_label) where owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Lamination — PLACEHOLDER (rate per 100 sq inch)
-- ---------------------------------------------------------------------------
insert into public.lamination_rates (type, rate_per_100sqin, is_dummy) values
  ('matte',      1.00, true),
  ('glossy',     0.90, true),
  ('thermal',    2.20, true),
  ('soft_touch', 3.30, true)
on conflict (currency, type) where owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Foiling — PLACEHOLDER (rate x area in sq inch; same across colours)
-- ---------------------------------------------------------------------------
-- finish (round 3): matte/glossy rows per colour — prices identical for now.
insert into public.foiling_rates (color, finish, rate_per_sqin, is_dummy) values
  ('gold',   'glossy', 0.06, true),
  ('gold',   'matte',  0.06, true),
  ('silver', 'glossy', 0.06, true),
  ('silver', 'matte',  0.06, true),
  ('copper', 'glossy', 0.06, true),
  ('copper', 'matte',  0.06, true),
  ('others', 'glossy', 0.06, true),
  ('others', 'matte',  0.06, true)
on conflict (currency, color, finish) where owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- UV coating — PLACEHOLDER
-- ---------------------------------------------------------------------------
insert into public.uv_coating_rates (type, rate, unit, is_dummy) values
  ('full_uv',  0.55, 'per_100sqin', true),
  ('spot',     0.06, 'per_sqin',    true),
  ('drip_off', 1.00, 'per_100sqin', true),
  ('aquas',    0.45, 'per_100sqin', true)
on conflict (currency, type) where owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Magnets — DUMMY (diameter 10/15 mm x thickness 1.5/2 mm)
-- ---------------------------------------------------------------------------
insert into public.magnet_rates (diameter_mm, thickness_mm, price_each, is_dummy) values
  (10, 1.5, 1.20, true),
  (10, 2.0, 1.50, true),
  (15, 1.5, 2.00, true),
  (15, 2.0, 2.50, true)
on conflict (currency, diameter_mm, thickness_mm) where owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Washers — DUMMY
-- ---------------------------------------------------------------------------
insert into public.washer_rates (name, price_each, is_dummy) values
  ('10mm', 0.40, true),
  ('15mm', 0.60, true)
on conflict (currency, name) where owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Foam inserts — DUMMY (sheet size also placeholder).
-- rate_per_mm (foam is priced per mm of thickness, like board):
-- when set (> 0) sheet price = rate_per_mm x thickness; cost_per_sheet is the
-- flat fallback kept for rows without a per-mm rate.
-- ---------------------------------------------------------------------------
insert into public.foam_rates (type, thickness_mm, sheet_width_in, sheet_height_in, cost_per_sheet, rate_per_mm, is_dummy) values
  ('XLPE', 5,  40, 80, 90,  15, true), -- DUMMY — replace with real rate
  ('XLPE', 10, 40, 80, 150, 15, true), -- DUMMY — replace with real rate
  ('EPE',  5,  40, 80, 70,  11, true), -- DUMMY — replace with real rate
  ('EPE',  10, 40, 80, 110, 11, true), -- DUMMY — replace with real rate
  ('PU',   10, 40, 80, 180, 16, true), -- DUMMY — replace with real rate
  ('PU',   20, 40, 80, 320, 16, true)  -- DUMMY — replace with real rate
on conflict (currency, type, thickness_mm) where owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Reverse-board insert stock — PLACEHOLDER. Reverse board IS kappa board, so
-- it carries the same per-mm rate as board_rates above.
-- ---------------------------------------------------------------------------
insert into public.reverse_board_rates (size_label, thickness_mm, cost_per_sheet, is_dummy) values
  ('31x41', 1.2, 24.00, true),
  ('31x41', 1.5, 30.00, true),
  ('31x41', 1.8, 36.00, true),
  ('31x41', 2.0, 40.00, true),
  ('31x41', 2.5, 50.00, true),
  ('31x41', 3.0, 60.00, true)
on conflict (currency, size_label, thickness_mm) where owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Fixed consumables — tape PLACEHOLDER (charged per tray/lid). Glue + metlock
-- are NOT rate rows: they are manual open-input costs entered per estimate.
-- ---------------------------------------------------------------------------
insert into public.consumable_rates (name, rate, unit, is_dummy) values
  ('tape', 0.80, 'per_tray_or_lid', true)
on conflict (currency, name) where owner_id is null do update
  set rate = excluded.rate, unit = excluded.unit, is_dummy = excluded.is_dummy;

-- ---------------------------------------------------------------------------
-- Labour — PLACEHOLDER roles (per month / day / hour). per_day = month/25 and
-- per_hour = day/8 is a convention, not a code rule: all three columns are
-- stored independently. Role names are free text with no CHECK constraint, so
-- rename, add or remove them from the rate card without touching code.
-- ---------------------------------------------------------------------------
delete from public.labour_rates where name = 'standard_day';
insert into public.labour_rates (name, rate_per_month, rate_per_day, rate_per_hour, is_dummy) values
  ('Designer',   24000,   960,     120,    true),
  ('Cutting',    36000,   1440,    180,    true),
  ('Grooving',   30000,   1200,    150,    true),
  ('Punching',   42000,   1680,    210,    true),
  ('Floorwork',  200000,  8000,    1000,   true),
  ('Universal',  90000,   3600,    450,    true)
on conflict (currency, name) where owner_id is null do update
  set rate_per_month = excluded.rate_per_month,
      rate_per_day   = excluded.rate_per_day,
      rate_per_hour  = excluded.rate_per_hour,
      is_dummy       = excluded.is_dummy;

-- ---------------------------------------------------------------------------
-- Handles / Locks — DUMMY (manual customisations, priced by type).
-- Doc 2026-06-19: client to send real prices + reference photos (image_path).
-- ---------------------------------------------------------------------------
insert into public.handle_rates (type, price_each, is_dummy) values
  ('Metal bar',     12, true),
  ('Rope',          6,  true),
  ('Leather strap', 18, true)
on conflict (currency, type) where owner_id is null do nothing;

insert into public.lock_rates (type, price_each, is_dummy) values
  ('Magnetic clasp', 9,  true),
  ('Metal hook',     7,  true),
  ('Push lock',      15, true)
on conflict (currency, type) where owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Window film — DUMMY (nested on a film sheet like foam; sheet size placeholder).
-- ---------------------------------------------------------------------------
insert into public.window_rates (name, film_width_in, film_height_in, cost_per_sheet, is_dummy) values
  ('PVC film', 40, 50, 60, true),
  ('PET film', 40, 50, 85, true)
on conflict (currency, name) where owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Miscellaneous materials (round 3) — DUMMY. Ad-hoc materials the factory buys
-- as needed (client 4/8-Jul: satin, velvet, cloth buckles, …). Admin can add
-- more rows (with photos) from the rate card.
-- ---------------------------------------------------------------------------
insert into public.misc_rates (name, unit, price, is_dummy) values
  ('Satin cloth',  'per metre', 40, true), -- DUMMY — replace with real rate
  ('Velvet',       'per metre', 80, true), -- DUMMY — replace with real rate
  ('Cloth buckle', 'each',       6, true)  -- DUMMY — replace with real rate
on conflict (currency, name) where owner_id is null do nothing;

-- ---------------------------------------------------------------------------
-- App config — process defaults, not pricing. Folding allowance, lid depth,
-- MOQ and the wastage tiers are engine conventions; overhead_pct is commercial,
-- so replace it with your own.
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value, unit, description, is_dummy) values
  ('folding_allowance_mm',     20,  'mm',  'Outer wrap paper: added each side of board keyline', false),
  ('inner_lining_reduction_mm',0,   'mm',  'Inner lining paper: reduction each side (v2: 0 = keyline exactly)', false),
  ('lid_depth_default_in',     1.5, 'in',  'Default lid depth when not specified by customer', false),
  ('moq',                      500, 'box', 'Minimum order quantity for all box types', false),
  ('overhead_pct',             15,  '%',   'Overhead applied on level 1 (material + labour)', false),
  ('print_wastage_pct',        10,  '%',   'Extra printed sheets: printing only (setup/spoilage)', false),
  ('print_foil_wastage_pct',   15,  '%',   'Extra printed sheets: printing + foiling/UV', false)
-- app_config keeps a plain `key` primary key — it is global formula config
-- with no owner_id column, unlike every rate table below/above.
on conflict (key) do update
  set value = excluded.value, unit = excluded.unit,
      description = excluded.description, is_dummy = excluded.is_dummy;

-- ---------------------------------------------------------------------------
-- Margin — PLACEHOLDER (admin-only via RLS). Set your own before quoting.
-- ---------------------------------------------------------------------------
-- The conflict target is the PARTIAL index over the shared master row
-- (margin_config gained owner_id + an id primary key with the trial role), so
-- the predicate has to be restated for Postgres to match it — same reason as
-- the rate tables above.
insert into public.margin_config (key, value, description, is_dummy) values
  ('default_margin_pct', 25, 'Default profit margin applied last (editable)', true)
on conflict (key) where owner_id is null do update
  set value = excluded.value, description = excluded.description,
      is_dummy = excluded.is_dummy;
