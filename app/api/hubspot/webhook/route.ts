import { NextResponse } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { announceWin } from "@/lib/salesWin";
import { announceLead } from "@/lib/leadAlert";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
// HubSpot → app, within seconds (the "Dogwise Buzz" HubSpot app in /hubspot-app). Two deal subscriptions:
//   dealstage   a deal that is now Closed Won → one post in the Buzz sales channel (lib/salesWin.ts)
//   lead_score  Bark to HubSpot just scored a new Bark lead → one post in the Buzz leads channel (lib/leadAlert.ts)
// Signed by HubSpot with the app's client secret: Vercel variable HUBSPOT_WEBHOOK_SECRET.

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** HubSpot's request signature: v3 (HMAC of method + URL + body + timestamp, at most 5 minutes old), or the older v1/v2. */
function signedByHubSpot(req: Request, body: string, secret: string) {
  const h = req.headers, u = new URL(req.url);
  const host = h.get("x-forwarded-host") || h.get("host") || u.host;
  const urls = [...new Set([req.url, `https://${host}${u.pathname}${u.search}`])].flatMap((x) => { try { return [x, decodeURIComponent(x)]; } catch { return [x]; } });
  const v3 = h.get("x-hubspot-signature-v3"), ts = h.get("x-hubspot-request-timestamp");
  if (v3 && ts) {
    if (!(Date.now() - Number(ts) <= 300000)) return false;
    return urls.some((x) => same(createHmac("sha256", secret).update(`POST${x}${body}${ts}`).digest("base64"), v3));
  }
  const sig = h.get("x-hubspot-signature"), ver = (h.get("x-hubspot-signature-version") || "v1").toLowerCase();
  if (!sig) return false;
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  if (ver === "v1") return same(sha(secret + body), sig);
  if (ver === "v2") return urls.some((x) => same(sha(`${secret}POST${x}${body}`), sig));
  return false;
}

type HsEvent = { objectId?: number | string; objectTypeId?: string; propertyName?: string; subscriptionType?: string };

export async function POST(req: Request) {
  const secret = (process.env.HUBSPOT_WEBHOOK_SECRET || "").trim();
  if (!secret) return NextResponse.json({ error: "HUBSPOT_WEBHOOK_SECRET isn't set" }, { status: 503 });
  const body = await req.text();
  if (!signedByHubSpot(req, body, secret)) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  let events: HsEvent[];
  try { const j = JSON.parse(body); events = Array.isArray(j) ? j : [j]; } catch { return NextResponse.json({ error: "not JSON" }, { status: 400 }); }

  // Deals only (dealstage and lead_score exist only on deals); one look per deal and kind, however many events came
  const pick = (prop: string) => [...new Set(events
    .filter((e) => e.propertyName === prop && e.objectId != null && (!e.objectTypeId || e.objectTypeId === "0-3"))
    .map((e) => String(e.objectId)))].slice(0, 20);
  const jobs: [string, () => Promise<string>][] = [
    ...pick("dealstage").map((id): [string, () => Promise<string>] => [`sale ${id}`, () => announceWin(id)]),
    ...pick("lead_score").map((id): [string, () => Promise<string>] => [`lead ${id}`, () => announceLead(id)])
  ];
  const results: Record<string, string> = {};
  for (const [label, run] of jobs) {
    try { results[label] = await run(); }
    catch (e) { results[label] = `error: ${(e as Error).message}`; console.error("hubspot webhook", label, (e as Error).message); }
  }
  if (jobs.length) console.log("hubspot webhook", JSON.stringify(results));
  // Always 200 once signed: a Buzz or HubSpot hiccup is caught by the 30-minute sync, not by HubSpot retrying
  return NextResponse.json({ ok: true, results });
}
