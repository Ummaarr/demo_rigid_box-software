// GET /api/estimate/[id]/materials
// Raw-materials PDF (round 6, client 15-Jul): quantities + nesting diagrams,
// NO costs — safe for any authenticated role (margin/pricing never enters the
// data builder). Materials are recomputed from the frozen specs_snapshot +
// rates_snapshot (same as the estimate detail page), so legacy snapshots the
// engine can't parse return 422 instead of a wrong drawing.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSession, ownerScopeFor } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import { loadEstimateDetail } from "@/lib/db/estimates";
import { recomputeMaterials } from "@/lib/estimate/build-estimate";
import { buildMaterialsData, type MaterialsData } from "@/lib/pdf/materials-data";
import { MaterialsDocument } from "@/components/pdf/materials-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_BUCKET = "rate-images";
const CT_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
// Only these add-on tables carry rate-card photos (mirrors /api/rates/image).
const IMAGE_TABLES = new Set(["handle_rates", "lock_rates", "misc_rates", "window_rates"]);

/**
 * Resolve the rate-card photo for each add-on row that requested one (client
 * template: handles/locks/misc "with image"). Fetches the row's image_path and
 * downloads the object through the service role — the same proxy path as
 * /api/rates/image, so the browser never talks to storage directly. Missing
 * photos are simply left without an image. Failures never fail the PDF.
 */
async function attachAddonImages(admin: SupabaseClient, data: MaterialsData): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const item of data.items) {
    if (item.kind !== "list") continue;
    for (const row of item.rows) {
      const ref = row.imageRef;
      if (!ref || !IMAGE_TABLES.has(ref.table)) continue;
      jobs.push(
        (async () => {
          try {
            const { data: r } = await admin
              .from(ref.table)
              .select("image_path")
              .eq(ref.column, ref.value)
              .maybeSingle();
            const path = (r as { image_path?: string | null } | null)?.image_path;
            if (!path) return;
            const dl = await admin.storage.from(IMAGE_BUCKET).download(path);
            if (dl.error || !dl.data) return;
            const buf = Buffer.from(await dl.data.arrayBuffer());
            const ext = path.split(".").pop()?.toLowerCase() ?? "png";
            row.image = `data:${CT_BY_EXT[ext] ?? "image/png"};base64,${buf.toString("base64")}`;
          } catch {
            /* leave the row without a photo */
          }
        })(),
      );
    }
  }
  await Promise.all(jobs);
}

async function loadLogo(): Promise<string | undefined> {
  try {
    const buf = await readFile(join(process.cwd(), "public", "brand", "logo.png"));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return undefined; // component falls back to the company name as text
  }
}

function materialsFilename(name: string, id: string): string {
  const safe = name
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return `materials-${safe || "estimate"}-${id.slice(0, 8)}.pdf`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id } = await params;

  try {
    const admin = createAdminClient();
    const est = await loadEstimateDetail(admin, id, ownerScopeFor(session));
    if (!est) {
      return Response.json({ error: "Estimate not found." }, { status: 404 });
    }

    let materials;
    try {
      materials = recomputeMaterials(est.specs_snapshot, est.rates_snapshot);
    } catch {
      return Response.json(
        { error: "Materials can't be recomputed for this estimate (legacy snapshot)." },
        { status: 422 },
      );
    }

    const data = buildMaterialsData(est, materials);
    // Resolve add-on photos (handles/locks/misc) — the pure builder only names
    // them; storage access lives here.
    await attachAddonImages(admin, data);
    const logo = await loadLogo();
    const pdf = await renderToBuffer(
      createElement(MaterialsDocument, { data, logo }) as unknown as Parameters<
        typeof renderToBuffer
      >[0],
    );

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${materialsFilename(data.title, est.id)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("GET /api/estimate/[id]/materials failed:", err);
    return Response.json(
      { error: "Failed to generate the materials PDF." },
      { status: 500 },
    );
  }
}
