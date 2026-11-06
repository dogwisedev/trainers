import { NextResponse } from "next/server";
import { getViewer } from "@/lib/data";
import { auditCall } from "@/lib/audit";
import { serviceClient } from "@/lib/supabase";
import { fromFor, loadPocNumbers, quoConfigured, sendText, toE164 } from "@/lib/quo";

export const dynamic = "force-dynamic";
// Signed in as an admin:
//   /api/quo/test                      the setup: each POC on a trainer's profile, the Quo number their trainers are texted
//                                      from (the POC's own, from Your account, or the default), and trainers with no mobile number
//   /api/quo/test?to=+15551234567      one test text from the default number (add &poc=Anita to send from that POC's number)
export async function GET(req: Request) {
  const v = await getViewer().catch(() => null);
  if (!v || v.role !== "admin") return NextResponse.json({ error: "Sign in as an admin first." }, { status: 401 });
  const q = new URL(req.url).searchParams, to = q.get("to") || "", poc = q.get("poc") || "";
  const sb = serviceClient(), nums = await loadPocNumbers(sb);
  const { data } = await sb.from("trainers").select("name, poc, phone, active").eq("active", true).order("name");
  const trainers = (data || []) as { name: string; poc: string | null; phone: string | null }[];
  const byPoc = new Map<string, { textsFrom: string | null; via: string; trainers: string[] }>();
  for (const t of trainers) {
    const key = (t.poc || "").trim() || "(no POC on the profile)", f = fromFor(t.poc, nums);
    const row = byPoc.get(key) || { textsFrom: f.from, via: f.via === "poc" ? `${f.admin}'s own Quo number (Your account)` : f.via === "default" ? "the default QUO_FROM" : "nothing: no number set", trainers: [] };
    row.trainers.push(t.name); byPoc.set(key, row);
  }
  const setup = {
    configured: quoConfigured(), defaultFrom: process.env.QUO_FROM || null,
    adminNumbers: Object.fromEntries([...nums.entries()].map(([k, x]) => [k, `${x.number} (${x.admin})`])),
    apiUrl: process.env.QUO_API_URL || "https://api.openphone.com/v1 (default)",
    pocs: Object.fromEntries([...byPoc.entries()].sort(([a], [b]) => a.localeCompare(b))),
    noMobileNumber: trainers.filter((t) => !toE164(t.phone)).map((t) => `${t.name}${t.phone ? ` ("${t.phone}")` : " (none)"}`)
  };
  if (!to) return NextResponse.json({ ...setup, next: "Add ?to=+1XXXXXXXXXX (your mobile) to send a test text; add &poc=Name to send it from that POC's number." });
  if (!toE164(to)) return NextResponse.json({ ...setup, error: `"${to}" isn't a US phone number.` }, { status: 400 });
  const from = poc ? fromFor(poc, nums).from : null;
  const result = await sendText(to, `Dogwise: test from the trainers app${poc ? ` (${poc}'s number)` : ""}, sent ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} ET. If you can read this, texts work.`, from);
  await auditCall("quoTest", { to, poc }, { name: v.name, role: v.role }, { ok: result.ok, error: result.error || null });
  return NextResponse.json({ ...setup, to: toE164(to), from: from || process.env.QUO_FROM || null, result }, { status: result.ok ? 200 : 502 });
}
