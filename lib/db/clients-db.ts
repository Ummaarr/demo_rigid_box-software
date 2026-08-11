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

export async function loadClientsList(
  supabase: SupabaseClient,
): Promise<ClientRow[]> {
  const res = await supabase
    .from("clients")
    .select("id, name, type, contact_person, phone, email, address, created_at")
    .order("name", { ascending: true });
  let data = res.data as ClientRow[] | null;
  let error = res.error;
  // 42703 = no type column yet (DB pre-migration-round3.sql).
  if (error && error.code === "42703") {
    const legacy = await supabase
      .from("clients")
      .select("id, name, contact_person, phone, email, address, created_at")
      .order("name", { ascending: true });
    data = legacy.data as ClientRow[] | null;
    error = legacy.error;
  }
  if (error) throw new Error(error.message);
  return data ?? [];
}
