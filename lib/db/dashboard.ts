import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@/types";
import { boxLabel } from "@/lib/box-types";

// Aggregates for the dashboard home. Read server-side with the admin client so
// we can resolve creator/client names (RLS would otherwise hide them). Revenue
// (money) is computed ONLY for admins — for staff the `revenue` field is omitted
// and every money figure stays 0 / absent so it never reaches their browser.

export interface RecentEstimate {
  id: string;
  boxType: string;
  quantity: number;
  pricePerBox: number | null;
  totalPrice: number | null;
  createdAt: string;
  clientName: string | null;
  createdByName: string | null;
  /** draft / sent / accepted / revised (round 3). Missing pre-migration. */
  status?: string | null;
}

export interface MonthPoint {
  key: string; // YYYY-MM
  label: string; // e.g. "Jan"
  count: number;
  value: number; // quoted total for the month — 0 for staff
}

export interface BoxTypePoint {
  boxType: string;
  label: string;
  count: number;
}

/**
 * Quote pipeline counts (client final doc item 14: track quotes awaiting the
 * client's approval, revised, sent and rejected). Absent when the quotes table
 * doesn't exist yet (pre-migration DB) — the dashboard then hides the block.
 */
export interface QuoteStats {
  /** Sent and still waiting on the client. */
  awaiting: number;
  sent: number;
  accepted: number;
  rejected: number;
  revised: number;
  total: number;
}

export interface DashboardStats {
  totalEstimates: number;
  estimatesThisMonth: number;
  estimatesLastMonth: number;
  estimatesMoMPct: number | null;
  monthly: MonthPoint[];
  byBoxType: BoxTypePoint[];
  recent: RecentEstimate[];
  quotes?: QuoteStats;
  revenue?: {
    total: number;
    thisMonth: number;
    lastMonth: number;
    momPct: number | null;
    avgPerBox: number | null;
  };
}

const MONTHS = 6; // size of the trend window

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

/**
 * `createdBy`: pass a user id to aggregate ONLY that user's own estimates and
 * quotes (trial accounts — see ownerScopeFor() in lib/auth.ts). Without it a
 * trial lead's dashboard would total up every other lead's work.
 * null/omitted = the whole company's figures, as admin and staff have always
 * seen.
 */
export async function loadDashboardStats(
  supabase: SupabaseClient,
  role: UserRole | null,
  createdBy: string | null = null,
): Promise<DashboardStats> {
  const isAdmin = role === "admin";
  const scope = <T,>(q: T): T =>
    createdBy == null
      ? q
      : (q as unknown as { eq: (c: string, v: string) => T }).eq("created_by", createdBy);

  const now = new Date();
  const thisMonthKey = monthKey(now);
  const lastMonthKey = monthKey(
    new Date(now.getFullYear(), now.getMonth() - 1, 1),
  );

  // Build the empty month buckets (oldest -> newest) for the trend window.
  const buckets: MonthPoint[] = [];
  for (let i = MONTHS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: monthKey(d),
      label: d.toLocaleString("en-US", { month: "short" }),
      count: 0,
      value: 0,
    });
  }
  const bucketByKey = new Map(buckets.map((b) => [b.key, b]));

  // One pass over all estimates for totals / trend / breakdown, plus a small
  // recent query (with names) for the table.
  const recentCols =
    "id, box_type, quantity, price_per_box, total_price, created_at, client_id, created_by";
  const [allRes, recentRes0, quotesRes] = await Promise.all([
    scope(supabase.from("estimates").select("box_type, total_price, created_at")),
    scope(
      supabase
        .from("estimates")
        .select(`${recentCols}, status`)
        .order("created_at", { ascending: false })
        .limit(8),
    ),
    // Quote pipeline (client item 14). Errors when the quotes table doesn't
    // exist yet (pre-migration DB) — the block is simply omitted then.
    scope(supabase.from("quotes").select("status, quote_no")),
  ]);

  // 42703 = no status column yet (DB pre-migration-round3.sql). Retry without it.
  let recentData = recentRes0.data as Record<string, unknown>[] | null;
  let recentErr = recentRes0.error;
  if (recentErr && recentErr.code === "42703") {
    const legacy = await scope(
      supabase
        .from("estimates")
        .select(recentCols)
        .order("created_at", { ascending: false })
        .limit(8),
    );
    recentData = legacy.data as Record<string, unknown>[] | null;
    recentErr = legacy.error;
  }

  if (allRes.error)
    throw new Error(`dashboard aggregate load failed: ${allRes.error.message}`);
  if (recentErr)
    throw new Error(`dashboard recent load failed: ${recentErr.message}`);

  const all = allRes.data ?? [];

  let totalEstimates = 0;
  let estimatesThisMonth = 0;
  let estimatesLastMonth = 0;
  let revenueTotal = 0;
  let revenueThisMonth = 0;
  let revenueLastMonth = 0;
  const boxCounts = new Map<string, number>();

  for (const r of all) {
    totalEstimates++;
    const k = monthKey(new Date(r.created_at));
    const value = Number(r.total_price) || 0;

    if (k === thisMonthKey) estimatesThisMonth++;
    if (k === lastMonthKey) estimatesLastMonth++;

    const bucket = bucketByKey.get(k);
    if (bucket) {
      bucket.count++;
      if (isAdmin) bucket.value += value;
    }

    boxCounts.set(r.box_type, (boxCounts.get(r.box_type) ?? 0) + 1);

    if (isAdmin) {
      revenueTotal += value;
      if (k === thisMonthKey) revenueThisMonth += value;
      if (k === lastMonthKey) revenueLastMonth += value;
    }
  }

  const byBoxType: BoxTypePoint[] = [...boxCounts.entries()]
    .map(([boxType, count]) => ({ boxType, label: boxLabel(boxType), count }))
    .sort((a, b) => b.count - a.count);

  // Resolve names for the recent rows.
  const rows = recentData ?? [];
  const creatorIds = [
    ...new Set(rows.map((r) => r.created_by).filter(Boolean)),
  ] as string[];
  const clientIds = [
    ...new Set(rows.map((r) => r.client_id).filter(Boolean)),
  ] as string[];

  const [profilesRes, clientsRes] = await Promise.all([
    creatorIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", creatorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[], error: null }),
    clientIds.length
      ? supabase.from("clients").select("id, name").in("id", clientIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);

  const nameById = new Map(
    (profilesRes.data ?? []).map((p) => [p.id, p.full_name]),
  );
  const clientById = new Map((clientsRes.data ?? []).map((c) => [c.id, c.name]));

  const recent: RecentEstimate[] = rows.map((r) => {
    const clientId = r.client_id as string | null;
    const createdBy = r.created_by as string | null;
    return {
      id: r.id as string,
      boxType: r.box_type as string,
      quantity: r.quantity as number,
      pricePerBox: r.price_per_box as number | null,
      totalPrice: r.total_price as number | null,
      createdAt: r.created_at as string,
      clientName: clientId ? clientById.get(clientId) ?? null : null,
      createdByName: createdBy ? nameById.get(createdBy) ?? null : null,
      status: r.status as string | null | undefined,
    };
  });

  const stats: DashboardStats = {
    totalEstimates,
    estimatesThisMonth,
    estimatesLastMonth,
    estimatesMoMPct: pctChange(estimatesThisMonth, estimatesLastMonth),
    monthly: buckets,
    byBoxType,
    recent,
  };

  // Quote pipeline (client item 14). A quote whose number carries an -R suffix
  // is a revision; "awaiting" is everything sent and not yet answered.
  if (!quotesRes.error) {
    const qRows = (quotesRes.data ?? []) as { status: string | null; quote_no: string | null }[];
    const count = (s: string) => qRows.filter((q) => q.status === s).length;
    stats.quotes = {
      awaiting: count("sent"),
      sent: count("sent"),
      accepted: count("accepted"),
      rejected: count("rejected"),
      revised: qRows.filter((q) => /-R\d+$/i.test(q.quote_no ?? "")).length,
      total: qRows.length,
    };
  }

  if (isAdmin) {
    stats.revenue = {
      total: revenueTotal,
      thisMonth: revenueThisMonth,
      lastMonth: revenueLastMonth,
      momPct: pctChange(revenueThisMonth, revenueLastMonth),
      avgPerBox: null, // not used yet; reserved
    };
  }

  return stats;
}
