import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { buildTodo } from "./todo";
import { etParts } from "./chatRules";
import { claim } from "./announce";
import { auditSystem } from "./audit";
import { sendMail, mailConfigured } from "./mail";
import { dealsInPipeline, searchTickets } from "./hubspot";

// The QA daily email (the Tower's STEP 9), sent by the app from data, no AI: weekdays after the 6 AM post, to Jeroni and
// Anita, Sean and Pedro copied. On Monday it covers Friday through the weekend. It never repeats what To do carries: the
// opening says what's there per person. Sections are left out when empty. Off until switched on (Pulse → Office), so it
// doesn't go out twice while the Tower still sends it. QA_DAILY_TO / QA_DAILY_CC in Vercel change the addresses.
// What it can't do that the Tower did: read the Slack QA channels and Gmail. Cases reach it through the app (QA flag,
// Case update on the dog page) and HubSpot (tickets, follow-up deals).

const TO = () => process.env.QA_DAILY_TO || "jeroni@dogwiseacademy.com, anita@dogwiseacademy.com";
const CC = () => process.env.QA_DAILY_CC || "sdevereux@dogwiseacademy.com, ppereira@dogwiseacademy.com";
const FUM = "801784332", UNDER_REVIEW = "1443716415", IN_CONVERSATION = "1443716414";
const OWNERS: Record<string, string> = { "1982745349": "Anita", "91982468": "Jeroni", "512698034": "Pedro" };
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", day: "numeric", month: "short" }).replace(",", "");

export async function qaDailyOn(sb: SupabaseClient = serviceClient()) {
  const { data } = await sb.from("app_settings").select("value").eq("key", "qa.daily").maybeSingle();
  return data?.value === "on";
}

/** The email's text for now (since the last weekday morning). */
export async function qaDailyText(now = new Date(), sb: SupabaseClient = serviceClient()) {
  const { date } = etParts(now);
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay(); // 1 = Monday
  const since = new Date(now.getTime() - (wd === 1 ? 3 : 1) * 864e5).toISOString();
  const lines: string[] = [];
  const section = (title: string, items: string[]) => { if (items.length) lines.push("", `${title}`, ...items.map((x) => `- ${x}`)); };

  // Opening: what's on To do per person (never listed again here)
  const todo = await buildTodo();
  const per = new Map<string, number>();
  for (const i of todo.items) per.set(i.poc || "no owner", (per.get(i.poc || "no owner") || 0) + 1);
  const opening = ["Anita", "Jahrony", "Pedro"].map((p) => `${p === "Jahrony" ? "Jeroni" : p}: ${per.get(p) || 0} item${per.get(p) === 1 ? "" : "s"} on To do.`);

  // From the app: QA flags, case updates, things with Sean
  const [{ data: flags }, { data: upd }, { data: sean }] = await Promise.all([
    sb.from("qa_flags").select("client, dog, reason, by, status, moved, found, at").gte("at", since).order("at"),
    sb.from("case_updates").select("client, dog, text, by, actions, at").gte("at", since).order("at"),
    sb.from("case_updates").select("client, dog, text, by, at").eq("for_sean", true).is("settled_at", null).order("at")
  ]);
  const f = (flags || []) as { client: string; dog: string; reason: string; by: string; status: string; moved: string[]; found: string | null; at: string }[];
  section(wd === 1 ? "New cases since Friday" : "New cases since yesterday", f.filter((x) => x.status !== "hand").map((x) => `${x.client} / ${x.dog}: ${x.reason} (flagged by ${x.by}, ${fmt(x.at)}).`));
  section("Cases moving or stuck", ((upd || []) as { client: string; dog: string; text: string; by: string; actions: { what: string }[]; at: string }[]).map((u) => `${u.client} / ${u.dog}: ${u.text} (${u.by}, ${fmt(u.at)})${u.actions?.length ? `. Done: ${u.actions.map((a) => a.what).join("; ")}` : ""}.`));
  const decisions = todo.items.filter((i) => i.decision).map((i) => `${i.text.replace(/^Decision for Sean: /, "")}${i.detail ? `: ${i.detail.slice(0, 160)}` : ""}`);
  section("With Sean", [...((sean || []) as { client: string; dog: string; text: string; by: string; at: string }[]).map((u) => `${u.client} / ${u.dog}: ${u.text} (${u.by}, ${fmt(u.at)})`), ...decisions]);

  // HubSpot: tickets that need a push, and follow-ups due
  try {
    const tk = await searchTickets("", [{ propertyName: "hs_pipeline_stage", operator: "NEQ", value: "4" }], ["subject", "current_stage", "hs_ticket_priority", "hubspot_owner_id", "hs_lastactivitydate"], true);
    const push = tk.filter((t) => {
      const p = t.properties, last = Date.parse(String(p.hs_lastactivitydate || "")) || 0;
      return /waiting for qa/i.test(String(p.current_stage || "")) || /HIGH|URGENT/i.test(String(p.hs_ticket_priority || "")) || Date.now() - last >= 3 * 864e5 || !p.hubspot_owner_id;
    }).slice(0, 12);
    section("Tickets", push.map((t) => { const p = t.properties; return `${p.subject}: ${p.current_stage || "open"}, ${p.hs_ticket_priority || "no priority"}, last activity ${p.hs_lastactivitydate ? fmt(String(p.hs_lastactivitydate)) : "never"}${p.hubspot_owner_id ? `, ${OWNERS[String(p.hubspot_owner_id)] || "owner set"}` : ", unassigned"}.`; }));
  } catch (e) { lines.push("", `(Couldn't read HubSpot tickets: ${(e as Error).message.slice(0, 120)})`); }
  try {
    const fu = await dealsInPipeline(FUM, [UNDER_REVIEW, IN_CONVERSATION], ["dealname", "dealstage", "notes_last_updated", "hubspot_owner_id"]);
    const due = fu.filter((d) => d.properties.dealstage === UNDER_REVIEW || (Date.now() - (Date.parse(String(d.properties.notes_last_updated || "")) || 0) >= 7 * 864e5));
    section("Follow-ups due", due.slice(0, 12).map((d) => `${d.properties.dealname}: ${d.properties.dealstage === UNDER_REVIEW ? "Under Review" : `In Conversation, quiet since ${d.properties.notes_last_updated ? fmt(String(d.properties.notes_last_updated)) : "a while"}`}${d.properties.hubspot_owner_id ? ` (${OWNERS[String(d.properties.hubspot_owner_id)] || "owner set"})` : ""}.`));
  } catch (e) { lines.push("", `(Couldn't read the follow-up deals: ${(e as Error).message.slice(0, 120)})`); }

  section("Flagged in HubSpot", f.filter((x) => x.status === "ticked").map((x) => `${x.client} / ${x.dog}${x.moved?.length ? " (follow-up moved to Manual Only)" : ""}`));
  section("Worth a QA flag by hand", f.filter((x) => x.status === "hand").map((x) => `${x.client} / ${x.dog}: ${x.found || "no single client found"}`));
  // Top 3: the items waiting longest on the office, one owner each
  const top = [...todo.items].filter((i) => i.since && i.poc).sort((a, b) => (a.since || "").localeCompare(b.since || "")).slice(0, 3);
  section("Top 3 for today", top.map((i) => `${i.poc === "Jahrony" ? "Jeroni" : i.poc}: ${i.text}`));

  const head = ["Hi Jeroni and Anita,", "", ...(wd === 1 ? ["This covers Friday through the weekend."] : []), ...opening, `The app's To do has ${todo.items.length} open items.`];
  const foot = ["", "Update each case on the dog's page in the app (Case update): it's logged on the client's deal straight away, and tick Needs Sean for anything that's his.", "", "Sean"];
  const subject = `QA daily, ${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}`.replace(",", "");
  return { subject, text: [...head, ...lines, ...foot].join("\n") };
}

/** The 10-minute check: on weekdays from 6:30 AM Eastern, once a day. */
export async function runQaDaily(now = new Date(), sb: SupabaseClient = serviceClient()) {
  try {
    const { date, hour, minute } = { ...etParts(now), minute: Number(new Date(now).toLocaleString("en-US", { timeZone: "America/New_York", minute: "2-digit" })) };
    const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6 || hour < 6 || (hour === 6 && minute < 30) || hour > 11) return null;
    if (!mailConfigured() || !(await qaDailyOn(sb))) return null;
    if (!(await claim(`qa-daily:${date}`))) return null;
    const m = await qaDailyText(now, sb);
    const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
    await sendMail({ to: TO(), cc: CC(), subject: m.subject, text: m.text, html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${esc(m.text)}</div>` });
    await auditSystem("QA daily sent", m.subject).catch(() => null);
    return m.subject;
  } catch (e) { await auditSystem("QA daily failed", (e as Error).message.slice(0, 300)).catch(() => null); return null; }
}
