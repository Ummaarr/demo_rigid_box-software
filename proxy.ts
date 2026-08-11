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
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

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

  // Refreshes the session if expired. Do not run code between createServerClient
  // and getUser() — it can cause hard-to-debug session sync issues.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // API routes enforce their own auth (and return proper 401/403 JSON), so we
  // only refresh their session cookie here and never redirect them to HTML.
  if (path.startsWith("/api")) {
    return supabaseResponse;
  }

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
