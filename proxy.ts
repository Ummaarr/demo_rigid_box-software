import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 Proxy (the renamed Middleware). Runs on every request to:
 *   1. Refresh the Supabase auth session cookie (keeps users logged in)
 *   2. Redirect unauthenticated users away from protected pages to /login
 *
 * It performs ONLY an optimistic auth check (is there a valid user?). It does
 * NOT read roles from the database here — per Next.js guidance the proxy runs
 * on every request and must stay fast. Role enforcement lives in the server
 * DAL (lib/auth.ts) and Route Handlers, close to the data.
 */

/**
 * The project's JWT signing keys, cached for the whole server process.
 *
 * WHY: this proxy verifies the session on EVERY request, and `getUser()` did it
 * by asking the auth server — a ~70 ms round trip (measured; see the rate-cache
 * section in CLAUDE.md for why round trips cost that much here) paid before any
 * page or API route even starts. `getClaims()` instead verifies the token's
 * signature locally against the public key, with no network call at all.
 *
 * The catch: auth-js caches the key set on the CLIENT INSTANCE, and this proxy
 * builds a fresh client per request, so it would re-fetch the JWKS every time
 * and save nothing. Holding the keys at module scope and passing them in via
 * `options.jwks` is what makes the verification genuinely local.
 *
 * Key rotation is safe: if a token is signed with a `kid` that is not in this
 * set, auth-js falls through to fetching the current JWKS itself.
 *
 * Projects still on a SYMMETRIC (HS256) signing secret cannot be verified
 * locally at all — auth-js detects that and transparently falls back to the
 * same server call `getUser()` made, so this is never wrong, only sometimes
 * not faster.
 */
const JWKS_TTL_MS = 10 * 60 * 1000;
let jwksCache: { keys: unknown[] } | null = null;
let jwksCachedAt = 0;

async function signingKeys(): Promise<{ keys: never[] } | undefined> {
  if (jwksCache && Date.now() - jwksCachedAt < JWKS_TTL_MS) {
    return jwksCache as { keys: never[] };
  }
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
      { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! } },
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { keys?: unknown[] };
    if (!data.keys?.length) return undefined;
    jwksCache = { keys: data.keys };
    jwksCachedAt = Date.now();
    return jwksCache as { keys: never[] };
  } catch {
    // Never let a key-fetch problem break auth — getClaims falls back on its own.
    return undefined;
  }
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // API routes authenticate themselves (getSession in lib/auth.ts) and answer
  // with 401 JSON rather than an HTML redirect, so there is nothing for this
  // proxy to decide for them. Returning BEFORE the auth check — it used to run
  // after — drops a duplicated session verification from every API call. Their
  // own Supabase client still refreshes the cookie when the token has expired,
  // because a Route Handler is allowed to write cookies on its response.
  if (path.startsWith("/api")) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  // Fetched before the client is created so no await sits between
  // createServerClient and the session check below.
  const jwks = await signingKeys();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refreshes the session if expired — getClaims() reads it through getSession(),
  // which renews an expired access token and writes the new cookies via setAll
  // above, exactly as getUser() did. Do not run code between createServerClient
  // and this call — it can cause hard-to-debug session sync issues.
  const { data: claims } = await supabase.auth.getClaims(
    undefined,
    jwks ? { jwks } : undefined,
  );
  const user = claims?.claims ?? null;

  const isPublic = path === "/login";

  // Unauthenticated user trying to reach a protected page -> /login
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Authenticated user on the login page -> /dashboard
  if (user && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  // Run on everything except Next.js internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
