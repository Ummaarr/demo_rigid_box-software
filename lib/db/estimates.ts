import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CostBreakdown } from "@/lib/engines/cost";
import type { ResolvedRates } from "@/lib/db/rates";
import type { EstimateRequest } from "@/types";

export interface EstimateListItem {
  id: string;
  box_type: string;
  /** User-entered estimate name (round 3). Missing pre-migration / when blank. */
  name?: string | null;
  /** draft / sent / accepted / revised (round 3). Missing pre-migration. */
  status?: string | null;
  quantity: number;
  price_per_box: number | null;
  total_price: number | null;
  created_at: string;
  client_name: string | null;
  created_by_name: string | null;
}

export interface EstimateDetail extends EstimateListItem {
  specs_snapshot: EstimateRequest;
  rates_snapshot: ResolvedRates;
  cost_breakdown: CostBreakdown | null;
}

/**
 * `createdBy`: pass a user id to return ONLY that user's own estimates (trial
 * accounts — see ownerScopeFor() in lib/auth.ts); null/omitted returns every
 * estimate, which is what admin and staff have always got.
 */
export async function loadEstimatesList(
  supabase: SupabaseClient,
  createdBy: string | null = null,
): Promise<EstimateListItem[]> {
  const scope = <T,>(q: T): T =>
    createdBy == null
      ? q
      : (q as unknown as { eq: (c: string, v: string) => T }).eq("created_by", createdBy);

  const res = await scope(
    supabase
      .from("estimates")
      .select(
        "id, box_type, name, status, quantity, price_per_box, total_price, created_at, client_id, created_by",
      )
      .order("created_at", { ascending: false })
      .limit(200),
  );
  let data = res.data as Record<string, unknown>[] | null;
  let error = res.error;
  // 42703 = no name/status columns yet (DB pre-migration-round3.sql).
  if (error && error.code === "42703") {
    const legacy = await scope(
      supabase
        .from("estimates")
        .select(
          "id, box_type, quantity, price_per_box, total_price, created_at, client_id, created_by",
        )
        .order("created_at", { ascending: false })
        .limit(200),
    );
    data = legacy.data as Record<string, unknown>[] | null;
    error = legacy.error;
  }

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  const clientIds = [
    ...new Set(data.map((r) => r.client_id as string | null).filter(Boolean)),
  ] as string[];
  const userIds = [
    ...new Set(data.map((r) => r.created_by as string | null).filter(Boolean)),
  ] as string[];

  const [clientsRes, profilesRes] = await Promise.all([
    clientIds.length > 0
      ? supabase.from("clients").select("id, name").in("id", clientIds)
      : Promise.resolve({
          data: [] as { id: string; name: string }[],
          error: null,
        }),
    userIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds)
      : Promise.resolve({
          data: [] as { id: string; full_name: string | null }[],
          error: null,
        }),
  ]);

  const clientMap = new Map(
    (clientsRes.data ?? []).map((c) => [c.id, c.name]),
  );
  const profileMap = new Map(
    (profilesRes.data ?? []).map((p) => [p.id, p.full_name]),
  );

  return data.map((r) => ({
    id: r.id as string,
    box_type: r.box_type as string,
    name: (r as Record<string, unknown>).name as string | null | undefined,
    status: (r as Record<string, unknown>).status as string | null | undefined,
    quantity: r.quantity as number,
    price_per_box: r.price_per_box as number | null,
    total_price: r.total_price as number | null,
    created_at: r.created_at as string,
    client_name: r.client_id
      ? (clientMap.get(r.client_id as string) ?? null)
      : null,
    created_by_name: r.created_by
      ? (profileMap.get(r.created_by as string) ?? null)
      : null,
  }));
}

/**
 * `createdBy`: pass a user id to resolve ONLY that user's own estimate — a
 * trial account asking for someone else's id gets null, i.e. a 404, rather
 * than another lead's costed snapshot. null/omitted resolves any estimate
 * (admin/staff, unchanged).
 */
export async function loadEstimateDetail(
  supabase: SupabaseClient,
  id: string,
  createdBy: string | null = null,
): Promise<EstimateDetail | null> {
  const scope = <T,>(q: T): T =>
    createdBy == null
      ? q
      : (q as unknown as { eq: (c: string, v: string) => T }).eq("created_by", createdBy);

  const res = await scope(
    supabase
      .from("estimates")
      .select(
        "id, box_type, name, status, quantity, price_per_box, total_price, created_at, client_id, created_by, specs_snapshot, rates_snapshot, cost_breakdown",
      )
      .eq("id", id),
  ).maybeSingle();
  let data = res.data as Record<string, unknown> | null;
  let error = res.error;
  // 42703 = no name/status columns yet (DB pre-migration-round3.sql).
  if (error && error.code === "42703") {
    const legacy = await scope(
      supabase
        .from("estimates")
        .select(
          "id, box_type, quantity, price_per_box, total_price, created_at, client_id, created_by, specs_snapshot, rates_snapshot, cost_breakdown",
        )
        .eq("id", id),
    ).maybeSingle();
    data = legacy.data as Record<string, unknown> | null;
    error = legacy.error;
  }

  if (error) throw new Error(error.message);
  if (!data) return null;

  const [clientRes, profileRes] = await Promise.all([
    data.client_id
      ? supabase
          .from("clients")
          .select("name")
          .eq("id", data.client_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    data.created_by
      ? supabase
          .from("profiles")
          .select("full_name")
          .eq("id", data.created_by)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  return {
    id: data.id as string,
    box_type: data.box_type as string,
    name: (data as Record<string, unknown>).name as string | null | undefined,
    status: (data as Record<string, unknown>).status as string | null | undefined,
    quantity: data.quantity as number,
    price_per_box: data.price_per_box as number | null,
    total_price: data.total_price as number | null,
    created_at: data.created_at as string,
    client_name:
      (clientRes.data as { name?: string } | null)?.name ?? null,
    created_by_name:
      (profileRes.data as { full_name?: string | null } | null)?.full_name ??
      null,
    specs_snapshot: data.specs_snapshot as EstimateRequest,
    rates_snapshot: data.rates_snapshot as ResolvedRates,
    cost_breakdown: data.cost_breakdown as CostBreakdown | null,
  };
}
