import "server-only";
import { isDemo, serviceClient } from "./supabase";
import { addDays, lastDay, toDate, toIso } from "./dates";
import { etParts } from "./chatRules";
import { kindName, todos, type BookingForReports, type RowLike, type Todo } from "./reports";
import { buildTodo } from "./todo";
import { readinessFor } from "./pretraining";
import { availability } from "./availability";
import { dealKey } from "./chatTypes";
import { cleanDealId } from "./dealId";
import { auditCall } from "./audit";
import { commsOverview, NarrowDown, recentMessages, trainerComms } from "./claudeComms";

// The tools behind the app's Claude connector (app/api/mcp/route.ts). Claude calls them through MCP with the
// CLAUDE_MCP_KEY. Each tool reads with the service key, like the admin To do list and the daily email do, so whoever
// holds that key sees what an admin sees. Read only. Every call goes in the activity log as done through Claude.

type Args = Record<string, unknown>;
type Field = { type: "string" | "number" | "boolean"; description: string; optional?: boolean; pattern?: string; min?: number; max?: number };
export type ClaudeTool = { name: string; title: string; description: string; input: Record<string, Field>; run: (a: Args) => Promise<unknown> };

/** A problem with the request (bad date, nothing to search for...): the message goes back to Claude as it is. */
class Ask extends Error {}

const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const link = (path?: string | null) => (path ? (/^https?:\/\//.test(path) ? path : `${site()}${path}`) : undefined);
const today = () => etParts(new Date()).date;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A text argument (numbers are accepted too, e.g. a ZIP or deal id sent as a number). */
const text = (a: Args, k: string) => (typeof a[k] === "string" ? (a[k] as string).trim() : typeof a[k] === "number" && Number.isFinite(a[k]) ? String(a[k]) : "");
/** A YYYY-MM-DD argument: "" when not given; a real calendar day, or the request is refused. */
function dateArg(a: Args, k: string) {
  const s = text(a, k);
  if (!s) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || toIso(toDate(s)) !== s || s < "2020-01-01" || s > "2100-01-01") throw new Ask(`${k} should be a real day written YYYY-MM-DD, not "${s.slice(0, 40)}".`);
  return s;
}
const DATETIME = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,6})?)?(Z|[+-]\\d{2}:\\d{2})$";
/** An ISO 8601 date-time argument (e.g. 2026-10-28T13:00:00Z), as a moment; null when not given. */
function momentArg(a: Args, k: string): number | null {
  const s = text(a, k);
  if (!s) return null;
  const t = new RegExp(DATETIME).test(s) ? Date.parse(s) : NaN;
  if (!Number.isFinite(t)) throw new Ask(`${k} should be a date and time like 2026-10-28T13:00:00Z, not "${s.slice(0, 40)}".`);
  return t;
}
function num(a: Args, k: string, fallback: number, min: number, max: number) {
  const v = a[k];
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}
const yes = (a: Args, k: string) => a[k] === true || a[k] === "true";
/** Safe inside a PostgREST or() filter: no commas, brackets or wildcards from the caller. */
const searchText = (s: string) => s.replace(/[,()*%\\:"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
const formName = (t: Pick<Todo, "window">) => `${kindName(t.window.kind)}${t.window.kind === "weekly" ? `, week ${t.window.week}` : ""}`;
const STATE: Record<Todo["state"], string> = {
  overdue: "late", draft: "started, not sent", changes: "sent back for changes", waiting: "sent in, waiting for the team to review",
  open: "open, not started", approved: "approved"
};
const hubspot = (id: string | null | undefined) => (id && /^\d+$/.test(id) ? `https://app.hubspot.com/contacts/21869370/record/0-3/${id}` : undefined);
const cut = (s: string | null, max: number) => (s && s.length > max ? `${s.slice(0, max)} [cut short: open the chat for the rest]` : s || undefined);

type BookingRow = {
  id: string; dog_name: string | null; client_name: string; client_email?: string | null; start_date: string; end_date: string; program: string | null;
  weeks: number | null; status: string; trainer_id: string; hubspot_deal_id: string | null; reports_enabled?: boolean | null; trainers?: { name: string } | null;
};
const bookingLine = (b: BookingRow) => ({
  dog: b.dog_name || "Dog", client: b.client_name, trainer: b.trainers?.name || "", pickup: b.start_date, dropoff: b.end_date,
  program: b.program || (b.weeks ? `${b.weeks} weeks` : ""), status: b.status, link: link(`/a/dogs/${b.id}`)
});

/** Forms for these bookings, the same way the trainer's and admin's lists work them out. */
async function formsFor(bookings: BookingRow[]): Promise<(Todo & { trainerName: string })[]> {
  const sb = serviceClient(), rows: RowLike[] = [];
  for (let i = 0; i < bookings.length; i += 150) {
    const { data, error } = await sb.from("reports").select("id, booking_id, kind, week_number, status, submitted_at, due_by").in("booking_id", bookings.slice(i, i + 150).map((b) => b.id));
    if (error) throw new Error(error.message);
    rows.push(...((data || []) as RowLike[]));
  }
  const names = new Map(bookings.map((b) => [b.trainer_id, b.trainers?.name || ""]));
  return todos(bookings as BookingForReports[], rows).map((t) => ({ ...t, trainerName: names.get(t.booking.trainer_id) || "" }));
}
const formLine = (t: Todo & { trainerName: string }) => ({
  dog: t.booking.dog_name || "Dog", client: t.booking.client_name, trainer: t.trainerName, form: formName(t), due: t.window.deadline,
  state: STATE[t.state], daysLate: t.daysLate || undefined, link: link(t.report?.id ? `/a/reports/${t.report.id}` : `/a/dogs/${t.booking.id}`)
});

const CAP = 100;
/** The first CAP rows of a list, and how many there were. */
const capped = <T,>(rows: T[], narrow = "Narrow it down (a trainer, fewer days) to see the rest.") =>
  ({ total: rows.length, ...(rows.length > CAP ? { shown: CAP, note: `Showing the first ${CAP}. ${narrow}` } : {}), rows: rows.slice(0, CAP) });

/** For each trainer: is a kennel free every night from pickup to the night before drop-off? Counted day by day, like the kennel planner. */
async function freeFor(trainers: { id: string; capacity: number }[], start: string, weeks: number) {
  const last = addDays(start, weeks * 7 - 1), ids = trainers.map((t) => t.id), sb = serviceClient();
  const [b, o] = await Promise.all([
    sb.from("bookings").select("trainer_id, status, start_date, end_date").in("trainer_id", ids).neq("status", "cancelled").lte("start_date", last).gte("end_date", start),
    sb.from("time_off").select("trainer_id, start_date, end_date, slots_blocked").in("trainer_id", ids).lte("start_date", last).gte("end_date", start)
  ]);
  if (b.error) throw new Error(b.error.message);
  if (o.error) throw new Error(o.error.message);
  const dogs = (b.data || []) as { trainer_id: string; start_date: string; end_date: string }[];
  const off = (o.data || []) as { trainer_id: string; start_date: string; end_date: string; slots_blocked: number | null }[];
  const out = new Map<string, string | null>();          // trainer id -> first full day (null = free every night)
  for (const t of trainers) {
    let full: string | null = null;
    for (let d = start; d <= last && !full; d = addDays(d, 1)) {
      const n = dogs.filter((x) => x.trainer_id === t.id && x.start_date <= d && d <= lastDay(x)).length;
      const blocked = Math.min(t.capacity, off.filter((x) => x.trainer_id === t.id && x.start_date <= d && d <= x.end_date).reduce((s, x) => s + (x.slots_blocked ?? t.capacity), 0));
      if (n + blocked >= t.capacity) full = d;
    }
    out.set(t.id, full);
  }
  return out;
}

const SELECT = "id, dog_name, client_name, start_date, end_date, program, weeks, status, trainer_id, hubspot_deal_id, reports_enabled, trainers(name)";
const DATE = "^\\d{4}-\\d{2}-\\d{2}$";

export const CLAUDE_TOOLS: ClaudeTool[] = [
  {
    name: "todo", title: "To do",
    description: "Everything in the Dogwise app that needs a person now, most urgent first: clients waiting for a reply, trainers who haven't posted, incident reports, forms sent in for review, late forms, unread trainer messages, before-training gaps and booking or HubSpot problems. The same list as the admin To do page, apart from payslips waiting for approval.",
    input: {},
    run: async () => {
      // The To do list carries on when one of its lookups fails; this check makes a database outage an error instead of an empty list
      // (and answers as soon as the check fails, without waiting for the list's own lookups to time out)
      const check = serviceClient().from("bookings").select("id").limit(1).then((r) => { if (r.error) throw new Error(r.error.message); });
      const [d] = await Promise.all([buildTodo(), check]);
      return {
        items: capped(d.items.map((i) => ({ when: i.group, what: i.text, detail: i.detail, since: i.since, open: link(i.primary?.href) || link(i.dogHref), hubspot: i.hubspot })), "Open the To do page for the rest."),
        lateForms: capped(d.late.map(formLine), "Use the forms tool with a trainer's name.")
      };
    }
  },
  {
    name: "dogs_in_care", title: "Dogs in care",
    description: "Dogs in care on a day (US Eastern), with trainer, client, dates and program, plus pickups and drop-offs coming up. A booking's drop-off date is the day the dog goes home, so the dog is in care up to the night before.",
    input: {
      date: { type: "string", description: "The day, YYYY-MM-DD. Default: today.", optional: true, pattern: DATE },
      days_ahead: { type: "number", description: "Also list pickups and drop-offs in the next this many days. Default 7, up to 31.", optional: true, min: 0, max: 31 }
    },
    run: async (a) => {
      const day = dateArg(a, "date") || today(), until = addDays(day, num(a, "days_ahead", 7, 0, 31));
      const { data, error } = await serviceClient().from("bookings").select(SELECT).neq("status", "cancelled").lte("start_date", until).gte("end_date", day).order("start_date");
      if (error) throw new Error(error.message);
      const rows = (data || []) as unknown as BookingRow[];
      return {
        date: day,
        inCare: capped(rows.filter((b) => b.start_date <= day && day <= lastDay(b)).map(bookingLine)),
        pickups: capped(rows.filter((b) => b.start_date >= day && b.start_date <= until).map(bookingLine)),
        dropoffs: capped(rows.filter((b) => b.end_date >= day && b.end_date <= until).map(bookingLine))
      };
    }
  },
  {
    name: "forms", title: "Trainer forms",
    description: "Trainer forms (intake on pickup day, weekly health checks, handover report) that are late, started, sent back, waiting for review or open now. Late weekly checks cost the trainer $100.",
    input: {
      trainer: { type: "string", description: "Only this trainer (name or part of it).", optional: true },
      late_only: { type: "boolean", description: "Only late forms and forms sent back for changes.", optional: true }
    },
    run: async (a) => {
      const sb = serviceClient(), now = today();
      const { data, error } = await sb.from("bookings").select(SELECT).neq("status", "cancelled").gte("end_date", addDays(now, -75));
      if (error) throw new Error(error.message);
      const who = text(a, "trainer").toLowerCase();
      const all = (data || []) as unknown as BookingRow[];
      const rows = all.filter((b) => !who || (b.trainers?.name || "").toLowerCase().includes(who));
      if (who && !rows.length) return { forms: capped([]), note: `No trainer with recent bookings has "${text(a, "trainer")}" in their name.` };
      const lateOnly = yes(a, "late_only");
      const list = (await formsFor(rows))
        .filter((t) => t.state !== "approved" && t.window.opens <= now)
        .filter((t) => !lateOnly || t.state === "overdue" || t.state === "changes")
        .sort((x, y) => (y.daysLate || 0) - (x.daysLate || 0) || x.window.deadline.localeCompare(y.window.deadline));
      return { forms: capped(list.map(formLine)) };
    }
  },
  {
    name: "before_training", title: "Before training",
    description: "Dogs starting soon and what is still missing before training: the client's forms, vaccine records, food, medication, the remaining balance. Also says if an admin marked the dog OK to start.",
    input: { days: { type: "number", description: "Dogs starting within this many days. Default 14, up to 60.", optional: true, min: 1, max: 60 } },
    run: async (a) => {
      const now = today(), until = addDays(now, num(a, "days", 14, 1, 60));
      const { data, error } = await serviceClient().from("bookings").select(SELECT).neq("status", "cancelled").gte("start_date", now).lte("start_date", until).order("start_date");
      if (error) throw new Error(error.message);
      const rows = (data || []) as unknown as BookingRow[];
      const ready = await readinessFor(rows.slice(0, CAP).map((b) => b.id));   // only the dogs that will be shown
      return {
        dogs: capped(rows.map((b) => {
          const r = ready.get(b.id);
          return {
            ...bookingLine(b),
            okToStart: r ? r.ready.ready || !!r.dog.cleared : null,
            markedOkBy: r?.dog.cleared?.by || undefined,
            missing: r ? r.ready.missing.map((i) => (i.detail ? `${i.label}: ${i.detail}` : i.label)) : undefined,
            note: r ? undefined : "No before-training details yet (no HubSpot deal, or not synced yet).",
            hubspot: hubspot(b.hubspot_deal_id)
          };
        }), "Ask for fewer days.")
      };
    }
  },
  {
    name: "find_dog", title: "Find a dog",
    description: "Find bookings by dog or client name, client email, or HubSpot deal (id or link): dates, trainer, program, status, the dog's chat and its forms. Newest first, up to 10.",
    input: { query: { type: "string", description: "Dog or client name (or part of it), client email, HubSpot deal id, or a HubSpot deal link." } },
    run: async (a) => {
      const raw = text(a, "query");
      const deal = /record\/0-3\/\d+|\/deal\/\d+/i.test(raw) ? cleanDealId(raw) || "" : "";
      if (!deal && /^https?:\/\/\S*hubspot\.com/i.test(raw)) throw new Ask("That HubSpot link isn't a deal (deal links have record/0-3/ in them). Give the deal's link or id, or the dog's or client's name.");
      const q = deal || searchText(raw);
      if (q.length < 2) throw new Ask("Give at least 2 letters of the dog's or client's name, an email, or a HubSpot deal id.");
      const sb = serviceClient();
      const ors = deal ? [`hubspot_deal_id.eq.${deal}`] : [`dog_name.ilike.%${q}%`, `client_name.ilike.%${q}%`];
      if (!deal && /^\d+$/.test(q)) ors.push(`hubspot_deal_id.eq.${q}`);
      if (!deal && q.includes("@")) ors.push(`client_email.ilike.%${q}%`);
      const { data, error } = await sb.from("bookings").select(`${SELECT}, client_email`).or(ors.join(",")).order("start_date", { ascending: false }).limit(10);
      if (error) throw new Error(error.message);
      const rows = (data || []) as unknown as BookingRow[];
      if (!rows.length) return { bookings: [], note: `No booking matches "${q}".` };
      const keys = [...new Set(rows.map((b) => dealKey(b)))];
      const [chatsR, repsR, forms] = await Promise.all([
        sb.from("chats").select("id, deal_key, status, last_message_at, last_preview, last_sender, invited_at, closed_at").in("deal_key", keys).order("created_at", { ascending: false }),
        sb.from("reports").select("id, booking_id, kind, week_number, status, submitted_at").in("booking_id", rows.map((b) => b.id)).order("week_number"),
        formsFor(rows)
      ]);
      if (chatsR.error) throw new Error(chatsR.error.message);
      if (repsR.error) throw new Error(repsR.error.message);
      type ChatRow = { id: string; deal_key: string; status: string; last_message_at: string | null; last_preview: string | null; last_sender: string | null; invited_at: string | null; closed_at: string | null };
      type RepRow = { id: string; booking_id: string; kind: Todo["window"]["kind"]; week_number: number; status: string; submitted_at: string | null };
      return {
        bookings: rows.map((b) => {
          const chat = ((chatsR.data || []) as ChatRow[]).filter((c) => c.deal_key === dealKey(b)).sort((x, y) => (x.status === "open" ? -1 : 0) - (y.status === "open" ? -1 : 0))[0];
          return {
            ...bookingLine(b), clientEmail: b.client_email || undefined, hubspot: hubspot(b.hubspot_deal_id),
            chat: chat ? { id: chat.id, status: chat.status, clientInvited: !!chat.invited_at, lastMessageAt: chat.last_message_at, lastFrom: chat.last_sender, lastMessage: chat.last_preview, link: link(`/a/chats/${chat.id}`) } : null,
            formsSent: ((repsR.data || []) as RepRow[])
              .filter((r) => r.booking_id === b.id && ["submitted", "changes_requested", "approved"].includes(r.status))
              .map((r) => ({ form: `${kindName(r.kind)}${r.kind === "weekly" ? `, week ${r.week_number}` : ""}`, status: r.status, sentAt: r.submitted_at, link: link(`/a/reports/${r.id}`) })),
            formsOwed: forms.filter((t) => t.booking.id === b.id && t.state !== "approved" && t.state !== "waiting" && t.window.opens <= today()).map(formLine)
          };
        })
      };
    }
  },
  {
    name: "chat_messages", title: "Read a dog's chat",
    description: "The latest messages in a dog's chat with the client, the trainer and the Dogwise team, oldest first. Photos and videos are listed by file name. Very long messages are cut short. role: client, trainer, admin (a person in the office), system (the app's notices) or automatic (the app's own posts as the Dogwise team, such as training materials: not a person replying).",
    input: {
      chat_id: { type: "string", description: "The chat's id, from find_dog.", optional: true },
      dog: { type: "string", description: "Dog or client name, if you don't have the chat id. The open chat is used first.", optional: true },
      limit: { type: "number", description: "How many messages. Default 30, up to 60.", optional: true, min: 1, max: 60 }
    },
    run: async (a) => {
      const sb = serviceClient(), id = text(a, "chat_id"), name = searchText(text(a, "dog"));
      type Chat = { id: string; title: string | null; client_name: string | null; trainer_name: string | null; status: string; created_at: string; transcript_url: string | null; archived_at: string | null };
      const cols = "id, title, client_name, trainer_name, status, created_at, transcript_url, archived_at";
      let chat: Chat | null = null, others: Chat[] = [];
      if (id) {
        if (!UUID.test(id)) throw new Ask("That chat_id isn't a chat id (find_dog gives them). Or leave it out and give the dog's or client's name.");
        const { data, error } = await sb.from("chats").select(cols).eq("id", id).maybeSingle();
        if (error) throw new Error(error.message);
        chat = data as Chat | null;
        if (!chat) throw new Ask("No chat has that id.");
      } else if (name.length >= 2) {
        const { data, error } = await sb.from("chats").select(cols).or(`title.ilike.%${name}%,client_name.ilike.%${name}%`).order("created_at", { ascending: false }).limit(10);
        if (error) throw new Error(error.message);
        const found = (data || []) as Chat[];
        chat = found.find((c) => c.status === "open") || found[0] || null;
        others = found.filter((c) => c.id !== chat?.id).slice(0, 5);
      } else throw new Ask("Give a chat_id (from find_dog) or at least 2 letters of the dog's or client's name.");
      if (!chat) return { chat: null, messages: [], note: `No chat for a dog or client matching "${name}".` };
      const { data, error } = await sb.from("chat_messages").select("sender_id, sender_role, sender_name, kind, body, media, created_at").eq("chat_id", chat.id).order("created_at", { ascending: false }).limit(num(a, "limit", 30, 1, 60));
      if (error) throw new Error(error.message);
      const msgs = ((data || []) as { sender_id: string | null; sender_role: string; sender_name: string | null; kind: string; body: string | null; media: { name?: string; kind?: string }[] | null; created_at: string }[]).reverse();
      const auto = (m: (typeof msgs)[number]) => m.sender_role === "admin" && !m.sender_id;   // posted by the app itself (training materials), not a person
      return {
        chat: { id: chat.id, dog: chat.title, client: chat.client_name, trainer: chat.trainer_name, status: chat.status, link: link(`/a/chats/${chat.id}`), transcript: chat.transcript_url || undefined },
        otherChats: others.length ? others.map((c) => ({ id: c.id, dog: c.title, client: c.client_name, status: c.status })) : undefined,
        note: [others.length ? "More than one chat matches: this is the open one (or the newest). Use chat_id for another." : "", chat.archived_at && !msgs.length ? "This chat was closed and archived: its messages are in the transcript in Google Drive." : ""].filter(Boolean).join(" ") || undefined,
        messages: msgs.map((m) => ({ at: m.created_at, from: auto(m) ? `${m.sender_name || "Dogwise team"} (automatic)` : m.sender_name || m.sender_role, role: auto(m) ? "automatic" : m.sender_role, text: cut(m.body, 1200), files: (m.media || []).map((x) => `${x.kind || "file"}: ${x.name || ""}`.trim()) }))
      };
    }
  },
  {
    name: "chats", title: "Chats overview",
    description: "Every open chat (each dog's chat with the client, the trainer and the Dogwise team) and each trainer's team thread with the office, showing who is waiting on whom. Per chat: where the dog is in training, whether the client was invited and has opened the chat, the last message, a client waiting for a reply (since when, clock and waking hours, and what they said), hours since the trainer and the team last wrote, whether the trainer posted today and yesterday and on how many of the last 7 days with a photo or video, and open chat incidents. Also dogs in care or starting within 7 days that have no chat, and team threads where a trainer is waiting on the office or hasn't read the office's messages. Most urgent first. Chats for finished programs are listed only when a client is waiting or something happened in the last 3 days, unless all is true. \"team\" means a person in the Dogwise office; the app's own automatic posts (such as training materials) never count as a reply or as the team being in touch (lastAutomaticAt shows the latest). Waking hours are 8 am to 9 pm Eastern.",
    input: {
      trainer: { type: "string", description: "Only this trainer's chats and team thread (name or part of it).", optional: true },
      all: { type: "boolean", description: "Also list quiet chats for finished programs.", optional: true }
    },
    run: async (a) => {
      const who = searchText(text(a, "trainer"));
      const r = await commsOverview({ trainer: who, all: yes(a, "all") });
      return who && !r.counts.openChats && !r.teamThreads.length && !r.noChat ? { ...r, note: `No open chat or team thread for a trainer with "${who}" in their name.` } : r;
    }
  },
  {
    name: "recent_messages", title: "Recent messages",
    description: "Messages sent since a moment across every dog's chat (role: client, trainer, team = a person in the office, automatic = the app's own posts such as training materials, system = the app's notices) and the trainers' team threads with the office, oldest first, grouped by chat. Each message has an id. Use it to read what was said lately; use chat_messages for one chat's history. Up to 600 messages from the chats and 600 from the team threads; when there are more, nextSince says where to carry on. Long messages are cut short.",
    input: {
      since: { type: "string", description: "Messages after this moment, as an ISO 8601 date-time like 2026-10-28T13:00:00Z. At most 7 days back. Default: the last 3 hours.", optional: true, pattern: DATETIME },
      hours: { type: "number", description: "Or the last this many hours, when since isn't given. Default 3, up to 168.", optional: true, min: 1, max: 168 },
      trainer: { type: "string", description: "Only this trainer's chats and team thread (name or part of it).", optional: true },
      team: { type: "boolean", description: "Include the trainers' team threads with the office. Default true.", optional: true },
      limit: { type: "number", description: "Most messages to return from the dogs' chats (and the same from the team threads). Default 300, up to 600.", optional: true, min: 1, max: 600 }
    },
    run: async (a) => {
      const now = Date.now(), at = momentArg(a, "since");
      let since = at === null ? new Date(now - num(a, "hours", 3, 1, 168) * 3600000).toISOString() : text(a, "since"), note = "";   // a given since is passed on exactly (it may carry microseconds)
      if (at !== null && at > now) throw new Ask(`since (${text(a, "since")}) is in the future.`);
      if (at !== null && at < now - 7 * 86400000) { since = new Date(now - 7 * 86400000).toISOString(); note = "since was more than 7 days ago, so this starts 7 days ago."; }
      const r = await recentMessages({ since, trainer: searchText(text(a, "trainer")), team: !(a.team === false || a.team === "false"), limit: num(a, "limit", 300, 1, 600) });
      return { ...r, note: [note, r.note].filter(Boolean).join(" ") || undefined };
    }
  },
  {
    name: "trainer_comms", title: "Trainer communication",
    description: "How each trainer kept up with the communication standard over the last full days (US Eastern, not counting today). Daily updates: the days a dog was in their care and on how many the dog's chat got a photo or video (the standard is one every day), with the days missed. Client messages: how many times clients wrote, how long replies took in waking hours (the standard is within 2 to 3 hours), replies over 3 waking hours or over 12 hours, and clients still waiting. Team thread: messages each way with the office. Trainers with the most misses first.",
    input: {
      days: { type: "number", description: "How many full days back. Default 7, up to 30.", optional: true, min: 1, max: 30 },
      trainer: { type: "string", description: "Only this trainer (name or part of it).", optional: true }
    },
    run: async (a) => {
      const who = searchText(text(a, "trainer"));
      const r = await trainerComms({ days: num(a, "days", 7, 1, 30), trainer: who });
      return who && !r.trainers.length ? { ...r, note: `No trainer with "${who}" in their name had a dog in care or client messages in that time.` } : r;
    }
  },
  {
    name: "availability", title: "Trainer availability",
    description: "Active trainers and their free kennels over the next 16 weeks, nearest first when a ZIP is given (with whether the client is inside the trainer's driving range). soonestStart is the first week (starting Sunday) a 2, 3 or 4 week program could begin. With a start date, freeForProgram says whether the trainer has a kennel free every night of the program (counted day by day), and firstFullDay shows where it isn't.",
    input: {
      zip: { type: "string", description: "The client's US ZIP code (5 digits).", optional: true, pattern: "^\\d{5}(-\\d{4})?$" },
      start: { type: "string", description: "Training start (pickup) date, YYYY-MM-DD.", optional: true, pattern: DATE },
      weeks: { type: "number", description: "Program length in weeks. Default 3.", optional: true, min: 1, max: 12 },
      limit: { type: "number", description: "How many trainers. Default 10, up to 50.", optional: true, min: 1, max: 50 }
    },
    run: async (a) => {
      const zipIn = text(a, "zip"), zip = /^(\d{5})(-\d{4})?$/.exec(zipIn)?.[1] || "";
      if (zipIn && !zip) throw new Ask(`zip should be a 5-digit US ZIP code, not "${zipIn.slice(0, 20)}".`);
      const now = today(), start = dateArg(a, "start"), weeks = num(a, "weeks", 3, 1, 12);
      if (start && start < now) throw new Ask(`start (${start}) is before today (${now}, US Eastern).`);
      if (start && start > addDays(now, 366)) throw new Ask(`start (${start}) is more than a year away.`);
      const r = await availability({ zip, today: now });
      if (!r.ok) throw r.status === 404 ? new Ask(`The ZIP lookup couldn't find ${zip} (or the lookup service is down). Check the ZIP, or leave it out.`) : new Error(r.error);
      const full = start ? await freeFor(r.trainers.map((t) => ({ id: t.id, capacity: t.capacity })), start, weeks) : null;
      const list = r.trainers.map((t) => ({
        name: t.name, where: [t.city, t.state].filter(Boolean).join(", "), milesAway: t.distance ?? undefined, coversThisClient: t.inRange ?? undefined,
        rangeMiles: t.range, kennels: t.capacity, freeThisWeek: t.freeNow, away: t.awayNow || undefined,
        soonestStart: { twoWeeks: t.soon2, threeWeeks: t.soon3, fourWeeks: t.soon4 },
        freeForProgram: full ? full.get(t.id) === null : undefined, firstFullDay: full?.get(t.id) || undefined,
        programs: t.programs || undefined, notes: t.notes || undefined
      }));
      const ordered = full ? [...list].sort((x, y) => Number(y.freeForProgram === true) - Number(x.freeForProgram === true)) : list;
      const limit = num(a, "limit", 10, 1, 50);
      return {
        origin: r.origin, start: start || undefined, weeks: start ? weeks : undefined, dropoff: start ? addDays(start, weeks * 7) : undefined,
        total: ordered.length, ...(ordered.length > limit ? { note: `Showing ${limit} of ${ordered.length} trainers. Ask for a higher limit (up to 50) to see more.` } : {}),
        trainers: ordered.slice(0, limit)
      };
    }
  }
];

/** JSON Schema for a tool's arguments, as MCP's tools/list wants it. */
export function toolInputSchema(t: ClaudeTool) {
  const properties = Object.fromEntries(Object.entries(t.input).map(([k, f]) => [k, {
    type: f.type, description: f.description, ...(f.pattern ? { pattern: f.pattern } : {}), ...(f.min !== undefined ? { minimum: f.min } : {}), ...(f.max !== undefined ? { maximum: f.max } : {})
  }]));
  const required = Object.entries(t.input).filter(([, f]) => !f.optional).map(([k]) => k);
  return { type: "object" as const, properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

/** Waits for the activity log line, but never more than a few seconds: a slow log must not hold up Claude's answer. */
async function logQuickly(p: Promise<unknown>, ms = 3000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([p, new Promise((ok) => { timer = setTimeout(ok, ms); })]).finally(() => clearTimeout(timer));
}

/** A hung database can keep each read waiting about 87 seconds (20-second timeout, tried 4 times), past Vercel's 60-second limit.
 *  So every tool gets 25 seconds, then Claude is told plainly that the app is slow right now. */
const TOOL_SECONDS = 25;
class TooSlow extends Error {}
function inTime<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, no) => { timer = setTimeout(() => no(new TooSlow(`No answer within ${TOOL_SECONDS} seconds`)), TOOL_SECONDS * 1000); })])
    .finally(() => clearTimeout(timer));
}

/** Runs one tool for the connector and logs it. Never throws. */
export async function runClaudeTool(name: string, args: Args): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const tool = CLAUDE_TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `No tool called "${name}". Tools: ${CLAUDE_TOOLS.map((t) => t.name).join(", ")}.` };
  if (isDemo()) return { ok: false, error: "The app is in demo mode (no database), so there is nothing to read." };
  const who = { name: "Claude connector", role: "claude" };
  // What was asked, for the log. A chat id is passed as chatId so the log names the dog and client and links the chat.
  const asked = Object.fromEntries(Object.entries(args).filter(([k, v]) => Object.hasOwn(tool.input, k) && ["string", "number", "boolean"].includes(typeof v)));
  const chatId = typeof args.chat_id === "string" && UUID.test(args.chat_id.trim()) ? args.chat_id.trim() : undefined;
  const logged = { tool: name, ...asked, ...(chatId ? { chatId } : {}) };
  let out: { ok: true; result: unknown } | { ok: false; error: string; detail: string };
  try {
    const unknown = Object.keys(args).filter((k) => !Object.hasOwn(tool.input, k));
    if (unknown.length) throw new Ask(`Unknown argument${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. ${name} takes: ${Object.keys(tool.input).join(", ") || "no arguments"}.`);
    out = { ok: true, result: await inTime(tool.run(args)) };
  } catch (e) {
    const detail = (e as Error)?.message || String(e);
    const slow = name === "availability" && text(args, "zip") ? "the app's database or the ZIP lookup" : "the app's database";
    out = {
      ok: false, detail,
      error: e instanceof Ask || e instanceof NarrowDown ? detail
        : e instanceof TooSlow ? `No answer: ${slow} is slow right now. Try again in a minute; if it keeps happening, tell Alma.`
        : "The app couldn't answer that just now (the error is in the app's activity log). Try again in a minute; if it keeps happening, tell Alma."
    };
  }
  await logQuickly(auditCall("claudeTool", logged, who, out.ok ? { ok: true } : { ok: false, error: out.detail }));
  return out.ok ? out : { ok: false, error: out.error };
}
