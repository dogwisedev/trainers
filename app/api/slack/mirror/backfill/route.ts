import { getViewer } from "@/lib/data";
import { backfillChannel, MIRROR } from "@/lib/slackMirror";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Admins only, in the browser: /api/slack/mirror/backfill?channel=general (&days=30). Posts that channel's last month from
// Slack into Buzz, one post per day, oldest first, up to when the mirror started. Safe to open again: it carries on where
// it stopped and never posts a day twice. The test page (/api/buzz/test) links each channel.
export async function GET(req: Request) {
  const v = await getViewer();
  if (v?.role !== "admin") return new Response("Admins only: sign in to the app as an admin, then open this again.", { status: 401 });
  const q = new URL(req.url).searchParams;
  const channel = q.get("channel") || "";
  const days = Math.min(60, Math.max(1, Number(q.get("days")) || 30));
  if (!MIRROR.some((m) => m.name === channel)) return new Response(`Pick a channel: ${MIRROR.map((m) => `?channel=${m.name}`).join("  ")}`, { status: 400 });
  let text: string;
  try {
    const r = await backfillChannel(channel, days);
    text = [`#${channel}: last ${days} days from Slack`, "", `Posted now: ${r.posted} · already in Buzz: ${r.skipped}`, r.done ? `✓ Done: ${r.note}` : `… Not finished: ${r.note}`].join("\n");
  } catch (e) { text = `#${channel}: couldn't finish: ${(e as Error).message}\nOpen it again to carry on: nothing is posted twice.`; }
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
