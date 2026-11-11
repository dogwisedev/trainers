import { NextResponse } from "next/server";
import { getViewer } from "@/lib/data";
import { isDemo } from "@/lib/supabase";
import { checkVaccines } from "@/lib/vaccineCheck";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
// Admin: "Check with AI" on a dog's Vaccines section. Reads the records uploaded in the app again, now (lib/vaccineCheck.ts).
export async function POST(req: Request) {
  const v = await getViewer().catch(() => null);
  if (!v || v.role !== "admin") return NextResponse.json({ ok: false, message: "Admins only." }, { status: 401 });
  if (isDemo()) return NextResponse.json({ ok: false, message: "Demo mode." });
  const { bookingId } = (await req.json().catch(() => ({}))) as { bookingId?: string };
  if (!bookingId || !/^[0-9a-f-]{36}$/i.test(bookingId)) return NextResponse.json({ ok: false, message: "Dog not found." }, { status: 400 });
  const r = await checkVaccines(bookingId, undefined, true);
  return NextResponse.json({ ok: r.ok, message: r.message });
}
