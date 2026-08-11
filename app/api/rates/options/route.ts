// GET /api/rates/options
// Distinct rate options for the estimate form's dropdowns (paper sizes/GSMs,
// printing sizes, finishing types). Authenticated; server-side DB read.

import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import { loadRateOptions } from "@/lib/db/rate-options";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }
  try {
    const options = await loadRateOptions(createAdminClient());
    return Response.json(options);
  } catch (err) {
    console.error("GET /api/rates/options failed:", err);
    return Response.json({ error: "Failed to load options." }, { status: 500 });
  }
}
