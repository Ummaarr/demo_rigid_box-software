# Rigid Box Cost Estimator

A cost estimation platform for rigid box manufacturing. Enter box specs and it
produces raw-material quantities with nesting layouts, an itemised cost
breakdown, keyline diagrams, a cost-free raw-material sheet for the shop floor,
and a branded quotation PDF.

Internal tool: Admin and Staff log in; customers only ever receive the PDF.

## What it does

- **9 box types** — telescopic, magnetic (3/4/5 panel), shoulder, drawer sliding,
  match-box sliding, hinge lid, collapsible rigid, double decker, tray-only
- **Nesting** — guillotine combination nesting across components on a shared
  sheet, plus mixed-orientation packing, so board and paper counts reflect how
  the work is actually cut
- **Costing ladder** — raw materials → labour → overhead → margin → one-time
  charges, every rate loaded from the database and frozen into a snapshot per
  estimate
- **Quotations** — persistent, FY-numbered, revisable, editable before issue
- **Rate card** — 22 rate tables with an admin UI, vendor tracking, reference
  photos, and a staff propose / admin approve workflow

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in your Supabase project's 3 keys
npm run dev
```

Open http://localhost:3000.

### Database

Create a Supabase project, then in its SQL editor run, in order:

1. `supabase/schema.sql` — tables, RLS, functions, storage bucket
2. `supabase/seed.sql` — rate rows and config

Then create your first admin: add a user under Authentication → Users, copy their
UID, and run the `insert into public.profiles ...` statement at the end of
`schema.sql`. There is no public signup — admins provision users in-app at
`/staff`.

`schema.sql` is idempotent and complete; the `migration-*.sql` files are
historical deltas for upgrading an already-deployed database and are not needed
for a fresh install.

### Sample data

`npm run seed:demo` fabricates staff, clients, estimates and quotes into a fresh
project so every screen has something to show. Estimates are generated through
the real engine, so their snapshots and PDFs are genuine. It refuses to run
against a non-placeholder brand or a database that already has data.

## Rates are placeholders

Every rate in `seed.sql` is invented and flagged `is_dummy = true`, which the rate
card badges. None of it is real pricing — replace it all under `/rates` before
using the app in anger. No rate is ever hardcoded in application logic.

## Architecture

All Supabase access goes through Next.js API routes under `app/api/` — the
browser never talks to the database directly. Role enforcement lives in the API
routes and `lib/auth.ts`; RLS is defence-in-depth only.

```
app/api        backend logic — the only place Supabase is called
lib/engines    Engine 1 (materials + nesting), Engine 2 (cost)
lib/formulas   blank dimension formulas, one file per box type
lib/pdf        quotation + raw-material document builders
lib/brand.ts   company identity (name, letterhead, currency, logo)
components/keylines  SVG keyline components, one per box type
supabase       schema.sql + seed.sql — source of truth for the database
scripts        offline validators and the demo seeder
```

See `CLAUDE.md` for the full engineering reference: formulas, nesting algorithms,
the costing ladder, the box-type registration checklist, and known gaps.

## Verification

```bash
npx tsc --noEmit
npm run build
npx tsx scripts/validate-engines.ts        # and the other validate-*.ts
```

Some validators import server-only modules and need
`node --conditions=react-server --import tsx`; `validate-round6` renders a PDF and
must NOT have that condition. `CLAUDE.md` lists which is which.

## Rebranding

Identity lives in `lib/brand.ts`. Replace that file plus `public/brand/logo.png`,
`app/icon.png`, `app/apple-icon.png` and `app/favicon.ico`. The navy/gold theme
hexes are in `app/globals.css` and, separately, in the two PDF documents under
`components/pdf/`.
