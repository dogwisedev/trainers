import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { serverClient } from "@/lib/supabase";

// Landing point for invite, sign-in and password-reset emails.
// The email templates link here with ?token_hash=…&type=…&next=… and we sign the person in on the server.
// Works on any device or browser (no code verifier or #fragment needed).
const TYPES: EmailOtpType[] = ["invite", "magiclink", "recovery", "email", "signup", "email_change"];

export async function GET(req: NextRequest) {
  const u = req.nextUrl;
  const token_hash = u.searchParams.get("token_hash");
  const type = u.searchParams.get("type") as EmailOtpType | null;
  const nextRaw = u.searchParams.get("next") || "/";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/"; // only ever redirect inside the app

  if (token_hash && type && TYPES.includes(type)) {
    const { error } = await serverClient().auth.verifyOtp({ type, token_hash });
    if (!error) return NextResponse.redirect(new URL(type === "recovery" ? "/t/profile" : next, req.url));
  }
  return NextResponse.redirect(new URL("/login?error=link", req.url));
}
