import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { RULES, answeredUpTo, etDay, etParts, inCareDay, needsUpdateOn } from "./chatRules";
import { etAt, wakingHoursBetween } from "./commsTime";
import { addDays } from "./dates";
import { pushToTrainer } from "./push";
import { mailConfigured, sendMail } from "./mail";
import { fromFor, loadPocNumbers, quoConfigured, sendText, toE164, type PocNumbers } from "./quo";
import { raiseIncident, resolveIncidents } from "./incidents";
import { localParts, trainerZone } from "./moveRules";
import { kindName, todos, type BookingForReports, type Kind, type RowLike } from "./reports";
import { BRAND_LOGO_PNG_BASE64 } from "./brandLogo";
import { needsStats, pendingFor } from "./clientNeeds";

// The reminder ladder (migration 049). The app reminds the trainer itself, and hands a thing to the office only when
// the trainer hasn't acted after 2 reminders. Runs with the 10-minute chat check (lib/chatOps.ts). Every step is a row
// in `nudges`, so To do shows the history, Pulse grades trainers on how much chasing they needed, and Claude can read it.
//
//   Daily update     6 PM Eastern: reminder for each dog with no post yet today · next day 6 PM: reminder 2
//                    · 8 PM that day (2 days missed): "trainer silent" on To do, to call the trainer
//   Client waiting   3 waking hours: reminder · 6 waking hours: reminder 2 · 12 waking hours: on To do, as before
//   Late form        10 AM the morning after the deadline: reminder · next morning: reminder 2 · the morning after: on To do
//
// Reminder 1 is a phone notification (a text, or an email, if the trainer's phone doesn't get the app's notifications).
// Reminder 2 is a notification and a text. Nothing goes to a trainer outside 8 AM to 9 PM their time.
// Everything closes itself when the post, reply or form comes in. NUDGES=off in Vercel stops the ladder.

export type NudgeKind = "update_due" | "client_waiting" | "form_late";
export type Nudge = {
  id: string; ref: string; kind: NudgeKind; step: number | null; by: string; trainer_id: string | null; chat_id: string | null; booking_id: string | null;
  channels: string[]; body: string | null; suggested: string | null; edited: boolean | null; error: string | null; sent_at: string; done_at: string | null; outcome: string | null;
};
export const LADDER = { updateHour: RULES.updateReminderHour, cutoffHour: RULES.trainerUpdateByHour, waiting: [3, 6], gapHours: 2, formHour: 10, wakeFrom: 8, wakeTo: 21 };
export const nudgesOn = () => (process.env.NUDGES || "").trim().toLowerCase() !== "off";

const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const ms = (v: string | null | undefined) => (v ? Date.parse(v) : 0);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const first = (name: string) => name.replace(/".*?"\s*/, "").split(" ")[0] || name;
export const dayName = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
/** "Tue 6:02 PM" (Eastern) */
export const etWhen = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
const clip = (s: string | null | undefined, n: number) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] || "");

type Trainer = { id: string; name: string; phone: string | null; email: string | null; dogwise_email: string | null; state: string | null; poc?: string | null };
type Chat = { id: string; deal_key: string; trainer_id: string | null; title: string | null; client_name: string | null; quiet_at: string | null; last_trainer_at: string | null; last_client_at: string | null; last_reply_at: string | null; last_admin_at?: string | null; reply_waived_at?: string | null };
type Bk = { id: string; hubspot_deal_id: string | null; trainer_id: string; dog_name: string | null; client_name: string; start_date: string; end_date: string; status: string; picked_up_at?: string | null };
type Want = { ref: string; kind: NudgeKind; step: 1 | 2; trainer: Trainer; chatId?: string; bookingId?: string; line: string; url: string; who?: string; one?: string };

/** The trainer's own clock says it's daytime (8 AM to 9 PM). */
const awake = (t: Trainer, now: Date) => { const h = localParts(trainerZone(t.state), now).hour; return h >= LADDER.wakeFrom && h < LADDER.wakeTo; };

/** Inserts each row only if that step hasn't gone yet (unique ref + step), so two runs can never send it twice. */
async function claim(sb: SupabaseClient, rows: Partial<Nudge>[]): Promise<Nudge[]> {
  const got: Nudge[] = [];
  for (const r of rows) {
    const { data, error } = await sb.from("nudges").insert(r).select("*").maybeSingle();
    if (!error && data) got.push(data as Nudge);
  }
  return got;
}

/** One message to a trainer: a phone notification, and a text (or email) when it's reminder 2 or the notification didn't reach a phone. */
async function deliver(t: Trainer, m: { title: string; body: string; url: string; tag: string; second: boolean }, nums: PocNumbers): Promise<{ channels: string[]; error: string | null }> {
  const channels: string[] = [], errs: string[] = [];
  const pushed = await pushToTrainer(t.id, { title: m.title, body: m.body, url: m.url, tag: m.tag }).catch(() => 0);
  if (pushed) channels.push("push");
  if (!m.second && pushed) return { channels, error: null };
  const link = `${site()}${m.url}`;
  if (quoConfigured() && toE164(t.phone)) {
    const r = await sendText(t.phone!, `Dogwise: ${m.title}. ${m.body} ${link}`, fromFor(t.poc, nums).from); // from their POC's own Quo number when it's set
    if (r.ok) channels.push("text"); else errs.push(`text: ${r.error}`);
  }
  const to = t.email || t.dogwise_email;
  if (!channels.includes("text") && to && mailConfigured()) {
    try {
      await sendMail({
        to, subject: m.title, text: `Hi ${first(t.name)},\n\n${m.body}\n\nOpen the app: ${link}`,
        html: `<div style="background:#f4f5f8;padding:24px 12px;font-family:Arial,sans-serif"><div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E7E3F3;border-radius:16px;padding:24px"><img src="cid:dogwise-logo" width="130" alt="Dogwise Academy" style="display:block;margin-bottom:14px"><p style="font-size:16px;font-weight:bold;color:#281870;margin:0 0 8px">Hi ${esc(first(t.name))}, ${esc(m.title.charAt(0).toLowerCase() + m.title.slice(1))}</p><p style="font-size:15px;color:#333;line-height:1.5;margin:0 0 18px">${esc(m.body)}</p><a href="${link}" style="background:#281870;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:bold;display:inline-block">Open the app</a></div></div>`,
        attachments: [{ filename: "dogwise.png", content: Buffer.from(BRAND_LOGO_PNG_BASE64, "base64"), contentType: "image/png", cid: "dogwise-logo" }]
      });
      channels.push("email");
    } catch (e) { errs.push(`email: ${(e as Error).message}`); }
  }
  return { channels, error: errs.join("; ") || null };
}

/** Claims each trainer's due steps, then sends them ONE message covering all of them. */
async function sendGrouped(sb: SupabaseClient, wants: Want[], now: Date, nums: PocNumbers, msg: (t: Trainer, items: Want[]) => { title: string; body: string; url: string; tag: string }) {
  let sent = 0;
  const byTrainer = new Map<string, Want[]>();
  for (const w of wants) if (awake(w.trainer, now)) byTrainer.set(w.trainer.id, [...(byTrainer.get(w.trainer.id) || []), w]);
  for (const items of byTrainer.values()) {
    const t = items[0].trainer;
    const got = await claim(sb, items.map((w) => ({ ref: w.ref, kind: w.kind, step: w.step, by: "app", trainer_id: t.id, chat_id: w.chatId || null, booking_id: w.bookingId || null })));
    if (!got.length) continue;
    const mine = items.filter((w) => got.some((g) => g.ref === w.ref && g.step === w.step));
    const m = msg(t, mine);
    const r = await deliver(t, { ...m, second: mine.some((w) => w.step === 2) }, nums);
    await sb.from("nudges").update({ channels: r.channels, body: `${m.title}. ${m.body}`.slice(0, 1000), error: r.error }).in("id", got.map((g) => g.id));
    sent += got.length;
  }
  return sent;
}

/** Runs the ladder. Never throws. */
export async function runNudges(now = new Date(), sb: SupabaseClient = serviceClient()) {
  const out = { reminded: 0, toOffice: 0, closed: 0, errors: [] as string[] };
  if (!nudgesOn()) return out;
  try {
    const { data: openRows, error } = await sb.from("nudges").select("*").is("done_at", null).limit(3000);
    if (error) { if (!/nudges|schema cache|does not exist/i.test(error.message)) out.errors.push(error.message); return out; } // migration 049 not run yet
    const open = (openRows || []) as Nudge[];
    // The old nightly "hasn't posted today" items (from before the reminders, opened without a ref): the reminders replace
    // them. A dog with no update now comes back to To do after 2 missed days, with its history.
    await sb.from("chat_incidents").update({ status: "resolved", resolved_at: now.toISOString(), resolved_by: "automatic", auto_resolved: true,
      resolved_note: "Replaced by the reminders: the trainer is reminded first, and it's back on To do after 2 missed days" })
      .eq("kind", "trainer_silent").is("ref", null).neq("status", "resolved");
    const steps = new Map<string, Nudge[]>();
    for (const n of open) steps.set(n.ref, [...(steps.get(n.ref) || []), n]);
    const stepOf = (ref: string, s: number) => (steps.get(ref) || []).find((n) => n.step === s);
    const { date: today, hour } = etParts(now);
    const nums = await loadPocNumbers(sb); // each admin's own Quo number, for the trainers they're POC for

    const [{ data: cr, error: chatErr }, { data: tr }] = await Promise.all([
      sb.from("chats").select("*").eq("status", "open"),
      sb.from("trainers").select("id, name, phone, email, dogwise_email, state, poc")
    ]);
    if (chatErr) { out.errors.push(chatErr.message); return out; } // never close anything on a failed read
    const chats = (cr || []) as Chat[], chatById = new Map(chats.map((c) => [c.id, c]));
    const trainers = new Map(((tr || []) as Trainer[]).map((t) => [t.id, t]));
    const keys = chats.map((c) => c.deal_key);
    const bks: Bk[] = [];
    if (keys.length) {
      const sel = "id, hubspot_deal_id, trainer_id, dog_name, client_name, start_date, end_date, status, picked_up_at";
      const [a, b] = await Promise.all([
        sb.from("bookings").select(sel).in("hubspot_deal_id", keys).neq("status", "cancelled").gte("end_date", addDays(today, -2)),
        sb.from("bookings").select(sel).in("id", keys.filter((k) => /^[0-9a-f-]{36}$/i.test(k))).neq("status", "cancelled").gte("end_date", addDays(today, -2))
      ]);
      bks.push(...((a.data || []) as Bk[]), ...((b.data || []) as Bk[]));
    }
    const bookingsOf = (c: Chat) => bks.filter((b) => (b.hubspot_deal_id || b.id) === c.deal_key);
    /** Dogs in this chat that need an update today: in care, and actually picked up if today is pickup day. */
    const dueToday = (c: Chat) => bookingsOf(c).filter((b) => needsUpdateOn(b, today));
    const dogsOf = (c: Chat, bs: Bk[]) => [...new Set(bs.map((b) => (b.dog_name || "").trim()).filter(Boolean))].join(" & ") || c.title || "your dog";
    const live = (c: Chat | undefined): c is Chat => !!c && !c.quiet_at && !!c.trainer_id;

    // ── Late forms (worked out every run, so a form that comes in closes its reminders straight away) ──
    const { data: fb } = await sb.from("bookings").select("id, trainer_id, client_name, dog_name, start_date, end_date, weeks, status, reports_enabled").eq("reports_enabled", true).neq("status", "cancelled").gte("end_date", addDays(today, -30));
    const formBookings = (fb || []) as BookingForReports[];
    const reps: RowLike[] = [];
    for (let i = 0; i < formBookings.length; i += 150) {
      const { data } = await sb.from("reports").select("id, booking_id, kind, week_number, status, submitted_at, due_by").in("booking_id", formBookings.slice(i, i + 150).map((b) => b.id));
      reps.push(...((data || []) as RowLike[]));
    }
    const late = todos(formBookings, reps, now).filter((t) => t.state === "overdue" && !t.beforeApp);
    const formRef = (bookingId: string, kind: Kind, week: number) => `form:${bookingId}:${kind}:${week}`;
    const lateRefs = new Set(late.map((t) => formRef(t.booking.id, t.window.kind, t.window.week)));

    // ── 1. Close what's been done (or isn't needed any more) ──
    for (const [ref, rows] of steps) {
      const n = rows[0];
      let done: string | null = null, gone = false;
      if (n.kind === "update_due") {
        const c = chatById.get(n.chat_id || ""), since = ref.split(":")[2] || "none";
        if (c?.last_trainer_at && (since === "none" || etDay(c.last_trainer_at) > since)) done = c.last_trainer_at;
        else if (!live(c) || (!dueToday(c).length && !bookingsOf(c).some((b) => inCareDay(b, addDays(today, -1))))) gone = true;
        if (done || gone) await resolveIncidents({ kinds: ["trainer_silent"], ref: `nudge:${ref}` }, "automatic", done ? "The trainer posted" : "Not needed any more", sb).catch(() => null);
      } else if (n.kind === "client_waiting") {
        const c = chatById.get(n.chat_id || ""), firstAt = ref.slice(ref.indexOf(":", 8) + 1);
        const ans = c ? answeredUpTo(c) : null;
        if (ans && ms(ans) > ms(firstAt)) done = ans;
        else if (!live(c)) gone = true;
        else if (!(await pendingFor(sb, c.id, ans)).length) gone = true; // labelled "no reply needed" or an office question
      } else if (n.kind === "form_late" && !lateRefs.has(ref)) {
        const [, bookingId, kind, week] = ref.split(":");
        const r = reps.find((x) => x.booking_id === bookingId && x.kind === kind && x.week_number === Number(week));
        if (r && (r.status === "submitted" || r.status === "approved")) done = r.submitted_at || now.toISOString(); else gone = true;
        await resolveIncidents({ kinds: ["form_chase"], ref: `nudge:${ref}` }, "automatic", done ? "The form came in" : "Not needed any more", sb).catch(() => null);
      }
      if (done || gone) {
        await sb.from("nudges").update({ done_at: done || now.toISOString(), outcome: done ? "done" : "gone" }).eq("ref", ref).is("done_at", null);
        steps.delete(ref); out.closed++;
      }
    }

    // ── 2. Daily updates: 6 PM reminders, and the office after 2 missed days ──
    const updates: (Want & { since: string })[] = [];
    for (const c of chats) {
      if (!live(c)) continue;
      const bs = dueToday(c);
      if (!bs.length || etDay(c.last_trainer_at) === today) continue;
      const t = trainers.get(c.trainer_id!); if (!t) continue;
      const since = etDay(c.last_trainer_at) || "none", ref = `update:${c.id}:${since}`;
      const s1 = stepOf(ref, 1), s2 = stepOf(ref, 2), s3 = stepOf(ref, 3), dog = dogsOf(c, bs);
      if (hour >= LADDER.updateHour && hour < LADDER.cutoffHour) {
        if (!s1) updates.push({ ref, kind: "update_due", step: 1, trainer: t, chatId: c.id, line: dog, url: `/t/chats/${c.id}`, since });
        else if (!s2 && etDay(s1.sent_at) < today) updates.push({ ref, kind: "update_due", step: 2, trainer: t, chatId: c.id, line: dog, url: `/t/chats/${c.id}`, since });
      }
      if (s2 && !s3 && (etDay(s2.sent_at) < today || hour >= LADDER.cutoffHour)) {
        const got = await claim(sb, [{ ref, kind: "update_due", step: 3, by: "app", trainer_id: t.id, chat_id: c.id, channels: ["office"], body: "On To do: call the trainer" }]);
        if (got.length) {
          const when = [stepOf(ref, 1), s2].filter(Boolean).map((x) => etWhen(x!.sent_at)).join(" and ");
          await raiseIncident({ kind: "trainer_silent", chatId: c.id, ref: `nudge:${ref}`, title: `${dog} (${c.client_name || "client"}), ${t.name}`,
            detail: `No update about ${dog} since ${since === "none" ? "pickup" : dayName(since)}. Reminded ${when}.` }, sb);
          out.toOffice++;
        }
      }
    }
    out.reminded += await sendGrouped(sb, updates, now, nums, (t, items) => {
      const behind = items.filter((w) => w.step === 2) as typeof updates, fresh = items.filter((w) => w.step === 1);
      const zone = trainerZone(t.state);
      const cutoff = zone === "America/New_York" ? "8 PM" : `8 PM Eastern (${new Date(etAt(today, LADDER.cutoffHour)).toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric" })} your time)`;
      const parts = [
        fresh.length ? `Still to post today: ${list(fresh.map((w) => w.line))}.` : "",
        behind.length ? `${list(behind.map((w) => w.line))}: no update since ${behind[0].since === "none" ? "pickup" : dayName(behind[0].since)}.` : ""
      ].filter(Boolean);
      return { title: behind.length ? "Updates missing" : "Today's updates", body: `${parts.join(" ")} Each client gets a photo or video every day, by ${cutoff}.`, url: items.length === 1 ? items[0].url : "/t", tag: "updates" };
    });

    // ── 3. Clients waiting for a reply ──
    const waitingChats = chats.filter((c) => live(c) && c.last_client_at && ms(c.last_client_at) > ms(answeredUpTo(c)));
    const { data: incs } = waitingChats.length ? await sb.from("chat_incidents").select("chat_id").in("kind", ["client_waiting", "client_pileup"]).neq("status", "resolved").in("chat_id", waitingChats.map((c) => c.id)) : { data: [] };
    const officeHas = new Set(((incs || []) as { chat_id: string }[]).map((i) => i.chat_id));
    const waits: Want[] = [];
    for (const c of waitingChats) {
      const t = trainers.get(c.trainer_id!); if (!t) continue;
      // Only what needs the trainer: not "thanks" or "yes, that's perfect", not an office question (lib/clientNeeds.ts)
      const msgs = await pendingFor(sb, c.id, answeredUpTo(c));
      if (!msgs.length) continue;
      const firstAt = msgs[0].created_at, lastMsg = msgs[msgs.length - 1], ref = `waiting:${c.id}:${firstAt}`;
      const h = wakingHoursBetween(ms(firstAt), now.getTime());
      const s1 = stepOf(ref, 1), s2 = stepOf(ref, 2), s3 = stepOf(ref, 3);
      const said = lastMsg.body ? `“${clip(lastMsg.body, 90)}”` : "sent a photo or file";
      const who = c.client_name || "A client", dog = dogsOf(c, bookingsOf(c)), line = `${who} about ${dog}, ${Math.floor(h)} h: ${said}`, one = `About ${dog}, waiting ${Math.floor(h)} h: ${said}`;
      if (!s1 && h >= LADDER.waiting[0]) waits.push({ ref, kind: "client_waiting", step: 1, trainer: t, chatId: c.id, line, url: `/t/chats/${c.id}`, who, one });
      else if (s1 && !s2 && h >= LADDER.waiting[1] && now.getTime() - ms(s1.sent_at) >= LADDER.gapHours * 3600e3) waits.push({ ref, kind: "client_waiting", step: 2, trainer: t, chatId: c.id, line, url: `/t/chats/${c.id}`, who, one });
      if (!s3 && officeHas.has(c.id)) {
        if ((await claim(sb, [{ ref, kind: "client_waiting", step: 3, by: "app", trainer_id: t.id, chat_id: c.id, channels: ["office"], body: "On To do: client waiting" }])).length) out.toOffice++;
      }
    }
    out.reminded += await sendGrouped(sb, waits, now, nums, (_t, items) => ({
      title: items.length === 1 ? `${items[0].who} is waiting for you` : `${items.length} clients are waiting for you`,
      body: items.length === 1 ? items[0].one || items[0].line : items.map((w) => w.line).join(" · "), url: items.length === 1 ? items[0].url : "/t", tag: "waiting"
    }));

    // ── 4. Late forms: the mornings after the deadline, then the office ──
    if (hour >= LADDER.formHour && hour < LADDER.cutoffHour) {
      const forms: Want[] = [];
      for (const f of late) {
        const t = trainers.get(f.booking.trainer_id); if (!t) continue;
        const ref = formRef(f.booking.id, f.window.kind, f.window.week);
        const s1 = stepOf(ref, 1), s2 = stepOf(ref, 2), s3 = stepOf(ref, 3);
        const name = `${f.booking.dog_name || "the dog"}'s ${kindName(f.window.kind).toLowerCase()}${f.window.kind === "weekly" ? ` (week ${f.window.week})` : ""}`;
        const url = f.report?.id ? `/t/reports/${f.report.id}` : `/t/reports/new?booking=${f.booking.id}&kind=${f.window.kind}&week=${f.window.week}`;
        const line = `${name}, due ${dayName(f.window.deadline)}`;
        if (!s1) forms.push({ ref, kind: "form_late", step: 1, trainer: t, bookingId: f.booking.id, line, url });
        else if (!s2 && etDay(s1.sent_at) < today) forms.push({ ref, kind: "form_late", step: 2, trainer: t, bookingId: f.booking.id, line, url });
        else if (s2 && !s3 && etDay(s2.sent_at) < today) {
          const got = await claim(sb, [{ ref, kind: "form_late", step: 3, by: "app", trainer_id: t.id, booking_id: f.booking.id, channels: ["office"], body: "On To do: form late after 2 reminders" }]);
          if (got.length) {
            await raiseIncident({ kind: "form_chase", bookingId: f.booking.id, ref: `nudge:${ref}`, title: `${name}, ${t.name}`,
              detail: `${cap(name)} was due ${dayName(f.window.deadline)}. Reminded ${etWhen(s1!.sent_at)} and ${etWhen(s2.sent_at)}.` }, sb);
            out.toOffice++;
          }
        }
      }
      out.reminded += await sendGrouped(sb, forms, now, nums, (_t, items) => ({
        title: items.length === 1 ? "A form is late" : `${items.length} forms are late`,
        body: `${items.map((w) => cap(w.line)).join(" · ")}. Please send ${items.length === 1 ? "it" : "them"} today.`,
        url: items.length === 1 ? items[0].url : "/t/reports", tag: "forms-late"
      }));
    }
  } catch (e) { out.errors.push((e as Error).message); }
  return out;
}

// ── For To do (the office's check-in) and the Claude connector ─────────────
/** An item on To do that's been handed to the office: what the app already did, and what the office can send. */
export type ChaseInfo = {
  ref: string | null; kind: NudgeKind; trainerId: string; trainerName: string; phone: string | null; chatId: string | null; bookingId: string | null;
  history: string[]; suggested: string; canText: boolean;
};
const CH: Record<string, string> = { push: "phone", text: "text", email: "email", app: "app", call: "call", office: "To do" };
/** "Tue 6:02 PM: reminder 1 (phone, text)" / "Wed 9:14 AM: Anita texted". Oldest first. */
export function historyLines(rows: Nudge[]): string[] {
  return [...rows].sort((a, b) => ms(a.sent_at) - ms(b.sent_at)).map((n) => {
    const when = etWhen(n.sent_at);
    if (n.step === 3) return `${when}: handed to the office`;
    if (n.step) return `${when}: reminder ${n.step}${n.channels.length ? ` (${n.channels.map((c) => CH[c] || c).join(", ")})` : " (didn't reach them)"}`;
    const how = n.channels.includes("call") ? "called" : n.channels.includes("text") ? "texted" : "sent a check-in in the app";
    return `${when}: ${n.by} ${how}`;
  });
}
/** What the office could send the trainer. A person edits it before sending; whether they did is recorded. */
export function suggestCheckIn(kind: NudgeKind, o: { trainer: string; dog: string; client: string; since?: string; hours?: number; form?: string }): string {
  const hi = `Hi ${first(o.trainer)}`;
  if (kind === "update_due") return `${hi}, ${o.client} hasn't had an update on ${o.dog} since ${o.since || "a couple of days ago"}. Could you post a photo or video in ${o.dog}'s chat today? Thanks!`;
  if (kind === "client_waiting") return `${hi}, ${o.client} has been waiting${o.hours ? ` about ${o.hours} hours` : ""} for a reply about ${o.dog}. Could you answer in ${o.dog}'s chat now? Thanks!`;
  return `${hi}, ${o.form || "a form"} for ${o.dog} is late. Could you send it today? Thanks!`;
}
/** Open nudges by ref and by chat, for To do. */
export async function openNudges(sb: SupabaseClient = serviceClient()): Promise<Nudge[]> {
  const { data, error } = await sb.from("nudges").select("*").is("done_at", null).order("sent_at").limit(3000);
  return error ? [] : ((data || []) as Nudge[]);
}

// ── For Claude (the connector's "reminders" tool) ──────────────────────────
const KIND_LABEL: Record<NudgeKind, string> = { update_due: "Daily update", client_waiting: "Client waiting for a reply", form_late: "Late form" };
export const LADDER_TEXT = "The app reminds trainers itself. Daily update: 6 PM Eastern reminder for each dog with no post yet that day, a second at 6 PM the next day, then the office (To do: call the trainer) at 8 PM after 2 missed days. Client waiting: reminders at 3 and 6 waking hours (8 AM to 9 PM Eastern), the office at 12 waking hours. Late form: reminders the 2 mornings after the deadline, the office the morning after that. Reminder 1 is a phone notification (a text or email if their phone doesn't get the app's notifications); reminder 2 adds a text. Nothing goes to a trainer outside 8 AM to 9 PM their time. Everything clears itself when the post, reply or form comes in. People's check-ins from To do (in the app, as a text, or a call) are logged with whether the app's suggested message was used as it was.";

/** What the ladder did over the last days: what's still open (and at which step), how each trainer responded, and the office's check-ins. */
export async function nudgeReport(o: { days: number; trainer?: string }, sb: SupabaseClient = serviceClient()) {
  const since = new Date(Date.now() - o.days * 86400e3).toISOString();
  const { data, error } = await sb.from("nudges").select("*").gte("sent_at", since).order("sent_at").limit(5000);
  if (error) {
    if (/nudges|schema cache|does not exist/i.test(error.message)) return { how: LADDER_TEXT, note: "The reminders aren't switched on yet (migration 049 hasn't been run).", open: [], byTrainer: [], checkIns: null };
    throw new Error(error.message);
  }
  const rows = (data || []) as Nudge[];
  const chatIds = [...new Set(rows.map((r) => r.chat_id).filter(Boolean))] as string[], bookingIds = [...new Set(rows.map((r) => r.booking_id).filter(Boolean))] as string[];
  const none = Promise.resolve({ data: [] as unknown[] });
  const [{ data: tr }, { data: ch }, { data: bk }] = await Promise.all([
    sb.from("trainers").select("id, name"),
    chatIds.length ? sb.from("chats").select("id, title, client_name").in("id", chatIds) : none,
    bookingIds.length ? sb.from("bookings").select("id, dog_name, client_name").in("id", bookingIds) : none
  ]);
  const tName = new Map(((tr || []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  const chat = new Map(((ch || []) as { id: string; title: string | null; client_name: string | null }[]).map((c) => [c.id, c]));
  const bkg = new Map(((bk || []) as { id: string; dog_name: string | null; client_name: string }[]).map((b) => [b.id, b]));
  const want = (o.trainer || "").toLowerCase();
  const mine = rows.filter((r) => !want || (tName.get(r.trainer_id || "") || "").toLowerCase().includes(want));
  const refs = new Map<string, Nudge[]>();
  for (const r of mine) refs.set(r.ref, [...(refs.get(r.ref) || []), r]);
  const site_ = site();
  const about = (r: Nudge) => { const c = r.chat_id ? chat.get(r.chat_id) : null, b = r.booking_id ? bkg.get(r.booking_id) : null; return c ? `${c.title || "Dog"} (${c.client_name || "client"})` : b ? `${b.dog_name || "Dog"} (${b.client_name})` : ""; };
  const linkOf = (r: Nudge) => (r.chat_id ? `${site_}/a/chats/${r.chat_id}` : r.booking_id ? `${site_}/a/dogs/${r.booking_id}` : undefined);

  const open: Record<string, unknown>[] = [];
  const per = new Map<string, { trainer: string; reminders: number; doneAfterReminder1: number; doneAfterReminder2: number; doneAfterOffice: number; stillOpen: number; noLongerNeeded: number }>();
  for (const [, list] of refs) {
    const app = list.filter((r) => r.step), top = Math.max(0, ...app.map((r) => r.step || 0)), r0 = list[0];
    if (!r0.trainer_id || !app.length) continue;
    const p = per.get(r0.trainer_id) || { trainer: tName.get(r0.trainer_id) || "", reminders: 0, doneAfterReminder1: 0, doneAfterReminder2: 0, doneAfterOffice: 0, stillOpen: 0, noLongerNeeded: 0 };
    p.reminders += app.filter((r) => (r.step || 0) < 3).length;
    const done = list.find((r) => r.done_at);
    if (!done) p.stillOpen++;
    else if (done.outcome === "gone") p.noLongerNeeded++;
    else if (top >= 3) p.doneAfterOffice++; else if (top === 2) p.doneAfterReminder2++; else p.doneAfterReminder1++;
    per.set(r0.trainer_id, p);
    if (!done) open.push({ what: KIND_LABEL[r0.kind], trainer: tName.get(r0.trainer_id) || "", about: about(r0) || undefined, stage: top >= 3 ? "with the office" : `reminder ${top} sent`, history: historyLines(list), link: linkOf(r0) });
  }
  const people = mine.filter((r) => !r.step);
  const byPerson: Record<string, number> = {};
  for (const r of people) byPerson[r.by] = (byPerson[r.by] || 0) + 1;
  const written = people.filter((r) => r.suggested != null);
  return {
    how: LADDER_TEXT, days: o.days,
    clientMessages: await needsStats(sb, since).catch(() => null), // who had to act on clients' messages, and how often people changed the app's answer
    open: open.reverse(),
    byTrainer: [...per.values()].sort((a, b) => b.reminders - a.reminders || a.trainer.localeCompare(b.trainer)),
    checkIns: {
      total: people.length, inApp: people.filter((r) => r.channels.includes("app")).length, texts: people.filter((r) => r.channels.includes("text")).length, calls: people.filter((r) => r.channels.includes("call")).length,
      suggestedMessageSentAsIs: written.filter((r) => r.edited === false).length, suggestedMessageEdited: written.filter((r) => r.edited === true).length, byPerson
    }
  };
}
