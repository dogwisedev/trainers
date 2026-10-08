import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";

// Landing point for invite and sign-in links.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  if (code) await serverClient().auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(u.searchParams.get("next") || "/", req.url));
}
