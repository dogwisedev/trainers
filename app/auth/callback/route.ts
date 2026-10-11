import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";

// Landing point for "?code=" sign-in links (older email template). Shows the reason on the login page if it fails.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const nextRaw = u.searchParams.get("next") || "/";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";
  const err = u.searchParams.get("error_description") || u.searchParams.get("error");
  if (err) return NextResponse.redirect(new URL(`/login?error=link&detail=${encodeURIComponent(err)}`, req.url));
  if (!code) return NextResponse.redirect(new URL("/login?error=link", req.url));
  const { error } = await serverClient().auth.exchangeCodeForSession(code);
  if (error) {
    // Usually: the link was opened in a different browser than the one that asked for it.
    return NextResponse.redirect(new URL(`/login?error=browser&detail=${encodeURIComponent(error.message)}`, req.url));
  }
  return NextResponse.redirect(new URL(next, req.url));
}
