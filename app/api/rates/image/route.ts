// /api/rates/image
//   POST (admin) — upload/replace a rate-card reference photo for an add-on row.
//                  multipart/form-data: table, id, image (file).
//   GET  (auth)  — stream the stored photo for ?table=&id=. We proxy the bytes
//                  through the service role so the browser never talks to
//                  Supabase Storage directly (CLAUDE.md architecture rule).
// Only the add-on rate tables (numeric id PK) carry an image_path column.

import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

const BUCKET = "rate-images";
const IMAGE_TABLES = new Set(["handle_rates", "lock_rates", "window_rates", "misc_rates"]);
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const CT_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  if (session.role !== "admin")
    return Response.json({ error: "Admin only." }, { status: 403 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const table = form.get("table");
  const id = form.get("id");
  const file = form.get("image");

  if (typeof table !== "string" || !IMAGE_TABLES.has(table))
    return Response.json({ error: "Invalid table." }, { status: 400 });
  if (typeof id !== "string" || !/^\d+$/.test(id))
    return Response.json({ error: "Invalid id." }, { status: 400 });
  if (!(file instanceof File))
    return Response.json({ error: "No image file provided." }, { status: 400 });

  const ext = EXT_BY_TYPE[file.type];
  if (!ext)
    return Response.json({ error: "Image must be PNG, JPEG or WebP." }, { status: 400 });
  if (file.size <= 0 || file.size > MAX_BYTES)
    return Response.json({ error: "Image must be between 1 byte and 2 MB." }, { status: 400 });

  const path = `${table}/${id}.${ext}`;
  const admin = createAdminClient();

  const up = await admin.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: true,
  });
  if (up.error) {
    console.error("POST /api/rates/image upload:", up.error);
    return Response.json(
      { error: "Upload failed — is the 'rate-images' storage bucket created?" },
      { status: 500 },
    );
  }

  const { error } = await admin
    .from(table)
    .update({ image_path: path, updated_at: new Date().toISOString() })
    .eq("id", Number(id));
  if (error) {
    console.error("POST /api/rates/image db:", error);
    return Response.json({ error: "Saved the file but failed to record it." }, { status: 500 });
  }

  return Response.json({ ok: true, path });
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session)
    return Response.json({ error: "Not authenticated." }, { status: 401 });

  const url = new URL(request.url);
  const table = url.searchParams.get("table");
  const id = url.searchParams.get("id");

  if (!table || !IMAGE_TABLES.has(table))
    return Response.json({ error: "Invalid table." }, { status: 400 });
  if (!id || !/^\d+$/.test(id))
    return Response.json({ error: "Invalid id." }, { status: 400 });

  const admin = createAdminClient();
  const { data: row, error: rowErr } = await admin
    .from(table)
    .select("image_path")
    .eq("id", Number(id))
    .maybeSingle();
  if (rowErr) {
    console.error("GET /api/rates/image lookup:", rowErr);
    return Response.json({ error: "Lookup failed." }, { status: 500 });
  }

  const path = (row as { image_path: string | null } | null)?.image_path;
  if (!path) return new Response("No image", { status: 404 });

  const dl = await admin.storage.from(BUCKET).download(path);
  if (dl.error || !dl.data) return new Response("No image", { status: 404 });

  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return new Response(dl.data, {
    headers: {
      "Content-Type": CT_BY_EXT[ext] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=60",
    },
  });
}
