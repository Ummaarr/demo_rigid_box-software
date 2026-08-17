import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ClientRow {
  id: string;
  name: string;
  /** Lead vs customer (round 3). Missing pre-migration — treated as "lead". */
  type?: "lead" | "customer";
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  created_at: string;
}

/**
 * `createdBy`: pass a user id to return ONLY that user's own clients (trial
 * accounts — see ownerScopeFor() in lib/auth.ts); null/omitted returns every
 * client, which is what admin and staff have always got.
 */
export async function loadClientsList(
  supabase: SupabaseClient,
  createdBy: string | null = null,
): Promise<ClientRow[]> {
  const scope = <T,>(q: T): T =>
    createdBy == null
      ? q
      : (q as unknown as { eq: (c: string, v: string) => T }).eq("created_by", createdBy);

  const res = await scope(
    supabase
      .from("clients")
      .select("id, name, type, contact_person, phone, email, address, created_at")
      .order("name", { ascending: true }),
  );
  let data = res.data as ClientRow[] | null;
  let error = res.error;
  // 42703 = no type column yet (DB pre-migration-round3.sql).
  if (error && error.code === "42703") {
    const legacy = await scope(
      supabase
        .from("clients")
        .select("id, name, contact_person, phone, email, address, created_at")
        .order("name", { ascending: true }),
    );
    data = legacy.data as ClientRow[] | null;
    error = legacy.error;
  }
  if (error) throw new Error(error.message);
  return data ?? [];
}
