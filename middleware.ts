import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Keeps the Supabase session fresh and sends signed-out visitors to /login.
// Also catches sign-in links that land on the wrong page (e.g. "/?code=…" when Supabase falls back to the
// Site URL) and forwards them to the right handler, so a link can never just bounce back to the login screen.
export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  if (!pathname.startsWith("/auth/")) {
    const code = searchParams.get("code"), tokenHash = searchParams.get("token_hash");
    if (code || tokenHash) {
      const to = new URL(tokenHash ? "/auth/confirm" : "/auth/callback", req.url);
      searchParams.forEach((v, k) => to.searchParams.set(k, v));
      if (!to.searchParams.get("next") && pathname !== "/" && pathname !== "/login") to.searchParams.set("next", pathname);
      return NextResponse.redirect(to);
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const inArea = (p: string) => pathname === p || pathname.startsWith(p + "/");
  const protectedPath = inArea("/a") || inArea("/t") || inArea("/c") || inArea("/s"); // exact areas only: "/auth/…" must stay reachable while signed out
  if (!url || !key) {
    if (protectedPath && !req.cookies.get("demo_as")) return NextResponse.redirect(new URL("/login", req.url));
    return NextResponse.next();
  }
  // Fast path: no Supabase login cookie at all = signed out. No network call needed.
  const hasSession = req.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
  if (!hasSession) return protectedPath ? NextResponse.redirect(new URL("/login", req.url)) : NextResponse.next();
  let res = NextResponse.next({ request: req });
  const sb = createServerClient(url, key, {
    // Never let a slow Supabase hold up the page: give up after 4 seconds (the page checks the login itself anyway)
    global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(4000) }) },
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list: { name: string; value: string; options?: Record<string, unknown> }[]) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      }
    }
  });
  try {
    const { data: { user }, error } = await sb.auth.getUser();
    // Only send to login when Supabase clearly says "not signed in", never because it was slow
    if (protectedPath && !user && !(error && /abort|timeout|fetch/i.test(`${error.name} ${error.message}`))) return NextResponse.redirect(new URL("/login", req.url));
  } catch { /* slow or unreachable: let the page decide */ }
  return res;
}

// Static files, the service worker and server-to-server routes skip the session check (it costs a round trip to Supabase)
export const config = { matcher: ["/((?!_next/static|_next/image|icons|logo.png|brand-logo.png|manifest.webmanifest|sw.js|offline.html|favicon.ico|api/availability|api/bookings|api/payroll|api/stripe|api/hubspot|api/chat/cron|api/reports/cron).*)"] }; 
