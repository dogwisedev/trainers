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
  const protectedPath = inArea("/a") || inArea("/t") || inArea("/c"); // exact areas only: "/auth/…" must stay reachable while signed out
  if (!url || !key) {
    if (protectedPath && !req.cookies.get("demo_as")) return NextResponse.redirect(new URL("/login", req.url));
    return NextResponse.next();
  }
  let res = NextResponse.next({ request: req });
  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list: { name: string; value: string; options?: Record<string, unknown> }[]) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      }
    }
  });
  const { data: { user } } = await sb.auth.getUser();
  if (protectedPath && !user) return NextResponse.redirect(new URL("/login", req.url));
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|icons|logo.png|brand-logo.png|manifest.webmanifest|api/availability|api/bookings|api/payroll).*)"] }; 
