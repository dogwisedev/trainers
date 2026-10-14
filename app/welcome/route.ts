import { NextResponse, type NextRequest } from "next/server";
import { freshSigninHash, verifyWelcome } from "@/lib/trainerSignin";

export const dynamic = "force-dynamic";
// The "Open my app" button in the friendly sign-in email: checks the link, makes a fresh one-time sign-in and signs the trainer in.
export async function GET(req: NextRequest) {
  const email = verifyWelcome(req.nextUrl.searchParams.get("t") || "");
  const hash = email ? await freshSigninHash(email) : null;
  if (!hash) return NextResponse.redirect(new URL("/login?error=link", req.url));
  return NextResponse.redirect(new URL(`/auth/confirm?token_hash=${encodeURIComponent(hash)}&type=magiclink&next=/t`, req.url));
}
