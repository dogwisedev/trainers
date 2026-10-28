import "server-only";
import { serviceClient } from "./supabase";
import { addDays, careDays, daysBetween, lastDay } from "./dates";
import { INCIDENT_LABEL } from "./chatRules";
import { dealKey } from "./chatTypes";
import { etAt, etDate, wakingHoursBetween } from "./commsTime";

// The communication side of the Claude connector (lib/claudeConnector.ts):
//  commsOverview   every open chat and every trainer's team thread: who is waiting on whom, and for how long
//  recentMessages  what was said since a given moment, across the dogs' chats and the team threads
//  trainerComms    how each trainer kept up with the communication standard over the last few days
// Read only, with the service key, like the rest of the connector. Times are UTC; dates and waking hours
// (8 am to 9 pm, as in the chat check) are US Eastern.

const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const link = (path: string) => `${site()}${path}`;
const hubspot = (key: string) => (/^\d+$/.test(key) ? `https://app.hubspot.com/contacts/21869370/record/0-3/${key}` : undefined);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ms = (v: string | null | undefined) => (v ? Date.parse(v) : 0);
const iso = (t: number) => new Date(t).toISOString();
const hoursBetween = (a: number, b: number) => Math.round((b - a) / 360000) / 10;
const cut = (s: string | null | undefined, max: number) => { const t = (s || "").trim(); return t.length > max ? `${t.slice(0, max)} [cut short]` : t; };
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10; };
const RECENT_HOURS = 72;

// ── Reading in bulk ─────────────────────────────────────────────────────
/** Too much to read for one answer: the message goes back to Claude as it is. */
export class NarrowDown extends Error {}
type Res = { data: unknown[] | null; error: { message: string } | null };
/** Every row of a query, 1,000 at a time (the most Supabase sends back per request). `page` builds the query for one range. */
async function allRows<T>(page: (from: number, to: number) => PromiseLike<Res>, max = 30000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    if (from >= max) throw new NarrowDown(`There are more than ${max.toLocaleString("en-US")} rows to read for this. Narrow it down: fewer days, or one trainer.`);
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
/** A database timestamp in microseconds, so messages a fraction of a millisecond apart keep their order. */
const micros = (v: string) => { const m = /\.(\d+)/.exec(v); return Date.parse(v) * 1000 + (Number(((m ? m[1] : "") + "000000").slice(3, 6)) || 0); };
/** The same query over a long list of ids, 100 ids per request so no request's address gets too long. */
async function byIds<T>(ids: string[], page: (chunk: string[], from: number, to: number) => PromiseLike<Res>): Promise<T[]> {
  const list = [...new Set(ids.filter(Boolean))];
  const chunks = Array.from({ length: Math.ceil(list.length / 100) }, (_, i) => list.slice(i * 100, i * 100 + 100));
  return (await Promise.all(chunks.map((c) => allRows<T>((f, t) => page(c, f, t))))).flat();
}
function groupBy<T>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); }
  return m;
}

// ── Rows ────────────────────────────────────────────────────────────────
type Chat = {
  id: string; deal_key: string; trainer_id: string | null; trainer_name: string | null; client_user_id: string | null; client_name: string | null;
  title: string | null; status: string; last_message_at: string | null; last_preview: string | null; last_sender: string | null;
  last_trainer_at: string | null; last_client_at: string | null; last_admin_at: string | null; admin_seen_at: string | null; invited_at: string | null; created_at: string;
};
const CHAT_COLS = "id, deal_key, trainer_id, trainer_name, client_user_id, client_name, title, status, last_message_at, last_preview, last_sender, last_trainer_at, last_client_at, last_admin_at, admin_seen_at, invited_at, created_at";
type Booking = { id: string; hubspot_deal_id: string | null; dog_name: string | null; client_name: string; start_date: string; end_date: string; status: string; trainer_id: string; trainers?: { name: string } | null };
const BOOKING_COLS = "id, hubspot_deal_id, dog_name, client_name, start_date, end_date, status, trainer_id, trainers(name)";
type Msg = { id: string; chat_id: string; sender_role: "client" | "trainer" | "admin" | "system"; sender_name: string | null; kind: string; body: string | null; media: { kind?: string }[] | null; created_at: string };
type TeamMsg = { id: string; trainer_id: string; sender_id: string | null; sender_role: "admin" | "trainer"; sender_name: string | null; body: string; created_at: string; read_at: string | null };
const TEAM_COLS = "id, trainer_id, sender_id, sender_role, sender_name, body, created_at, read_at";
type Trainer = { id: string; name: string; active: boolean };

/** "team" is the Dogwise office (admins in the app). */
const ROLE: Record<string, string> = { client: "client", trainer: "trainer", admin: "team", system: "system" };
/** A photo or a video (not only a PDF). */
const hasPhotoOrVideo = (m: Pick<Msg, "kind" | "media">) => (m.media && m.media.length ? m.media.some((x) => x.kind !== "file") : m.kind === "media");
function attachments(m: Pick<Msg, "media">) {
  const n = { photo: 0, video: 0, file: 0 };
  for (const x of m.media || []) n[x.kind === "video" ? "video" : x.kind === "file" ? "file" : "photo"]++;
  const s = (k: number, one: string) => (k ? `${k} ${one}${k > 1 ? "s" : ""}` : "");
  return [s(n.photo, "photo"), s(n.video, "video"), s(n.file, "file")].filter(Boolean).join(", ") || undefined;
}
/** Office messages with no sender are automatic notices from the app (for example an incident alert), not a person replying. */
const teamFrom = (m: TeamMsg) => (m.sender_role === "trainer" ? "trainer" : m.sender_id ? "office" : "automatic notice");

/** Bookings for chats, by the chat's key (the HubSpot deal id, or the booking id when there is no deal). */
async function bookingsFor(keys: string[]) {
  const sb = serviceClient();
  const deals = new Set(keys.filter((k) => /^\d+$/.test(k))), ids = keys.filter((k) => UUID.test(k));
  const [a, b] = await Promise.all([
    byIds<Booking>([...deals], (c, f, t) => sb.from("bookings").select(BOOKING_COLS).in("hubspot_deal_id", c).order("id").range(f, t)),
    byIds<Booking>(ids, (c, f, t) => sb.from("bookings").select(BOOKING_COLS).in("id", c).order("id").range(f, t))
  ]);
  const seen = new Set<string>(), by = new Map<string, Booking[]>();
  for (const x of [...a, ...b]) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    const k = x.hubspot_deal_id && deals.has(x.hubspot_deal_id) ? x.hubspot_deal_id : x.id;
    by.set(k, [...(by.get(k) || []), x]);
  }
  return by;
}

type PhaseInfo = { phase: string; pickup?: string; dropoff?: string; day?: string; startsInDays?: number; endedDaysAgo?: number; inCareOn: (d: string) => boolean };
/** Where the dogs in a chat are in their training. A booking's end date is the drop-off day (the dog goes home that day). */
function phaseOf(all: Booking[], today: string): PhaseInfo {
  const live = all.filter((b) => b.status !== "cancelled");
  const inCareOn = (d: string) => live.some((b) => b.start_date <= d && d <= lastDay(b));
  if (!all.length) return { phase: "no booking", inCareOn };
  if (!live.length) return { phase: "cancelled", inCareOn };
  const pickup = live.map((b) => b.start_date).sort()[0], dropoff = live.map((b) => b.end_date).sort().slice(-1)[0];
  const now = live.filter((b) => b.start_date <= today && today < b.end_date).sort((x, y) => x.start_date.localeCompare(y.start_date));
  if (now.length) return { phase: "in care", pickup, dropoff, day: `${daysBetween(now[0].start_date, today) + 1} of ${careDays(now[0])}`, inCareOn };
  if (live.some((b) => b.end_date === today)) return { phase: "going home today", pickup, dropoff, inCareOn };
  const next = live.filter((b) => b.start_date > today).map((b) => b.start_date).sort()[0];
  if (next) return { phase: next <= addDays(today, 7) ? "starting soon" : "booked", pickup: next, dropoff, startsInDays: daysBetween(today, next), inCareOn };
  return { phase: "finished", pickup, dropoff, endedDaysAgo: daysBetween(dropoff, today), inCareOn };
}
const CARE = ["in care", "going home today"], AHEAD = ["starting soon", "booked"];

// ── Overview ────────────────────────────────────────────────────────────
/** Every open chat and team thread, with who is waiting on whom. Quiet finished chats only with `all`. */
export async function commsOverview(o: { trainer?: string; all?: boolean; now?: Date } = {}) {
  const sb = serviceClient(), now = (o.now || new Date()).getTime(), today = etDate(now), who = (o.trainer || "").toLowerCase();
  const mine = (name: string | null | undefined) => !who || (name || "").toLowerCase().includes(who);
  const since30 = iso(now - 30 * 86400000);
  const [chatRows, comingRows, trainers, teamRecent, teamOldUnread] = await Promise.all([
    allRows<Chat>((f, t) => sb.from("chats").select(CHAT_COLS).eq("status", "open").order("id").range(f, t)),
    allRows<Booking>((f, t) => sb.from("bookings").select(BOOKING_COLS).neq("status", "cancelled").lte("start_date", addDays(today, 7)).gte("end_date", today).order("id").range(f, t)),
    allRows<Trainer>((f, t) => sb.from("trainers").select("id, name, active").order("id").range(f, t)),
    allRows<TeamMsg>((f, t) => sb.from("messages").select(TEAM_COLS).gte("created_at", since30).order("created_at").order("id").range(f, t)),
    allRows<TeamMsg>((f, t) => sb.from("messages").select(TEAM_COLS).is("read_at", null).lt("created_at", since30).order("created_at").order("id").range(f, t))
  ]);
  const chats = chatRows.filter((c) => mine(c.trainer_name));
  const ids = chats.map((c) => c.id), trainerIds = [...new Set(chats.map((c) => c.trainer_id).filter((x): x is string => !!x))];
  const [bookings, reads, incidents, logins] = await Promise.all([
    bookingsFor(chats.map((c) => c.deal_key)),
    byIds<{ chat_id: string; user_id: string; last_read_at: string }>(ids, (c, f, t) => sb.from("chat_reads").select("chat_id, user_id, last_read_at").in("chat_id", c).order("chat_id").order("user_id").range(f, t)),
    byIds<{ chat_id: string; kind: string; status: string; detail: string | null; opened_at: string; taken_by: string | null }>(ids, (c, f, t) =>
      sb.from("chat_incidents").select("chat_id, kind, status, detail, opened_at, taken_by").neq("status", "resolved").in("chat_id", c).order("opened_at").order("id").range(f, t)),
    byIds<{ id: string; trainer_id: string }>(trainerIds, (c, f, t) => sb.from("profiles").select("id, trainer_id").eq("role", "trainer").in("trainer_id", c).order("id").range(f, t))
  ]);

  const phases = new Map(chats.map((c) => [c.id, phaseOf(bookings.get(c.deal_key) || [], today)]));
  const ourSide = (c: Chat) => Math.max(ms(c.last_trainer_at), ms(c.last_admin_at));    // the trainer or the team, whoever wrote last
  const waitingChats = chats.filter((c) => ms(c.last_client_at) > ourSide(c));
  const careChats = chats.filter((c) => CARE.includes(phases.get(c.id)!.phase));
  const fromOldest = waitingChats.length ? iso(Math.min(...waitingChats.map(ourSide))) : "";
  const weekAgo = iso(etAt(addDays(today, -7), 0));
  const [unanswered, trainerMsgs] = await Promise.all([
    byIds<Msg>(waitingChats.map((c) => c.id), (c, f, t) => sb.from("chat_messages").select("id, chat_id, sender_role, kind, body, media, created_at")
      .eq("sender_role", "client").gt("created_at", fromOldest).in("chat_id", c).order("created_at").order("id").range(f, t)),
    byIds<Msg>(careChats.map((c) => c.id), (c, f, t) => sb.from("chat_messages").select("chat_id, kind, media, created_at")
      .eq("sender_role", "trainer").gte("created_at", weekAgo).in("chat_id", c).order("created_at").order("id").range(f, t))
  ]);

  const readsBy = groupBy(reads, (r) => r.chat_id), incBy = groupBy(incidents, (i) => i.chat_id), unansweredBy = groupBy(unanswered, (m) => m.chat_id);
  const loginsBy = groupBy(logins, (p) => p.trainer_id);
  const postsBy = new Map<string, Map<string, { media: boolean }>>();
  for (const m of trainerMsgs) {
    const d = etDate(ms(m.created_at)), days = postsBy.get(m.chat_id) || new Map<string, { media: boolean }>();
    days.set(d, { media: (days.get(d)?.media || false) || hasPhotoOrVideo(m) });
    postsBy.set(m.chat_id, days);
  }
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 7));

  const all = chats.map((c) => {
    const p = phases.get(c.id)!, read = new Map((readsBy.get(c.id) || []).map((r) => [r.user_id, ms(r.last_read_at)]));
    const trainerLogins = loginsBy.get(c.trainer_id || "") || [];
    const trainerRead = Math.max(0, ...trainerLogins.map((u) => read.get(u.id) || 0));
    const clientRead = c.client_user_id ? read.get(c.client_user_id) || 0 : 0;
    const us = ourSide(c);
    let waiting: Record<string, unknown> | undefined;
    if (ms(c.last_client_at) > us) {
      const list = (unansweredBy.get(c.id) || []).filter((m) => ms(m.created_at) > us);
      const since = list.length ? ms(list[0].created_at) : ms(c.last_client_at);
      waiting = {
        since: iso(since), hours: hoursBetween(since, now), wakingHours: wakingHoursBetween(since, now), messages: list.length || 1,
        trainerHasRead: trainerLogins.length ? trainerRead >= ms(c.last_client_at) : null,
        teamHasSeen: ms(c.admin_seen_at) >= ms(c.last_client_at),
        said: list.slice(-3).map((m) => ({ at: m.created_at, text: cut(m.body, 300) || undefined, attachments: attachments(m) }))
      };
    }
    let trainerPosts: Record<string, unknown> | undefined;
    if (CARE.includes(p.phase)) {
      const days = postsBy.get(c.id) || new Map<string, { media: boolean }>();
      const label = (d: string) => { const x = days.get(d); return !x ? "nothing" : x.media ? "photo or video" : "text only"; };
      const care = last7.filter((d) => p.inCareOn(d)), yesterday = addDays(today, -1);
      trainerPosts = {
        today: label(today), yesterday: p.inCareOn(yesterday) ? label(yesterday) : undefined,
        last7Days: { inCare: care.length, withPhotoOrVideo: care.filter((d) => days.get(d)?.media).length, withAnyPost: care.filter((d) => days.has(d)).length }
      };
    }
    const inc = (incBy.get(c.id) || []).map((i) => ({ what: INCIDENT_LABEL[i.kind as keyof typeof INCIDENT_LABEL] || i.kind, since: i.opened_at, taken: i.status === "taken" ? i.taken_by || true : undefined, detail: cut(i.detail, 200) || undefined }));
    const dogs = [...new Set((bookings.get(c.deal_key) || []).filter((b) => b.status !== "cancelled").map((b) => (b.dog_name || "").trim()).filter(Boolean))].join(" & ");
    return {
      id: c.id, dog: c.title || dogs || "Dog", client: c.client_name, trainer: c.trainer_name,
      phase: p.phase, day: p.day, pickup: p.pickup, dropoff: p.dropoff, startsInDays: p.startsInDays, endedDaysAgo: p.endedDaysAgo,
      clientInvited: !!c.invited_at, invitedAt: c.invited_at || undefined, clientOpenedChat: clientRead > 0, clientLastRead: clientRead ? iso(clientRead) : undefined,
      lastMessage: c.last_message_at ? { at: c.last_message_at, from: ROLE[c.last_sender || ""] || c.last_sender, text: cut(c.last_preview, 120) } : null,
      lastClientAt: c.last_client_at, lastTrainerAt: c.last_trainer_at, lastTeamAt: c.last_admin_at,
      hoursSinceTrainer: c.last_trainer_at ? hoursBetween(ms(c.last_trainer_at), now) : null,
      hoursSinceTrainerOrTeam: us ? hoursBetween(us, now) : null,
      waiting, trainerPosts,
      trainerLastRead: trainerRead ? iso(trainerRead) : undefined,
      incidents: inc.length ? inc : undefined,
      link: link(`/a/chats/${c.id}`), hubspot: hubspot(c.deal_key)
    };
  });

  const recent = now - RECENT_HOURS * 3600000;
  const shown = all.filter((x) => o.all || CARE.includes(x.phase) || AHEAD.includes(x.phase) || x.waiting || x.incidents || ms(x.lastMessage?.at) > recent);
  const rank = (x: (typeof all)[number]) => (x.waiting ? 0 : CARE.includes(x.phase) ? 1 : AHEAD.includes(x.phase) ? 2 : 3);
  shown.sort((a, b) => rank(a) - rank(b)
    || (rank(a) === 0 ? ((b.waiting!.hours as number) - (a.waiting!.hours as number)) : 0)
    || (rank(a) === 1 ? ((b.hoursSinceTrainer ?? 1e9) - (a.hoursSinceTrainer ?? 1e9)) : 0)
    || ms(b.lastMessage?.at) - ms(a.lastMessage?.at));
  const CAP = 200;

  // Dogs in care or starting within 7 days whose booking has no open chat
  const openKeys = new Set(chatRows.map((c) => c.deal_key));
  const missing = [...groupBy(comingRows.filter((b) => mine(b.trainers?.name) && !openKeys.has(dealKey(b))), dealKey).values()];
  const closedChats = groupBy(await byIds<{ deal_key: string; closed_at: string | null }>(missing.map((bs) => dealKey(bs[0])), (c, f, t) =>
    sb.from("chats").select("deal_key, closed_at").eq("status", "closed").in("deal_key", c).order("closed_at", { ascending: false }).order("id").range(f, t)), (c) => c.deal_key);
  const noChat = missing.map((bs) => {
    const b = bs[0], p = phaseOf(bs, today), closedAt = closedChats.get(dealKey(b))?.[0]?.closed_at;
    return {
      dog: [...new Set(bs.map((x) => (x.dog_name || "Dog").trim()))].join(" & "), client: b.client_name, trainer: b.trainers?.name || null, phase: p.phase, pickup: p.pickup, dropoff: p.dropoff,
      why: closedChats.has(dealKey(b)) ? `Its chat was closed${closedAt ? ` on ${etDate(ms(closedAt))}` : ""}, so the client and trainer have nowhere to talk. Reopen it, or start a new chat, from the dog's page.`
        : b.hubspot_deal_id ? "No chat yet. The app usually makes one within minutes for dogs in care or starting within 7 days; if this stays, start one from the dog's page."
        : "The booking has no HubSpot deal and no chat. Start one from the dog's page.",
      link: link(`/a/dogs/${b.id}`), hubspot: b.hubspot_deal_id ? hubspot(b.hubspot_deal_id) : undefined
    };
  }).sort((a, b) => (a.pickup || "").localeCompare(b.pickup || ""));

  // Team threads (each trainer's thread with the office)
  const tName = new Map(trainers.map((t) => [t.id, t])), seen = new Set<string>();
  const team = [...teamOldUnread, ...teamRecent].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))).sort((a, b) => ms(a.created_at) - ms(b.created_at) || a.id.localeCompare(b.id));
  const threads = [...groupBy(team, (m) => m.trainer_id).entries()].filter(([id]) => mine(tName.get(id)?.name)).map(([id, msgs]) => {
    const lastOffice = [...msgs].reverse().find((m) => teamFrom(m) === "office");
    const fromTrainer = msgs.filter((m) => m.sender_role === "trainer" && ms(m.created_at) > ms(lastOffice?.created_at));
    const unread = msgs.filter((m) => m.sender_role === "admin" && !m.read_at), people = unread.filter((m) => m.sender_id), last = msgs[msgs.length - 1];
    const since = fromTrainer.length ? ms(fromTrainer[0].created_at) : 0;
    return {
      trainer: tName.get(id)?.name || "Trainer", active: tName.get(id)?.active ?? null, link: link(`/a/messages/${id}`),
      lastMessage: { at: last.created_at, from: teamFrom(last), text: cut(last.body, 160) },
      trainerWaiting: fromTrainer.length ? {
        since: iso(since), hours: hoursBetween(since, now), wakingHours: wakingHoursBetween(since, now), messages: fromTrainer.length,
        unreadByOffice: fromTrainer.filter((m) => !m.read_at).length,
        said: fromTrainer.slice(-3).map((m) => ({ at: m.created_at, text: cut(m.body, 300) }))
      } : undefined,
      officeUnread: unread.length ? { messages: unread.length, automatic: unread.filter((m) => !m.sender_id).length, oldest: unread[0].created_at, hours: hoursBetween(ms(unread[0].created_at), now), ...(people.length ? { oldestFromPerson: people[0].created_at, hoursFromPerson: hoursBetween(ms(people[0].created_at), now) } : {}) } : undefined
    };
  }).filter((t) => (t.active !== false && (t.trainerWaiting || t.officeUnread)) || ms(t.lastMessage.at) > recent)   // inactive trainers only when something is recent
    .sort((a, b) => (b.trainerWaiting ? 1 : 0) - (a.trainerWaiting ? 1 : 0) || (((b.trainerWaiting?.hours as number) || 0) - ((a.trainerWaiting?.hours as number) || 0)) || ms(b.lastMessage.at) - ms(a.lastMessage.at));

  const count = (f: (x: (typeof all)[number]) => boolean) => all.filter(f).length;
  return {
    now: iso(now), today, wakingHours: "8 am to 9 pm Eastern",
    counts: {
      openChats: all.length, inCare: count((x) => x.phase === "in care"), goingHomeToday: count((x) => x.phase === "going home today"),
      startingSoon: count((x) => x.phase === "starting soon"), finished: count((x) => x.phase === "finished"),
      other: count((x) => !["in care", "going home today", "starting soon", "finished"].includes(x.phase)),
      clientWaiting: count((x) => !!x.waiting), shown: Math.min(shown.length, CAP), notShown: all.length - Math.min(shown.length, CAP)
    },
    note: [
      shown.length > CAP ? `Showing the first ${CAP} chats, most urgent first. Give a trainer to narrow it down.` : "",
      !o.all && shown.length < all.length ? `${all.length - shown.length} quiet chats with no dog in care or coming up (finished, cancelled or no booking: no client waiting, nothing in ${RECENT_HOURS} hours) are left out; all: true lists them.` : ""
    ].filter(Boolean).join(" ") || undefined,
    chats: shown.slice(0, CAP),
    noChat: noChat.length ? noChat : undefined,
    teamThreads: threads
  };
}

// ── Recent messages ─────────────────────────────────────────────────────
/** Messages after `since` (up to now), oldest first, grouped by chat; the trainers' team threads too unless `team` is false. */
export async function recentMessages(o: { since: string; now?: Date; trainer?: string; team?: boolean; limit?: number }) {
  // `since` is used exactly as given: a nextSince from an earlier page carries microseconds, which a JavaScript date would lose
  const sb = serviceClient(), now = (o.now || new Date()).getTime(), limit = o.limit || 300, who = (o.trainer || "").trim();
  const since = o.since, until = iso(now);
  let chatIds: string[] | null = null, trainerIds: string[] | null = null;
  if (who) {
    const [cs, ts] = await Promise.all([
      allRows<{ id: string }>((f, t) => sb.from("chats").select("id").ilike("trainer_name", `%${who}%`).gt("last_message_at", since).order("id").range(f, t)),
      allRows<{ id: string }>((f, t) => sb.from("trainers").select("id").ilike("name", `%${who}%`).order("id").range(f, t))
    ]);
    chatIds = cs.map((c) => c.id); trainerIds = ts.map((t) => t.id);
  }
  const MSG_COLS = "id, chat_id, sender_role, sender_name, kind, body, media, created_at";
  const sortTime = <T extends { created_at: string; id: string }>(rows: T[]) => rows.sort((a, b) => micros(a.created_at) - micros(b.created_at) || a.id.localeCompare(b.id));
  const [chatMsgs, teamMsgs] = await Promise.all([
    chatIds
      ? byIds<Msg>(chatIds, (c, f, t) => sb.from("chat_messages").select(MSG_COLS).gt("created_at", since).lte("created_at", until).in("chat_id", c).order("created_at").order("id").range(f, Math.min(t, f + limit))).then(sortTime)
      : allRows<Msg>((f, t) => sb.from("chat_messages").select(MSG_COLS).gt("created_at", since).lte("created_at", until).order("created_at").order("id").range(0, limit), limit + 1),
    o.team === false || (trainerIds && !trainerIds.length) ? Promise.resolve([] as TeamMsg[])
      : trainerIds
        ? byIds<TeamMsg>(trainerIds, (c, f, t) => sb.from("messages").select(TEAM_COLS).gt("created_at", since).lte("created_at", until).in("trainer_id", c).order("created_at").order("id").range(f, Math.min(t, f + limit))).then(sortTime)
        : allRows<TeamMsg>((f, t) => sb.from("messages").select(TEAM_COLS).gt("created_at", since).lte("created_at", until).order("created_at").order("id").range(0, limit), limit + 1)
  ]);
  // When either list is cut off, both stop at the same moment, so the next page (since = nextSince) repeats nothing and misses nothing
  const ends = [chatMsgs.length > limit ? chatMsgs[limit - 1].created_at : "", teamMsgs.length > limit ? teamMsgs[limit - 1].created_at : ""].filter(Boolean);
  const nextSince = ends.sort((a, b) => micros(a) - micros(b))[0] || "";
  const upTo = <T extends { created_at: string }>(rows: T[]) => (nextSince ? rows.filter((m) => micros(m.created_at) <= micros(nextSince)) : rows).slice(0, limit);
  const chatShown = upTo(chatMsgs), teamShown = upTo(teamMsgs);
  const [chatRows, trainers] = await Promise.all([
    byIds<{ id: string; title: string | null; client_name: string | null; trainer_name: string | null; status: string }>(chatShown.map((m) => m.chat_id), (c, f, t) =>
      sb.from("chats").select("id, title, client_name, trainer_name, status").in("id", c).order("id").range(f, t)),
    byIds<Trainer>(teamShown.map((m) => m.trainer_id), (c, f, t) => sb.from("trainers").select("id, name, active").in("id", c).order("id").range(f, t))
  ]);
  const chatOf = new Map(chatRows.map((c) => [c.id, c])), tName = new Map(trainers.map((t) => [t.id, t.name]));
  return {
    since, until,
    chatMessages: chatShown.length, teamMessages: teamShown.length,
    ...(nextSince ? { nextSince, note: `There are more than ${limit} messages since ${since}. Read on with since = nextSince.` } : {}),
    chats: [...groupBy(chatShown, (m) => m.chat_id).entries()].map(([id, msgs]) => {
      const c = chatOf.get(id);
      return {
        chatId: id, dog: c?.title || "Dog", client: c?.client_name || null, trainer: c?.trainer_name || null, chatStatus: c?.status, link: link(`/a/chats/${id}`),
        messages: msgs.map((m) => ({
          id: m.id, at: m.created_at, role: ROLE[m.sender_role] || m.sender_role, from: m.sender_name || ROLE[m.sender_role],
          text: cut(m.body, m.sender_role === "system" ? 160 : 800) || undefined, attachments: attachments(m), kind: m.kind === "report" ? "report" : undefined
        }))
      };
    }),
    teamThreads: [...groupBy(teamShown, (m) => m.trainer_id).entries()].map(([id, msgs]) => ({
      trainer: tName.get(id) || "Trainer", link: link(`/a/messages/${id}`),
      messages: msgs.map((m) => ({ id: m.id, at: m.created_at, from: teamFrom(m), name: m.sender_name || undefined, text: cut(m.body, 800), read: !!m.read_at }))
    }))
  };
}

// ── Trainer scorecard ───────────────────────────────────────────────────
/** For each trainer, the last `days` full days (Eastern, not counting today): daily posts, reply times, the team thread. */
export async function trainerComms(o: { days: number; trainer?: string; now?: Date }) {
  const sb = serviceClient(), now = (o.now || new Date()).getTime(), today = etDate(now), who = (o.trainer || "").toLowerCase();
  const from = addDays(today, -o.days), to = addDays(today, -1);
  const winStart = etAt(from, 0), winEnd = etAt(today, 0), lookBack = iso(winStart - 3 * 86400000);
  const [bookingRows, trainers, msgs, team] = await Promise.all([
    allRows<Booking>((f, t) => sb.from("bookings").select(BOOKING_COLS).neq("status", "cancelled").lte("start_date", today).gte("end_date", from).order("id").range(f, t)),
    allRows<Trainer>((f, t) => sb.from("trainers").select("id, name, active").order("id").range(f, t)),
    allRows<Msg>((f, t) => sb.from("chat_messages").select("id, chat_id, sender_role, kind, media, created_at").gte("created_at", lookBack).order("created_at").order("id").range(f, t), 60000),
    allRows<TeamMsg>((f, t) => sb.from("messages").select("id, trainer_id, sender_id, sender_role, created_at").gte("created_at", lookBack).order("created_at").order("id").range(f, t))
  ]);
  const tName = new Map(trainers.map((t) => [t.id, t]));
  const keys = [...new Set(bookingRows.map(dealKey))];
  type C = { id: string; deal_key: string; trainer_id: string | null; title: string | null; closed_at: string | null; archived_at: string | null };
  const COLS = "id, deal_key, trainer_id, title, closed_at, archived_at";
  const chats = await byIds<C>([...new Set([...msgs.map((m) => m.chat_id)])], (c, f, t) => sb.from("chats").select(COLS).in("id", c).order("id").range(f, t));
  const byKey = await byIds<C>(keys, (c, f, t) => sb.from("chats").select(COLS).in("deal_key", c).order("id").range(f, t));
  const chatOf = new Map([...chats, ...byKey].map((c) => [c.id, c]));
  const chatsForKey = groupBy([...chatOf.values()], (c) => c.deal_key);
  // A chat closed after training is archived to Drive and its messages leave the app: days before that can't be checked here
  const archivedThrough = new Map<string, string>();
  for (const c of chatOf.values()) {
    if (!c.archived_at) continue;
    const d = etDate(ms(c.closed_at || c.archived_at));
    if (d > (archivedThrough.get(c.deal_key) || "")) archivedThrough.set(c.deal_key, d);
  }
  const bookingsForKey = groupBy(bookingRows, dealKey);
  const msgsByChat = groupBy(msgs, (m) => m.chat_id);

  type Score = { careDays: number; photo: number; textOnly: number; nothing: number; noChat: number; archived: number; missed: { dog: string; date: string; posted: string }[]; turns: number; answered: number; byTrainer: number; byTeam: number; replies: number[]; over3: number; over12: number; waiting: number; teamFromTrainer: number; teamFromOffice: number; inCareToday: number };
  const scores = new Map<string, Score>();
  const score = (id: string) => { let s = scores.get(id); if (!s) { s = { careDays: 0, photo: 0, textOnly: 0, nothing: 0, noChat: 0, archived: 0, missed: [], turns: 0, answered: 0, byTrainer: 0, byTeam: 0, replies: [], over3: 0, over12: 0, waiting: 0, teamFromTrainer: 0, teamFromOffice: 0, inCareToday: 0 }; scores.set(id, s); } return s; };

  // Daily posts: one per chat per day a dog is in care (pickup day up to the night before drop-off)
  const posted = new Map<string, { media: boolean }>();      // "<deal key>|<date>"
  for (const m of msgs) {
    if (m.sender_role !== "trainer") continue;
    const c = chatOf.get(m.chat_id);
    if (!c) continue;
    const k = `${c.deal_key}|${etDate(ms(m.created_at))}`;
    posted.set(k, { media: (posted.get(k)?.media || false) || hasPhotoOrVideo(m) });
  }
  const careDone = new Set<string>();
  for (const b of bookingRows) {
    if (b.start_date <= today && today < b.end_date) score(b.trainer_id).inCareToday++;
    for (let d = b.start_date < from ? from : b.start_date; d <= to && d <= lastDay(b); d = addDays(d, 1)) {
      const k = `${dealKey(b)}|${d}`;
      if (careDone.has(`${b.trainer_id}|${k}`)) continue;     // two dogs on one deal share one chat: one post a day covers both
      careDone.add(`${b.trainer_id}|${k}`);
      const s = score(b.trainer_id), dog = chatsForKey.get(dealKey(b))?.[0]?.title || b.dog_name || "Dog";
      s.careDays++;
      if (!chatsForKey.get(dealKey(b))?.length) { s.noChat++; continue; }
      if (d <= (archivedThrough.get(dealKey(b)) || "")) { s.archived++; continue; }
      const p = posted.get(k);
      if (p?.media) s.photo++;
      else { if (p) s.textOnly++; else s.nothing++; s.missed.push({ dog, date: d, posted: p ? "text only" : "nothing" }); }
    }
  }

  // Client messages: each run of client messages is one turn, answered by the next message from the trainer or the team
  const trainerOn = (key: string, d: string, fallback: string | null) =>
    (bookingsForKey.get(key) || []).find((b) => b.start_date <= d && d < b.end_date)?.trainer_id || fallback;    // on a trainer-change day the dog is with the new trainer
  for (const [chatId, list] of msgsByChat) {
    const c = chatOf.get(chatId);
    if (!c) continue;
    let open: number | null = null;
    const close = (replyAt: number | null, by: string | null) => {
      if (open === null || open < winStart || open >= winEnd) { open = null; return; }
      const t = trainerOn(c.deal_key, etDate(open), c.trainer_id);
      if (!t) { open = null; return; }
      const s = score(t);
      s.turns++;
      if (replyAt === null) s.waiting++;
      else {
        const wh = wakingHoursBetween(open, replyAt);
        s.answered++; s.replies.push(wh);
        if (by === "trainer") s.byTrainer++; else s.byTeam++;
        if (wh > 3) s.over3++;
        if (replyAt - open > 12 * 3600000) s.over12++;
      }
      open = null;
    };
    for (const m of list) {
      if (m.sender_role === "client") { if (open === null) open = ms(m.created_at); }
      else if (m.sender_role === "trainer" || m.sender_role === "admin") close(ms(m.created_at), m.sender_role);
    }
    close(null, null);
  }

  for (const m of team) {
    if (ms(m.created_at) < winStart || ms(m.created_at) >= winEnd) continue;
    if (m.sender_role === "trainer") score(m.trainer_id).teamFromTrainer++;
    else if (m.sender_id) score(m.trainer_id).teamFromOffice++;
  }

  const rows = [...scores.entries()].filter(([id]) => mine(tName.get(id)?.name)).map(([id, s]) => ({
    trainer: tName.get(id)?.name || "Trainer", active: tName.get(id)?.active ?? null, dogsInCareToday: s.inCareToday,
    dailyUpdates: { daysInCare: s.careDays, withPhotoOrVideo: s.photo, textOnly: s.textOnly, nothing: s.nothing, noChat: s.noChat || undefined, chatArchived: s.archived || undefined, missed: s.missed.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20) },
    clientMessages: {
      turns: s.turns, answered: s.answered, answeredByTrainer: s.byTrainer, answeredByTeam: s.byTeam, stillWaiting: s.waiting,
      medianReplyWakingHours: median(s.replies), longestReplyWakingHours: s.replies.length ? Math.max(...s.replies) : null,
      overThreeWakingHours: s.over3, overTwelveHours: s.over12
    },
    teamThread: { fromTrainer: s.teamFromTrainer, fromOffice: s.teamFromOffice }
  })).filter((r) => who || r.dailyUpdates.daysInCare || r.clientMessages.turns || r.teamThread.fromTrainer)
    .sort((a, b) => (b.dailyUpdates.textOnly + b.dailyUpdates.nothing + b.clientMessages.overThreeWakingHours) - (a.dailyUpdates.textOnly + a.dailyUpdates.nothing + a.clientMessages.overThreeWakingHours) || a.trainer.localeCompare(b.trainer));
  function mine(name: string | null | undefined) { return !who || (name || "").toLowerCase().includes(who); }
  return {
    from, to, days: o.days,
    standard: "A photo or video in the dog's chat every day it is in care (pickup day up to the night before drop-off); reply to clients within 2 to 3 hours. Waking hours are 8 am to 9 pm Eastern.",
    note: "A turn is a client message (or several in a row) and the first reply after it from the trainer or the team. Turns are counted for the trainer who had the dog that day, or the chat's trainer after training. chatArchived: days whose chat was closed and archived to Drive, so they can't be checked here (and their client messages aren't counted).",
    trainers: rows
  };
}
