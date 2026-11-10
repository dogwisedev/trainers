import { getViewer } from "@/lib/data";
import { buzzFingerprint, buzzOn, postToBuzzDetailed, type BuzzRoom } from "@/lib/buzz";
import { buzzAlert } from "@/lib/adminAlert";
import { digestMessage } from "@/lib/digest";
import { replayRecentCharges } from "@/lib/paymentAlert";
import { replayRecentWins } from "@/lib/salesWin";
import { replayRecentLeads } from "@/lib/leadAlert";
import { replayRecentNotion } from "@/lib/notionAlert";
import { serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Try Buzz without waiting for a real alert or payment. Admins only, in the browser:
//   /api/buzz/test                 preview: what each channel would get, nothing sent
//   /api/buzz/test?send=office     a connection test + today's To do list (as the 8 AM message would show it), marked TEST
//   /api/buzz/test?send=payments   the last 3 real Stripe payments as Buzz would show them, marked TEST (&n=1..10)
//   /api/buzz/test?send=sales      the last 3 Closed Won deals as the sales channel would show them, marked TEST (&n=1..10)
//   /api/buzz/test?send=leads      the last 3 Bark leads as the leads channel would show them, marked TEST (&n=1..10)
//   /api/buzz/test?send=notion     the last 3 edited Back Office items in Notion as the Notion channel would show them (&n=1..10)
//   /api/buzz/test?send=all        all five
// Nothing here touches Stripe, HubSpot or the To do list: it only reads them.
const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");

export async function GET(req: Request) {
  const v = await getViewer();
  if (v?.role !== "admin") return new Response("Admins only: sign in to the app as an admin, then open this again.", { status: 401 });
  const q = new URL(req.url).searchParams;
  const send = q.get("send") || "";
  const n = Math.min(10, Math.max(1, Number(q.get("n")) || 3));
  const sending = (room: BuzzRoom) => send === "all" || send === room;
  const out: string[] = [send ? `Buzz test: sending to ${send === "all" ? "every channel" : `the ${send} channel`}` : "Buzz test: PREVIEW ONLY, nothing sent. Add ?send=office, ?send=payments, ?send=sales, ?send=leads, ?send=notion or ?send=all to post these, marked TEST.", ""];

  const deliver = async (room: BuzzRoom, message: string) => {
    out.push(message, "");
    if (!sending(room)) return;
    const r = await postToBuzzDetailed(room, message);
    out.push(r.ok ? "→ sent ✓ (it shows in Buzz a moment later)" : `→ NOT SENT: ${r.result}${/^HTTP 404/.test(r.result) ? "\n  Buzz says \"not found\" for all of these: the secret doesn't match, the URL is wrong, the workflow is off, or its creator left the channel." : ""}`, "");
  };
  const fingerprints = Object.fromEntries(await Promise.all((["office", "payments", "sales", "leads", "notion"] as BuzzRoom[]).map(async (r) => [r, await buzzFingerprint(r)])));
  const section = (room: BuzzRoom, title: string) => {
    const key = room.toUpperCase();
    out.push("════════════════════════", `${title}: ${buzzOn(room) ? `ON · ${fingerprints[room]}` : `OFF (set BUZZ_${key}_URL and BUZZ_${key}_SECRET in Vercel, then redeploy)`}`, "");
  };

  section("office", "OFFICE channel");
  out.push("1. Connection test", "");
  await deliver("office", buzzAlert("🧪 TEST: Buzz office channel", "If you can read this, the app's alerts will arrive here. Nothing to do.", [], { label: "Open To do", link: `${site()}/a` }));
  out.push("2. Today's To do list, as the 8 AM message would show it", "");
  try {
    const d = await digestMessage();
    if (d) await deliver("office", buzzAlert(`🧪 TEST · ${d.subject}`, `${d.intro} (A preview: the real one comes at 8 AM Eastern.)`, d.lines, d.button));
    else out.push("To do is empty right now, so no 8 AM message would go.", "");
  } catch (e) { out.push(`Couldn't build it: ${(e as Error).message}`, ""); }

  section("payments", "PAYMENTS channel");
  out.push(`The last ${n} real Stripe payments, as Buzz would show them`, "");
  try {
    const list = await replayRecentCharges(n);
    if (!list.length) out.push("No paid or failed payments found in Stripe.", "");
    for (const [i, x] of list.entries()) { out.push(`${i + 1}. ${x.id}`, ""); await deliver("payments", x.message); }
  } catch (e) { out.push(`Couldn't read Stripe: ${(e as Error).message}`, ""); }

  section("sales", "SALES channel");
  out.push(`The last ${n} Closed Won deals, as Buzz would show them (live ones also need HUBSPOT_WEBHOOK_SECRET)`, "");
  try {
    const list = await replayRecentWins(n);
    if (!list.length) out.push("No Closed Won deals in the last 45 days.", "");
    for (const [i, x] of list.entries()) { out.push(`${i + 1}. deal ${x.id}`, ""); await deliver("sales", x.message); }
  } catch (e) { out.push(`Couldn't read HubSpot: ${(e as Error).message}`, ""); }

  section("leads", "LEADS channel");
  out.push(`The last ${n} Bark leads, as Buzz would show them (live ones also need HUBSPOT_WEBHOOK_SECRET)`, "");
  try {
    const list = await replayRecentLeads(n);
    if (!list.length) out.push("No Bark leads in the last 7 days.", "");
    for (const [i, x] of list.entries()) { out.push(`${i + 1}. deal ${x.id}`, ""); await deliver("leads", x.message); }
  } catch (e) { out.push(`Couldn't read HubSpot: ${(e as Error).message}`, ""); }

  section("notion", "NOTION channel");
  const vt = await serviceClient().from("app_state").select("value, updated_at").eq("key", "notion_verification_token").maybeSingle();
  out.push(
    `Notion integration secret (NOTION_TOKEN): ${process.env.NOTION_TOKEN ? "set" : "NOT SET"}`,
    `Webhook token (NOTION_WEBHOOK_TOKEN): ${process.env.NOTION_WEBHOOK_TOKEN ? "set" : "NOT SET"}`,
    vt.data?.value ? `Verification token Notion sent on ${new Date(vt.data.updated_at).toLocaleString("en-US", { timeZone: "America/New_York" })} ET (paste it into Notion's Verify box, and into Vercel as NOTION_WEBHOOK_TOKEN):\n  ${vt.data.value}` : "No verification token received from Notion yet (it arrives when you create the webhook subscription).",
    ""
  );
  out.push(`The last ${n} edited Back Office items, as Buzz would show a change`, "");
  try {
    const list = await replayRecentNotion(n);
    if (!list.length) out.push("No items found (is the integration connected to Back Office Workstream?).", "");
    for (const [i, x] of list.entries()) { out.push(`${i + 1}. ${x.id}`, ""); await deliver("notion", x.message); }
  } catch (e) { out.push(`Couldn't read Notion: ${(e as Error).message}`, ""); }

  out.push("════════════════════════", "In Buzz, ** shows as bold and [text](link) as a tappable link.");
  return new Response(out.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
