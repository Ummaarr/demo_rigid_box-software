// Populates a FRESH demo Supabase project with fabricated business data:
// staff accounts, clients, estimates, quotes, supplier names and rate
// attribution. Everything the real deployment holds, none of it real.
//
// Estimates are GENERATED, not hand-written: each one runs the real
// buildEstimate() against the demo project's own rates, so specs_snapshot /
// rates_snapshot / cost_breakdown are genuine engine output and every
// downstream screen (detail page, section-wise cost view, materials PDF, quote
// PDF) works exactly as it does in production.
//
// Prerequisites: the demo project has had supabase/schema.sql then
// supabase/seed.sql applied, and .env.demo.local holds its three keys.
//
// Run:  npm run seed:demo
//       npm run seed:demo -- --force      (re-seed a project that has data)
//
// SAFETY: this script writes a lot and deletes nothing. It refuses to run
// against the live project — see assertNotLiveProject() below.

import { readFileSync, existsSync } from "node:fs";

import type { SupabaseClient } from "@supabase/supabase-js";

import { BRAND } from "@/lib/brand";
import { createAdminClient } from "@/lib/db/admin";
import { buildEstimate } from "@/lib/estimate/build-estimate";
import {
  assignQuoteNo,
  saveQuote,
} from "@/lib/pdf/generate-quote";
import { buildQuotationData } from "@/lib/pdf/quotation-data";
import type { EstimateRequest } from "@/types";

const DEMO_ENV = ".env.demo.local";
const LIVE_ENV = ".env.local";
const FORCE = process.argv.includes("--force");
const RESET = process.argv.includes("--reset");

/**
 * This script fabricates fake clients, estimates and quotes. Running it against
 * a real customer's instance would pollute their data with invented records —
 * and the damage is not fully reversible, because the quote prefix is PERSISTED
 * into quotes.quote_no (unlike the rest of the letterhead, which is re-attached
 * at render time), so a later rebrand cannot rewrite numbers already issued.
 *
 * `isDemo` is the gate. It is true for the placeholder Northpack identity that
 * ships here; set it false in lib/brand.ts the moment you rebrand for a real
 * company, and this refuses to run.
 */
function assertDemoBrand() {
  if (BRAND.isDemo) return;
  fail(
    `REFUSING TO SEED: lib/brand.ts is a real identity (${BRAND.name}, prefix "${BRAND.quotePrefix}").\n\n` +
      `This script writes fabricated clients, estimates and quotes. Quote numbers\n` +
      `persist as "${BRAND.quotePrefix}/26-27/001" and cannot be rewritten later.\n\n` +
      `If this really is a throwaway demo instance, set isDemo: true in lib/brand.ts.`,
  );
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Project ref from a Supabase URL: https://abcd.supabase.co -> "abcd". */
const projectRef = (url: string) =>
  url.replace(/^https?:\/\//, "").split(".")[0] ?? url;

function loadDemoEnv(): string {
  if (!existsSync(DEMO_ENV)) {
    fail(
      `${DEMO_ENV} not found.\n\n` +
        `Create it with the DEMO project's keys (never the live ones):\n` +
        `  NEXT_PUBLIC_SUPABASE_URL=https://<demo-ref>.supabase.co\n` +
        `  NEXT_PUBLIC_SUPABASE_ANON_KEY=...\n` +
        `  SUPABASE_SERVICE_ROLE_KEY=...`,
    );
  }
  const demo = parseEnvFile(DEMO_ENV);
  const url = demo.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !demo.SUPABASE_SERVICE_ROLE_KEY) {
    fail(`${DEMO_ENV} must set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`);
  }

  // The one thing that must never happen: seeding fake data into the client's
  // real project. Compare against .env.local if it is present.
  if (existsSync(LIVE_ENV)) {
    const live = parseEnvFile(LIVE_ENV);
    const liveUrl = live.NEXT_PUBLIC_SUPABASE_URL;
    if (liveUrl && projectRef(liveUrl) === projectRef(url)) {
      fail(
        `REFUSING TO RUN: ${DEMO_ENV} points at the same Supabase project as ${LIVE_ENV} ` +
          `(${projectRef(url)}). The demo needs its OWN project.`,
      );
    }
    if (live.SUPABASE_SERVICE_ROLE_KEY === demo.SUPABASE_SERVICE_ROLE_KEY) {
      fail(`REFUSING TO RUN: ${DEMO_ENV} reuses the live service-role key.`);
    }
  }

  // Force the admin client onto the demo project regardless of ambient env.
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = demo.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  process.env.SUPABASE_SERVICE_ROLE_KEY = demo.SUPABASE_SERVICE_ROLE_KEY;
  return url;
}

/**
 * --reset: clear the fabricated business data so the project can be re-seeded.
 * Rate rows and staff accounts are left alone (the rate card keeps its vendors;
 * seedStaff reuses existing auth users). Only ever reachable after
 * loadDemoEnv() has proved this is not the live project.
 */
async function resetBusinessData(db: SupabaseClient) {
  // Deleted in FK order. Each needs a filter (PostgREST refuses an unfiltered
  // delete); the PK column is never null, so this matches every row.
  const wipes: [table: string, pk: string][] = [
    ["quotes", "id"],
    ["rate_change_requests", "id"],
    ["estimates", "id"],
    ["clients", "id"],
    ["quote_counters", "fy_label"],
  ];
  for (const [table, pk] of wipes) {
    const { error } = await db.from(table).delete().not(pk, "is", null);
    console.log(`  ${error ? `FAIL ${table}: ${error.message}` : `cleared ${table}`}`);
  }
}

/** Refuse to pile demo data on top of existing rows unless --force. */
async function assertEmpty(db: SupabaseClient) {
  for (const table of ["estimates", "clients", "quotes"]) {
    const { count, error } = await db.from(table).select("id", { count: "exact", head: true });
    if (error) {
      fail(
        `Could not read "${table}" (${error.message}).\n` +
          `Has supabase/schema.sql been applied to this project?`,
      );
    }
    if ((count ?? 0) > 0 && !FORCE) {
      fail(
        `"${table}" already has ${count} row(s). This project is not empty.\n` +
          `Re-run with --force only if you are certain it is the demo project.`,
      );
    }
  }
}

function fail(msg: string): never {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Fabricated identities
// ---------------------------------------------------------------------------

const DEMO_PASSWORD = "demo-northpack-2026";

const STAFF = [
  { email: "admin@northpack.example", fullName: "Priya Nair", role: "admin" as const },
  { email: "rahul@northpack.example", fullName: "Rahul Menon", role: "staff" as const },
  { email: "sana@northpack.example", fullName: "Sana Fernandes", role: "staff" as const },
];

const CLIENTS = [
  {
    name: "Verdanta Tea Company",
    type: "customer",
    contact_person: "Meera Iyer",
    phone: "+91 98450 10001",
    email: "orders@verdanta.example",
    address: "12 Residency Road, Bengaluru 560025",
  },
  {
    name: "Aurelia Fine Jewellery",
    type: "customer",
    contact_person: "Devika Shah",
    phone: "+91 98450 10002",
    email: "purchase@aurelia.example",
    address: "8 Commercial Street, Bengaluru 560001",
  },
  {
    name: "Kimaya Skincare Labs",
    type: "customer",
    contact_person: "Arjun Rao",
    phone: "+91 98450 10003",
    email: "supply@kimaya.example",
    address: "44 Industrial Estate, Hyderabad 500032",
  },
  {
    name: "Fable Confectionery",
    type: "lead",
    contact_person: "Nikhil Bose",
    phone: "+91 98450 10004",
    email: "hello@fable.example",
    address: "3 Park Street, Kolkata 700016",
  },
  {
    name: "Harbourline Spirits",
    type: "lead",
    contact_person: "Rhea DSouza",
    phone: "+91 98450 10005",
    email: "procurement@harbourline.example",
    address: "27 Marine Drive, Mumbai 400020",
  },
];

// Invented suppliers, spread across the rate tables so the Vendor column and
// its filter dropdown have realistic content.
const VENDORS = [
  "Meridian Paper Mills",
  "Anchor Board Supply",
  "Crestline Print Solutions",
  "Balaji Packaging Traders",
  "Northstar Coatings",
  "Vector Foil & Films",
  "Pinnacle Magnet Works",
  "Sunrise Foam Industries",
  "Orbit Adhesives",
  "Kaveri Board Depot",
  "Delta Hardware Co.",
  "Silverline Speciality Papers",
  "Everest Consumables",
];

// ---------------------------------------------------------------------------
// Rate-card dressing: vendors, attribution, and de-identified real rates
// ---------------------------------------------------------------------------

const RATE_TABLES = [
  "board_rates", "paper_rates", "white_paper_rates", "art_card_rates",
  "special_paper_rates", "offset_printing_rates", "digital_printing_rates",
  "lamination_rates", "foiling_rates", "uv_coating_rates", "magnet_rates",
  "washer_rates", "foam_rates", "reverse_board_rates", "consumable_rates",
  "labour_rates", "ribbon_tag_rates", "relief_rates", "handle_rates",
  "lock_rates", "window_rates", "misc_rates",
];

/**
 * Price columns to jitter, per table. seed.sql ships the client's REAL
 * confirmed rates (is_dummy = false) — kappa board, offset tiers, lamination,
 * foiling, UV, relief, tape and the full labour salary structure. A public demo
 * should not publish their actual cost structure, so those rows get a
 * deterministic ±15% nudge. The DUMMY rows are already placeholders and are
 * left alone.
 *
 * Config tables (overhead 11%, margin 20%) are deliberately NOT jittered —
 * they are business rules rather than supplier pricing, and odd percentages
 * would just make the demo look broken.
 */
const JITTER: Record<string, string[]> = {
  board_rates: ["cost_per_sheet"],
  reverse_board_rates: ["cost_per_sheet"],
  offset_printing_rates: ["first_1000", "additional_1000"],
  digital_printing_rates: ["cost_per_sheet"],
  lamination_rates: ["rate_per_100sqin"],
  foiling_rates: ["rate_per_sqin"],
  uv_coating_rates: ["rate"],
  relief_rates: ["rate_per_sqin"],
  consumable_rates: ["rate"],
};

/** Deterministic 0..1 from a string, so re-seeding reproduces the same demo. */
function hashUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const jitterValue = (v: number, seed: string) =>
  Math.round(v * (0.85 + hashUnit(seed) * 0.3) * 100) / 100;

const pick = <T,>(arr: T[], seed: string): T => arr[Math.floor(hashUnit(seed) * arr.length) % arr.length];

async function dressRateCard(db: SupabaseClient) {
  let vendored = 0;
  let jittered = 0;

  for (const table of RATE_TABLES) {
    const { data, error } = await db.from(table).select("*");
    if (error) {
      console.log(`  - ${table}: skipped (${error.message})`);
      continue;
    }
    for (const row of data ?? []) {
      const seed = `${table}:${row.id}`;
      const patch: Record<string, unknown> = {
        vendor: pick(VENDORS, seed),
        updated_by: pick(STAFF, `${seed}:by`).fullName,
      };

      // De-identify the client's real commercial rates.
      if (row.is_dummy === false && JITTER[table]) {
        for (const col of JITTER[table]) {
          if (typeof row[col] === "number") {
            patch[col] = jitterValue(row[col], `${seed}:${col}`);
            jittered++;
          }
        }
      }

      const { error: upErr } = await db.from(table).update(patch).eq("id", row.id);
      if (upErr) {
        console.log(`  - ${table}#${row.id}: ${upErr.message}`);
      } else {
        vendored++;
      }
    }
  }

  // Labour is special: rate_per_day = month/25 and rate_per_hour = day/8. Jitter
  // the monthly figure then re-derive, so the demo card stays internally
  // consistent instead of showing three unrelated numbers.
  const { data: labour } = await db.from("labour_rates").select("id, name, rate_per_month, is_dummy");
  for (const row of labour ?? []) {
    if (row.is_dummy !== false || typeof row.rate_per_month !== "number") continue;
    const month = jitterValue(row.rate_per_month, `labour:${row.name}`);
    const day = Math.round((month / 25) * 100) / 100;
    await db
      .from("labour_rates")
      .update({ rate_per_month: month, rate_per_day: day, rate_per_hour: Math.round((day / 8) * 100) / 100 })
      .eq("id", row.id);
    jittered++;
  }

  console.log(`  ${vendored} rows given a vendor + updated-by, ${jittered} real rates de-identified`);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

async function seedStaff(db: SupabaseClient): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};

  const { data: existing } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const byEmail = new Map((existing?.users ?? []).map((u) => [u.email, u.id]));

  for (const s of STAFF) {
    let id = byEmail.get(s.email);
    if (!id) {
      const { data, error } = await db.auth.admin.createUser({
        email: s.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: s.fullName },
      });
      if (error || !data.user) {
        fail(`Could not create ${s.email}: ${error?.message ?? "no user returned"}`);
      }
      id = data.user.id;
    }
    const { error: pErr } = await db
      .from("profiles")
      .upsert({ id, role: s.role, full_name: s.fullName }, { onConflict: "id" });
    if (pErr) fail(`Could not write profile for ${s.email}: ${pErr.message}`);
    ids[s.email] = id;
    console.log(`  ${s.role.padEnd(5)} ${s.fullName} <${s.email}>`);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

/** Outer wrap with auto printing — the resolver only considers sizes that
 *  actually fit, so these fixtures can't fail on a "print doesn't fit" error. */
const autoOuter = (gsm: number, colour: "multi" | "single" = "multi") =>
  ({
    mode: "printed" as const,
    gsm,
    foldingAllowance_mm: 20,
    printing: { type: "offset" as const, auto: true, colour },
  });

const whiteInner = (gsm: number) =>
  ({ mode: "white" as const, paperSizeLabel: "23x36", gsm });

interface DemoEstimate {
  name: string;
  clientIdx: number;
  status: "draft" | "sent" | "accepted" | "revised";
  /** Days before "now" the estimate was created — spreads the dashboard chart. */
  daysAgo: number;
  req: EstimateRequest;
}

const ESTIMATES: DemoEstimate[] = [
  {
    name: "Verdanta — 12-tin gift caddy",
    clientIdx: 0, status: "accepted", daysAgo: 84,
    req: {
      boxType: "telescopic",
      dims: { length_in: 10, width_in: 8, height_in: 4 },
      vars: { lidDepth_in: 1.5 },
      quantity: 1000, boardThickness_mm: 1.5, nestingVersion: 2,
      wrapping: { outer: autoOuter(130), inner: whiteInner(120) },
      finishing: [{ kind: "lamination", key: "matte" }],
      labour: [{ role: "Cutting", unit: "day", quantity: 2 }],
      additionalMode: "separate",
    },
  },
  {
    name: "Aurelia — pendant presentation box",
    clientIdx: 1, status: "accepted", daysAgo: 76,
    req: {
      boxType: "magnetic",
      dims: { length_in: 6, width_in: 6, height_in: 2.5 },
      vars: { flapLength_in: 1.2, panels: 4 },
      quantity: 500, boardThickness_mm: 2, nestingVersion: 2,
      wrapping: { outer: autoOuter(157), inner: whiteInner(130) },
      finishing: [
        { kind: "lamination", key: "soft_touch" },
        { kind: "foiling", key: "gold", finish: "matte" },
      ],
      labour: [
        { role: "Cutting", unit: "day", quantity: 1 },
        { role: "Punching", unit: "hour", quantity: 6 },
      ],
      additionalMode: "separate",
    },
  },
  {
    name: "Kimaya — serum starter kit",
    clientIdx: 2, status: "sent", daysAgo: 61,
    req: {
      boxType: "shoulder",
      dims: { length_in: 7, width_in: 5, height_in: 3 },
      vars: { lidDepth_in: 1.5, neckHeight_in: 1, bottomHeight_in: 3 },
      quantity: 2000, boardThickness_mm: 1.5, nestingVersion: 2,
      wrapping: { outer: autoOuter(130), inner: whiteInner(120) },
      finishing: [{ kind: "lamination", key: "matte" }],
      inserts: {
        foams: [
          {
            type: "EPE", thickness_mm: 10,
            insert: { length_in: 6.5, width_in: 4.5 },
            punchingMargin_mm: 5,
          },
        ],
      },
      labour: [{ role: "Cutting", unit: "day", quantity: 3 }],
      additionalMode: "separate",
    },
  },
  {
    name: "Fable — truffle drawer box",
    clientIdx: 3, status: "sent", daysAgo: 54,
    req: {
      boxType: "drawer_sliding",
      dims: { length_in: 9, width_in: 6, height_in: 2 },
      vars: {},
      quantity: 1500, boardThickness_mm: 1.5, nestingVersion: 2,
      wrapping: { outer: autoOuter(130) },
      finishing: [{ kind: "lamination", key: "glossy" }],
      labour: [{ role: "Cutting", unit: "day", quantity: 2 }],
      additionalMode: "separate",
    },
  },
  {
    name: "Harbourline — single-bottle presenter",
    clientIdx: 4, status: "draft", daysAgo: 47,
    req: {
      // Height 8, not 13: a hinge-lid tray blank is (BH+L+BH) x (BH+W+BH), so
      // BH=13 gives a 30x30 blank that no seeded paper can wrap once the 20 mm
      // folding allowance is added (largest sheet is 30x40). 8 -> 20x20, which
      // fits 23x36 comfortably. A real rate-card limit, not an engine bug.
      boxType: "hinge_lid",
      dims: { length_in: 4, width_in: 4, height_in: 8 },
      vars: { lidDepth_in: 1.5, neckHeight_in: 1.2, bottomHeight_in: 8 },
      quantity: 750, boardThickness_mm: 2, nestingVersion: 2,
      wrapping: { outer: autoOuter(170), inner: whiteInner(130) },
      finishing: [
        { kind: "lamination", key: "matte" },
        { kind: "uv", key: "spot", designArea: { length_in: 3, width_in: 3 } },
      ],
      labour: [{ role: "Cutting", unit: "day", quantity: 2 }, { role: "Grooving", unit: "day", quantity: 1 }],
      additionalMode: "separate",
    },
  },
  {
    name: "Verdanta — sampler matchbox sleeve",
    clientIdx: 0, status: "accepted", daysAgo: 40,
    req: {
      boxType: "matchbox_sliding",
      dims: { length_in: 5, width_in: 3.5, height_in: 1.5 },
      vars: {},
      quantity: 3000, boardThickness_mm: 1.2, nestingVersion: 2,
      wrapping: { outer: autoOuter(120) },
      labour: [{ role: "Cutting", unit: "day", quantity: 2 }],
      additionalMode: "separate",
    },
  },
  {
    name: "Aurelia — bangle collapsible case",
    clientIdx: 1, status: "revised", daysAgo: 35,
    req: {
      boxType: "collapsible_rigid",
      dims: { length_in: 8, width_in: 8, height_in: 3 },
      vars: { flapLength_in: 1.2 },
      quantity: 600, boardThickness_mm: 2, nestingVersion: 2,
      wrapping: { outer: autoOuter(157), inner: whiteInner(130) },
      finishing: [{ kind: "lamination", key: "soft_touch" }],
      labour: [{ role: "Cutting", unit: "day", quantity: 2 }],
      additionalMode: "separate",
    },
  },
  {
    name: "Kimaya — two-tier double decker",
    clientIdx: 2, status: "sent", daysAgo: 29,
    req: {
      boxType: "double_decker",
      dims: { length_in: 10, width_in: 7, height_in: 6 },
      vars: { flapLength_in: 1.2, panels: 4, trayHeight1_in: 3, trayHeight2_in: 3 },
      quantity: 800, boardThickness_mm: 2, nestingVersion: 2,
      wrapping: { outer: autoOuter(157), inner: whiteInner(120) },
      finishing: [{ kind: "lamination", key: "matte" }],
      labour: [{ role: "Cutting", unit: "day", quantity: 3 }, { role: "Floorwork", unit: "hour", quantity: 4 }],
      additionalMode: "separate",
    },
  },
  {
    name: "Fable — bulk tray order",
    clientIdx: 3, status: "draft", daysAgo: 24,
    req: {
      boxType: "tray_only",
      dims: { length_in: 11, width_in: 8, height_in: 2 },
      vars: {},
      quantity: 5000, boardThickness_mm: 1.5, nestingVersion: 2,
      wrapping: { outer: autoOuter(120) },
      labour: [{ role: "Cutting", unit: "day", quantity: 4 }],
      additionalMode: "separate",
    },
  },
  {
    name: "Harbourline — magnetic gift set (5-panel)",
    clientIdx: 4, status: "sent", daysAgo: 20,
    req: {
      boxType: "magnetic",
      dims: { length_in: 12, width_in: 9, height_in: 4 },
      vars: { flapLength_in: 1.5, panels: 5, flapHeight_in: 1 },
      quantity: 1200, boardThickness_mm: 2.5, nestingVersion: 2,
      productionQuantity: 1260,
      wrapping: { outer: autoOuter(170), inner: whiteInner(130) },
      finishing: [
        { kind: "lamination", key: "matte" },
        { kind: "foiling", key: "silver", finish: "glossy", designArea: { length_in: 5, width_in: 2 } },
      ],
      labour: [{ role: "Cutting", unit: "day", quantity: 3 }, { role: "Punching", unit: "day", quantity: 1 }],
      additionalMode: "separate",
    },
  },
  {
    name: "Verdanta — retail shelf carton",
    clientIdx: 0, status: "draft", daysAgo: 15,
    req: {
      boxType: "telescopic",
      dims: { length_in: 6, width_in: 4, height_in: 6 },
      vars: { lidDepth_in: 2 },
      quantity: 2500, boardThickness_mm: 1.2, nestingVersion: 2,
      wrapping: { outer: autoOuter(120, "single") },
      labour: [{ role: "Cutting", unit: "day", quantity: 2 }],
      additionalMode: "separate",
    },
  },
  {
    name: "Aurelia — watch box with window",
    clientIdx: 1, status: "sent", daysAgo: 11,
    req: {
      boxType: "hinge_lid",
      dims: { length_in: 6, width_in: 6, height_in: 4 },
      vars: { lidDepth_in: 1.5, neckHeight_in: 1, bottomHeight_in: 4 },
      quantity: 400, boardThickness_mm: 2, nestingVersion: 2,
      wrapping: { outer: autoOuter(157), inner: whiteInner(130) },
      finishing: [{ kind: "lamination", key: "matte" }],
      labour: [{ role: "Cutting", unit: "day", quantity: 1 }],
      additionalMode: "separate",
    },
  },
  {
    name: "Kimaya — refill drawer (production run)",
    clientIdx: 2, status: "draft", daysAgo: 6,
    req: {
      boxType: "drawer_sliding",
      dims: { length_in: 7, width_in: 5, height_in: 2.5 },
      vars: {},
      quantity: 2000, productionQuantity: 2100,
      boardThickness_mm: 1.5, nestingVersion: 2,
      wrapping: { outer: autoOuter(130), inner: whiteInner(120) },
      finishing: [{ kind: "lamination", key: "glossy" }],
      labour: [{ role: "Cutting", unit: "day", quantity: 2 }],
      additionalMode: "separate",
    },
  },
  {
    name: "Fable — festive shoulder box",
    clientIdx: 3, status: "draft", daysAgo: 2,
    req: {
      boxType: "shoulder",
      dims: { length_in: 9, width_in: 9, height_in: 3.5 },
      vars: { lidDepth_in: 1.5, neckHeight_in: 1, bottomHeight_in: 3.5 },
      quantity: 1000, boardThickness_mm: 1.8, nestingVersion: 2,
      wrapping: { outer: autoOuter(157), inner: whiteInner(120) },
      finishing: [
        { kind: "lamination", key: "matte" },
        { kind: "relief", key: "embossing", designArea: { length_in: 4, width_in: 2 } },
      ],
      labour: [{ role: "Cutting", unit: "day", quantity: 2 }],
      additionalMode: "separate",
    },
  },
];

async function seedEstimates(
  db: SupabaseClient,
  clientIds: string[],
  staffIds: Record<string, string>,
): Promise<{ id: string; clientId: string; status: string }[]> {
  const authors = STAFF.map((s) => staffIds[s.email]);
  const saved: { id: string; clientId: string; status: string }[] = [];

  for (const [i, e] of ESTIMATES.entries()) {
    const clientId = clientIds[e.clientIdx];
    const createdAt = new Date(Date.now() - e.daysAgo * 86400_000).toISOString();
    const req: EstimateRequest = { ...e.req, name: e.name, clientId };

    let built;
    try {
      built = await buildEstimate(req, db);
    } catch (err) {
      console.log(`  SKIP  ${e.name} — ${(err as Error).message}`);
      continue;
    }

    const { data, error } = await db
      .from("estimates")
      .insert({
        client_id: clientId,
        name: e.name,
        box_type: built.specsSnapshot.boxType,
        status: e.status,
        quantity: built.specsSnapshot.quantity,
        specs_snapshot: built.specsSnapshot,
        rates_snapshot: built.ratesSnapshot,
        cost_breakdown: built.cost,
        price_per_box: built.cost.pricePerBox,
        total_price: built.cost.total,
        created_by: authors[i % authors.length],
        created_at: createdAt,
      })
      .select("id")
      .single();

    if (error || !data) {
      console.log(`  FAIL  ${e.name} — ${error?.message}`);
      continue;
    }
    saved.push({ id: data.id as string, clientId, status: e.status });
    console.log(
      `  ${e.name}  ₹${built.cost.pricePerBox.toFixed(2)}/box  (${e.status})`,
    );
  }
  return saved;
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

/**
 * Quote the estimates that were actually sent or accepted. Goes through the
 * real numbering + save path (assignQuoteNo -> saveQuote) but NOT issueQuote,
 * which would also render a PDF we don't need at seed time — the PDF is
 * re-rendered on demand from this stored snapshot anyway.
 */
async function seedQuotes(
  db: SupabaseClient,
  estimates: { id: string; clientId: string; status: string }[],
  staffIds: Record<string, string>,
) {
  const quotable = estimates.filter((e) => e.status === "sent" || e.status === "accepted");
  const admin = staffIds["admin@northpack.example"];
  let n = 0;

  for (const est of quotable.slice(0, 6)) {
    const data = await buildQuotationData(db, est.id, "Priya Nair");
    if (!data) {
      console.log(`  FAIL  no quotation data for ${est.id}`);
      continue;
    }
    const no = await assignQuoteNo(db);
    if (!no) fail("next_quote_no() unavailable — has supabase/schema.sql been applied?");
    data.quoteNo = no;

    const id = await saveQuote(db, data, {
      clientId: est.clientId,
      estimateIds: [est.id],
      createdBy: admin,
    });
    if (!id) {
      console.log(`  FAIL  could not save quote ${no}`);
      continue;
    }
    // Accepted estimates read as accepted quotes; the rest stay "sent".
    if (est.status === "accepted") {
      await db.from("quotes").update({ status: "accepted" }).eq("id", id);
    }
    console.log(`  ${no}  ₹${data.grandTotal.toFixed(2)}  (${est.status === "accepted" ? "accepted" : "sent"})`);
    n++;
  }

  // One revision so the -R1 numbering and the dashboard "revised" tile have
  // real content. Same estimate, so nextRevisionNo() logic is what produced it.
  const first = quotable[0];
  if (first) {
    const data = await buildQuotationData(db, first.id, "Priya Nair");
    const { data: prior } = await db
      .from("quotes")
      .select("quote_no")
      .contains("estimate_ids", [first.id])
      .order("created_at", { ascending: true });
    if (data && prior?.length) {
      data.quoteNo = `${prior[0].quote_no}-R${prior.length}`;
      const id = await saveQuote(db, data, {
        clientId: first.clientId,
        estimateIds: [first.id],
        createdBy: admin,
      });
      if (id) {
        console.log(`  ${data.quoteNo}  (revision)`);
        n++;
      }
    }
  }
  console.log(`  ${n} quotes issued`);
}

// ---------------------------------------------------------------------------
// Pending rate proposal (so the admin approval badge has content)
// ---------------------------------------------------------------------------

async function seedProposal(db: SupabaseClient, staffIds: Record<string, string>) {
  const { data: row } = await db
    .from("board_rates")
    .select("id, thickness_mm, cost_per_sheet")
    .order("thickness_mm", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!row) return;

  const proposed = Math.round(Number(row.cost_per_sheet) * 1.08 * 100) / 100;
  const { error } = await db.from("rate_change_requests").insert({
    table_name: "board_rates",
    row_id: String(row.id),
    row_label: `${row.thickness_mm} mm kappa board`,
    field: "cost_per_sheet",
    old_value: JSON.stringify(row.cost_per_sheet),
    new_value: JSON.stringify(proposed),
    proposed_by: staffIds["rahul@northpack.example"],
    proposed_by_name: "Rahul Menon",
    status: "pending",
  });
  console.log(error ? `  skipped (${error.message})` : `  1 pending proposal from Rahul Menon`);
}

// ---------------------------------------------------------------------------

async function main() {
  const url = loadDemoEnv();
  assertDemoBrand();
  const db = createAdminClient();

  console.log(`\nDemo seed target: ${projectRef(url)}  (${url})`);
  if (RESET) {
    console.log("\n== reset (clearing previous demo business data) ==");
    await resetBusinessData(db);
  }
  await assertEmpty(db);

  console.log("\n== staff ==");
  const staffIds = await seedStaff(db);

  console.log("\n== clients ==");
  const { data: clientRows, error: cErr } = await db
    .from("clients")
    .insert(
      CLIENTS.map((c) => ({ ...c, created_by: staffIds["admin@northpack.example"] })),
    )
    .select("id, name");
  if (cErr || !clientRows) fail(`Could not insert clients: ${cErr?.message}`);
  for (const c of clientRows) console.log(`  ${c.name}`);
  // insert() returns rows in input order, but sort defensively by our own list.
  const clientIds = CLIENTS.map(
    (c) => (clientRows.find((r) => r.name === c.name)?.id as string),
  );

  console.log("\n== rate card (vendors, attribution, de-identified rates) ==");
  await dressRateCard(db);

  console.log("\n== estimates ==");
  const estimates = await seedEstimates(db, clientIds, staffIds);

  console.log("\n== quotes ==");
  await seedQuotes(db, estimates, staffIds);

  console.log("\n== pending rate proposal ==");
  await seedProposal(db, staffIds);

  console.log(
    `\nDone: ${clientIds.length} clients, ${estimates.length} estimates.\n\n` +
      `Sign in at /login with any of:\n` +
      STAFF.map((s) => `  ${s.email}  /  ${DEMO_PASSWORD}   (${s.role})`).join("\n") +
      `\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
