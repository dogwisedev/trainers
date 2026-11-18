import "server-only";
import { serviceClient } from "./supabase";
import { officeBrief } from "./officeBrief";
import { etParts } from "./chatRules";
import { claim } from "./announce";
import { auditSystem } from "./audit";
import { buzzAgentOn, buzzPublish } from "./buzzAgent";

// The app posts the office brief itself, no AI: the full brief at 6 AM and 4 PM Eastern, and between 7 AM and 10 PM a
// new-only post on the hour when something new has come in. Into Buzz #flagged-ongoing, as the app's own Buzz account.
// Off until switched on (Pulse → Office → Brief posting), so it can wait for the move off Slack: until then Sean's Tower
// posts in Slack from office_brief. Its own callers ("app" and "app-live") keep their own "since" markers.
// Vercel BRIEF_BUZZ_CHANNEL: the Buzz channel id, if not #flagged-ongoing's (e580a64a-7e86-42a8-aaa3-e09f0d37c2a7).

const CHANNEL = () => (process.env.BRIEF_BUZZ_CHANNEL || "e580a64a-7e86-42a8-aaa3-e09f0d37c2a7").trim();
const FULL_HOURS = [6, 16], LIVE_FROM = 7, LIVE_TO = 22;

export async function briefPostOn(): Promise<boolean> {
  const { data } = await serviceClient().from("app_settings").select("value").eq("key", "brief.post").maybeSingle();
  return data?.value === "buzz";
}

type Brief = Awaited<ReturnType<typeof officeBrief>>;
type Item = { text: string; detail?: string; owner?: string; days: number; status: string; link?: string; history?: string[] };
const clip = (s: string | undefined, n: number) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** The brief as a post. Still-open items are one line with the day count; new ones get their detail. */
export function briefText(b: Brief, full: boolean): string {
  const when = new Date(b.at).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const one = (i: Item) => {
    const who = i.owner ? ` · **${i.owner}**` : "";
    const link = i.link ? ` ([open](${i.link}))` : "";
    if (i.status === "still open") return `- ${clip(i.text, 120)}${who} · day ${Math.max(1, i.days)}${link}`;
    return `- **${clip(i.text, 140)}**${who}${link}${i.detail ? `\n  ${clip(i.detail, 220)}` : ""}${i.history?.length ? `\n  _${i.history.slice(-1)[0]}_` : ""}`;
  };
  const section = (title: string, items: Item[]) => (items.length ? `**${title}**\n${items.map(one).join("\n")}` : "");
  const parts = [
    // Sean gets his decisions through the Wolf (the full brief); the team post only says how many are with him
    b.decisions.length ? `**With Sean:** ${b.decisions.length} decision${b.decisions.length === 1 ? "" : "s"}` : "",
    section("Urgent and risk", b.urgent as Item[]),
    section("Needs a call", b.calls as Item[]),
    section("Office questions", b.officeQuestions as Item[]),
    section("Worries adding up", b.worriesAddingUp as Item[]),
    section("Trainers' messages to the office", b.trainerInbox as Item[]),
    section("Starting soon", b.startingSoon as Item[]),
    b.goingHome.length ? `**Going home**\n${b.goingHome.map((g) => `- ${g.dog} (${g.client}, ${g.trainer}), ${g.goesHome}: ${g.state} ([open](${g.link}))${(g as { notes?: string[] }).notes?.length ? `\n  Notes: ${(g as { notes?: string[] }).notes!.join(" · ")}` : ""}`).join("\n")}` : "",
    b.watching?.length ? `**Watching**\n${b.watching.map((w) => `- ${w.dog} (${w.client}, ${w.trainer}): ${w.reason}, day ${w.days}. ${w.since}${w.urgent ? `, ${w.urgent} urgent` : ""}${w.latest ? `: ${w.latest}` : ""} ([open](${w.link}))`).join("\n")}` : "",
    b.wins?.length ? `**Wins**\n${b.wins.slice(0, 6).map((w) => `- ${w.dog} (${w.trainer}): ${w.quote}`).join("\n")}` : ""
  ].filter(Boolean);
  const head = full ? `**Office brief, ${when} ET**` : `**New since the last post, ${when} ET**`;
  const foot = full ? `Everything else is on the app's To do (${b.counts.todo}). The app is chasing trainers on ${b.counts.chasing} more.` : "";
  if (!parts.length) return full ? `${head}\nNothing needs a person right now. ${foot}` : "";
  return [head, ...parts, foot].filter(Boolean).join("\n\n");
}

/** The chat check (every 10 minutes): posts what's due, once. Never throws. */
export async function runBriefPost(now = new Date()) {
  const out = { posted: "" as string, error: "" as string };
  try {
    if (!buzzAgentOn() || !(await briefPostOn())) return out;
    const { date, hour } = etParts(now);
    const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
    const send = async (text: string) => { await buzzPublish({ kind: 9, content: text, tags: [["h", CHANNEL()]] }); };
    if (FULL_HOURS.includes(hour) && (await claim(`brief:full:${date}:${hour}`))) {
      const b = await officeBrief({ site, caller: "app" });
      await send(briefText(b, true));
      await officeBrief({ onlyNew: true, site, caller: "app-live" }); // the hourly feed starts again from here, so it doesn't repeat this post
      out.posted = "full";
      return out;
    }
    if (hour >= LIVE_FROM && hour < LIVE_TO && !FULL_HOURS.includes(hour) && (await claim(`brief:live:${date}:${hour}`))) {
      const b = await officeBrief({ onlyNew: true, site, caller: "app-live" });
      const text = briefText(b, false);
      if (text) { await send(text); out.posted = "new"; }
    }
  } catch (e) {
    out.error = (e as Error).message;
    await auditSystem("Couldn't post the office brief to Buzz", out.error.slice(0, 300)).catch(() => null);
  }
  return out;
}
