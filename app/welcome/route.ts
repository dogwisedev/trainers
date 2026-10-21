import { NextResponse, type NextRequest } from "next/server";
import { freshSigninHash, verifyWelcome } from "@/lib/trainerSignin";

export const dynamic = "force-dynamic";
// The "Open my app" button in the friendly sign-in email: checks the link, makes a fresh one-time sign-in and signs the trainer in.
export async function GET(req: NextRequest) {
  const w = verifyWelcome(req.nextUrl.searchParams.get("t") || "");
  const hash = w ? await freshSigninHash(w.email) : null;
  if (!hash || !w) return NextResponse.redirect(new URL("/login?error=link", req.url));
  return NextResponse.redirect(new URL(`/auth/confirm?token_hash=${encodeURIComponent(hash)}&type=magiclink&next=${encodeURIComponent(w.next)}`, req.url));
}
