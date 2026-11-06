import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { availability } from "./availability";
import { laneFor, preferred, programNights, type Lane, type Reason } from "./lanes";
import { raiseIncident, resolveIncidents } from "./incidents";
import { sendMail, mailConfigured } from "./mail";
import { addDays, short, todayIso } from "./dates";
import { auditSystem } from "./audit";

// Assign or Ask, with real data: the closest trainers for a deal and the lane each one is in (lib/lanes.ts), the check
// every booking passes (app and Sales Assistant), and the asks: "Check with the trainer" (the POC on shift) and
// "Ask Pedro" (probation, out of range). Tables: trainers.status_board / program_types, booking_asks, bookings.lane (048).

export type DealCtx = { dealId?: string | null; zip?: string | null; start: string | null; end: string | null; program?: string | null; dogs: number; dogNames?: string[]; client?: string; soldOn?: string | null };
export type Ask = { id: string; kind: "offer" | "pedro"; status: string; deadline: string | null; created_at: string; trainer_id: string };
export type LaneRow = { id: string; name: string; place: string; straight: number | null; route: number | null; range: number; lane: Lane; reasons: Reason[]; hours: number | null; preferred: boolean; ask: Ask | null; opening: string };

type T = { id: string; name: string; active: boolean; status_board?: string | null; probation?: string | null; capacity: number; range_miles: number; program_types?: string[] | null };

/** The nights of this program for these trainers: dogs booked and kennels blocked by time off, per night. */
async function nightsFor(sb: SupabaseClient, ids: string[], start: string, end: string, skipDeal?: string | null) {
  const [{ data: bks }, { data: offs }] = await Promise.all([
    sb.from("bookings").select("trainer_id, start_date, end_date, hubspot_deal_id").in("trainer_id", ids).neq("status", "cancelled").lt("start_date", end).gt("end_date", start),
    sb.from("time_off").select("trainer_id, start_date, end_date, slots_blocked").in("trainer_id", ids).lte("start_date", end).gte("end_date", start)
  ]);
  const nights = programNights(start, end);
  return (t: T) => nights.map((date) => ({
    date,
    dogs: ((bks || []) as { trainer_id: string; start_date: string; end_date: string; hubspot_deal_id: string | null }[]).filter((b) => b.trainer_id === t.id && (!skipDeal || b.hubspot_deal_id !== skipDeal) && b.start_date <= date && date < b.end_date).length,
    blocked: Math.min(t.capacity, ((offs || []) as { trainer_id: string; start_date: string; end_date: string; slots_blocked: number | null }[]).filter((o) => o.trainer_id === t.id && o.start_date <= date && date <= o.end_date).reduce((n, o) => n + (o.slots_blocked ?? t.capacity), 0))
  }));
}

async function programsBefore(sb: SupabaseClient, ids: string[], start: string) {
  const { data } = await sb.from("bookings").select("trainer_id").in("trainer_id", ids).neq("status", "cancelled").lt("start_date", start);
  const n = new Map<string, number>(); for (const r of (data || []) as { trainer_id: string }[]) n.set(r.trainer_id, (n.get(r.trainer_id) || 0) + 1);
  return n;
}

/** Alerts in the last 30 days per trainer (no update today, a client left waiting): responsiveness, for the Preferred star. */
async function alerts30(sb: SupabaseClient, ids: string[]) {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [{ data: incs }, { data: chats }] = await Promise.all([
    sb.from("chat_incidents").select("chat_id").in("kind", ["trainer_silent", "client_waiting"]).gte("opened_at", since).not("chat_id", "is", null),
    sb.from("chats").select("id, trainer_id").in("trainer_id", ids)
  ]);
  const owner = new Map(((chats || []) as { id: string; trainer_id: string }[]).map((c) => [c.id, c.trainer_id]));
  const n = new Map<string, number>(); for (const i of (incs || []) as { chat_id: string }[]) { const t = owner.get(i.chat_id); if (t) n.set(t, (n.get(t) || 0) + 1); }
  return n;
}

async function asksFor(sb: SupabaseClient, dealId?: string | null): Promise<Ask[]> {
  if (!dealId) return [];
  const { data, error } = await sb.from("booking_asks").select("id, kind, status, deadline, created_at, trainer_id").eq("deal_id", dealId).order("created_at", { ascending: false });
  return error ? [] : ((data || []) as Ask[]);
}

/** The closest trainers for a deal, each with its lane. Hidden ones (Hold) are left out; Assign first, then Offer, then Pedro. */
export async function lanesForDeal(d: DealCtx, opts: { limit?: number; sb?: SupabaseClient } = {}): Promise<{ ok: true; place: string; rows: LaneRow[] } | { ok: false; message: string }> {
  if (!d.zip || !/^\d{5}$/.test(d.zip)) return { ok: false, message: "No ZIP on this deal." };
  const sb = opts.sb || serviceClient();
  const near = await availability({ zip: d.zip, limit: 9, routes: true });
  if (!near.ok) return { ok: false, message: near.error };
  const ids = near.trainers.map((t) => t.id);
  const today = todayIso();
  const start = d.start, end = d.end || (d.start ? addDays(d.start, 21) : null);
  const [{ data: trs }, before, al, asks, nights] = await Promise.all([
    sb.from("trainers").select("*").in("id", ids),
    start ? programsBefore(sb, ids, start) : Promise.resolve(new Map<string, number>()),
    alerts30(sb, ids), asksFor(sb, d.dealId),
    start && end ? nightsFor(sb, ids, start, end, d.dealId) : Promise.resolve(null)
  ]);
  const byId = new Map(((trs || []) as T[]).map((t) => [t.id, t]));
  const thisWeek = near.weeks[0];
  const rows: LaneRow[] = [];
  for (const a of near.trainers) {
    const t = byId.get(a.id); if (!t) continue;
    const road = a.routeMiles ?? a.distance ?? null;
    const approved = asks.some((x) => x.trainer_id === t.id && x.kind === "pedro" && x.status === "approved");
    const r = start && end && nights
      ? laneFor(t, { start, end, program: d.program || null, dogs: Math.max(1, d.dogs), today }, road, before.get(t.id) || 0, nights(t), approved)
      : laneFor(t, { start: addDays(today, 30), end: addDays(today, 51), program: d.program || null, dogs: Math.max(1, d.dogs), today }, road, before.get(t.id) || 0, [], approved); // no dates yet: everything but capacity and notice
    if (r.lane === "hidden") continue;
    const open = asks.find((x) => x.trainer_id === t.id && x.status === "open") || null;
    rows.push({ id: t.id, name: t.name, place: [a.city, a.state].filter(Boolean).join(", "), straight: a.distance, route: a.routeMiles, range: a.range, lane: r.lane, reasons: r.reasons, hours: r.hours, preferred: false, ask: open,
      opening: a.soon3 === thisWeek ? (a.freeNow ? `Now (${a.freeNow} free)` : "Now") : a.soon3 ? short(a.soon3) : a.soon2 ? `${short(a.soon2)} (2 weeks)` : a.awayNow ? "Away" : "Full" });
  }
  const star = preferred(rows.map((r) => ({ id: r.id, lane: r.lane, roadMiles: r.route ?? r.straight, alerts: al.get(r.id) || 0 })));
  for (const r of rows) r.preferred = r.id === star;
  const order: Record<Lane, number> = { assign: 0, offer: 1, pedro: 2, blocked: 3, hidden: 4 };
  rows.sort((x, y) => order[x.lane] - order[y.lane] || (x.route ?? x.straight ?? 999) - (y.route ?? y.straight ?? 999));
  return { ok: true, place: [near.origin?.city, near.origin?.state].filter(Boolean).join(", "), rows: rows.slice(0, opts.limit || 6) };
}

/** Pedro himself (PEDRO_EMAIL, or a name starting "Pedro"): his own bookings never wait for his OK. */
export const isPedro = (v: { name?: string | null; email?: string | null }) =>
  (!!process.env.PEDRO_EMAIL && !!v.email && v.email.toLowerCase() === process.env.PEDRO_EMAIL.trim().toLowerCase()) || /^pedro\b/i.test(String(v.name || "").trim());

/**
 * The check every booking passes (app and Sales Assistant).
 *  - Ask-Pedro trainers (probation, out of range) need Pedro's OK: an approved ask on this deal, "Pedro said yes"
 *    (laneOk = "pedro"), or Pedro booking it himself.
 *  - Trainers who need checking (bonus dog, short notice, Watch) need "they said yes" (laneOk = "offer"); Pedro's OK covers this too.
 * A "Pedro said yes" (or Pedro's own booking) is recorded as an approved ask, with who said so, and closes any open ask.
 * Returns the lane to record, or why not (need: which button the form shows). If anything can't be worked out (no ZIP,
 * HubSpot down), the booking goes ahead as before and no lane is recorded.
 */
export async function laneGate(o: { dealId: string; trainerId: string; zip?: string | null; start: string; end: string; program?: string | null; dogs: number; laneOk?: string | null; by?: string; asPedro?: boolean }, sb: SupabaseClient = serviceClient()): Promise<{ ok: true; lane: Lane | null; reasons: string; note?: string } | { ok: false; lane: Lane; message: string; need?: "pedro" | "offer" }> {
  try {
    const { data: t } = await sb.from("trainers").select("*").eq("id", o.trainerId).maybeSingle();
    if (!t) return { ok: true, lane: null, reasons: "" };
    let road: number | null = null;
    if (o.zip && /^\d{5}$/.test(o.zip)) {
      const near = await availability({ zip: o.zip, limit: 30, routes: false });
      if (near.ok) road = near.trainers.find((x) => x.id === o.trainerId)?.distance ?? null; // the gate uses straight-line miles: no waiting on routes
    }
    const [before, asks, nights] = await Promise.all([programsBefore(sb, [o.trainerId], o.start), asksFor(sb, o.dealId), nightsFor(sb, [o.trainerId], o.start, o.end, o.dealId)]);
    const approved = asks.some((x) => x.trainer_id === o.trainerId && x.kind === "pedro" && x.status === "approved");
    const pedroYes = o.laneOk === "pedro" || !!o.asPedro;
    const r = laneFor(t as T, { start: o.start, end: o.end, program: o.program || null, dogs: Math.max(1, o.dogs), today: todayIso() }, road, before.get(o.trainerId) || 0, nights(t as T), approved || pedroYes);
    const why = r.reasons.map((x) => x.text).join("; "), first = String(t.name).split(" ")[0];
    const needsPedro = r.reasons.some((x) => x.code === "probation" || x.code === "range");
    if (r.lane === "pedro") return { ok: false, lane: r.lane, need: "pedro", message: `${first} needs Pedro's OK first (${why}). Ask Pedro, or if he has already said yes, tap "Pedro said yes: book".` };
    if (r.lane === "offer" && o.laneOk !== "offer" && !pedroYes && !approved) return { ok: false, lane: r.lane, need: "offer", message: `Check with ${first} first (${why}). Ask them for me, or once they've said yes, tap "They said yes: book".` };
    if (r.lane === "blocked") return { ok: false, lane: r.lane, message: `${first} doesn't take ${o.program}. Pick someone else, or change their programs on their profile.` };
    if (r.lane === "hidden") return { ok: false, lane: r.lane, message: `${first} is on Hold.` };
    // Record Pedro's OK given outside To do: who said so, and close any open ask for this trainer on this deal
    let note: string | undefined;
    if (needsPedro && !approved && pedroYes) {
      const by = o.by || "An admin", said = o.asPedro ? `${by} (Pedro, booking it himself)` : `${by} (said Pedro said yes)`;
      const open = asks.filter((x) => x.trainer_id === o.trainerId && x.kind === "pedro" && x.status === "open");
      if (open.length) for (const a of open) await answerAsk(a.id, "approved", said, sb).catch(() => null);
      else await sb.from("booking_asks").insert({ deal_id: o.dealId, trainer_id: o.trainerId, kind: "pedro", status: "approved", reasons: r.reasons.map((x) => x.code), detail: `${t.name}: ${why}.`, requested_by: by, answered_by: said, answered_at: new Date().toISOString() }).then(() => null, () => null);
      note = o.asPedro ? "Pedro booked it himself" : `Pedro's OK, confirmed by ${by}`;
      await auditSystem("Booked with Pedro's OK", `${t.name} for deal ${o.dealId}: ${why}. ${note}.`, { link: "/a" }).catch(() => null);
    }
    return { ok: true, lane: (approved || pedroYes) && needsPedro ? "pedro" : r.lane, reasons: why, note };
  } catch { return { ok: true, lane: null, reasons: "" }; }
}

const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "https://trainers-seven.vercel.app").replace(/\/$/, "");
/** "Check with the trainer" (kind offer, for the POC on shift) or "Ask Pedro" (kind pedro). Shows in To do with the details. */
export async function createAsk(o: { kind: "offer" | "pedro"; dealId: string; trainerId: string; ctx: DealCtx; reasons: Reason[]; hours: number | null; note?: string; by: string; escalatedFrom?: string }, sb: SupabaseClient = serviceClient()) {
  const { data: t } = await sb.from("trainers").select("id, name, poc").eq("id", o.trainerId).maybeSingle();
  if (!t) return { ok: false as const, message: "Trainer not found." };
  const { data: dup } = await sb.from("booking_asks").select("id").eq("deal_id", o.dealId).eq("trainer_id", o.trainerId).eq("kind", o.kind).eq("status", "open").maybeSingle();
  if (dup) return { ok: true as const, message: "Already asked: it's on To do.", id: dup.id };
  const deadline = o.hours ? new Date(Date.now() + o.hours * 3600e3).toISOString() : null;
  const dogs = (o.ctx.dogNames || []).join(" & ") || "the dog";
  const detail = [`${dogs} (${o.ctx.client || "client"}): ${o.ctx.program || "program"}${o.ctx.start ? `, ${short(o.ctx.start)} to ${o.ctx.end ? short(o.ctx.end) : "?"}` : ", no dates yet"}${o.ctx.zip ? `, ZIP ${o.ctx.zip}` : ""}.`,
    `Trainer: ${t.name}. ${o.reasons.map((r) => r.text).join("; ")}.`, o.note ? `Note: ${o.note}` : "", `Asked by ${o.by}.`].filter(Boolean).join(" ");
  const { data: row, error } = await sb.from("booking_asks").insert({ deal_id: o.dealId, trainer_id: o.trainerId, kind: o.kind, reasons: o.reasons.map((r) => r.code), detail, deadline, note: o.note || null, requested_by: o.by }).select("id").single();
  if (error || !row) return { ok: false as const, message: /booking_asks|schema cache/i.test(error?.message || "") ? "Asking isn't switched on yet (migration 048)." : error?.message || "Couldn't save it." };
  if (o.escalatedFrom) await sb.from("booking_asks").update({ status: "escalated", answered_by: o.by, answered_at: new Date().toISOString() }).eq("id", o.escalatedFrom);
  const when = deadline ? new Date(deadline).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET" : "";
  await raiseIncident({ kind: o.kind === "pedro" ? "ask_pedro" : "trainer_offer", office: true, ref: `ask:${row.id}`, urgent: o.kind === "offer" && (o.hours || 99) <= 4,
    title: `${dogs} → ${t.name}`, detail: `${o.kind === "pedro" ? "Pedro to decide" : `Check with ${t.name.split(" ")[0]}${when ? `, answer by ${when}` : ""}`}. ${detail}`, link: `${site()}/a` }, sb);
  if (o.kind === "pedro" && process.env.PEDRO_EMAIL && mailConfigured()) {
    await sendMail({ to: process.env.PEDRO_EMAIL, subject: `Ask Pedro: ${dogs} → ${t.name}`, text: `${detail}\n\nDecide on To do: ${site()}/a`,
      html: `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">${detail.replace(/[<>&]/g, "")}</p><p><a href="${site()}/a" style="font-family:Arial,sans-serif;font-weight:bold">Decide on To do</a></p>` }).catch(() => null);
  }
  await auditSystem(o.kind === "pedro" ? "Asked Pedro about a booking" : "Flagged a booking to check with the trainer", detail, { link: "/a" });
  return { ok: true as const, message: o.kind === "pedro" ? "Sent to Pedro: it's on To do." : `On To do: check with ${t.name.split(" ")[0]}${when ? ` (answer by ${when})` : ""}.`, id: row.id };
}

/** Answer an ask from its To do row. */
export async function answerAsk(id: string, answer: "yes" | "no" | "approved" | "elsewhere" | "nobody", by: string, sb: SupabaseClient = serviceClient()) {
  const { data: a } = await sb.from("booking_asks").select("*").eq("id", id).maybeSingle();
  if (!a) return { ok: false as const, message: "Not found." };
  if (a.status !== "open" && a.status !== "expired") return { ok: false as const, message: "Already answered." };
  await sb.from("booking_asks").update({ status: answer === "nobody" ? "escalated" : answer, answered_by: by, answered_at: new Date().toISOString() }).eq("id", id);
  for (const ref of [`ask:${id}`, `ask-expired:${id}`]) await resolveIncidents({ kinds: ["trainer_offer", "ask_pedro"], ref }, by, answer, sb).catch(() => null);
  return { ok: true as const, ask: a as { id: string; deal_id: string; trainer_id: string; kind: string; detail: string | null } };
}

/** Every 10 minutes: offers past their deadline (no reply = no: re-match), and a trainer silent on a second offer → Pedro. */
export async function askChecks(now = new Date(), sb: SupabaseClient = serviceClient()) {
  const { data, error } = await sb.from("booking_asks").select("id, deal_id, trainer_id, kind, detail, deadline").eq("status", "open").eq("kind", "offer").lt("deadline", now.toISOString()).limit(50);
  if (error) return { expired: 0 };
  let expired = 0;
  for (const a of (data || []) as { id: string; deal_id: string; trainer_id: string; detail: string | null; deadline: string }[]) {
    await sb.from("booking_asks").update({ status: "expired" }).eq("id", a.id);
    await resolveIncidents({ kinds: ["trainer_offer"], ref: `ask:${a.id}` }, "automatic", "No reply by the deadline", sb).catch(() => null);
    await raiseIncident({ kind: "trainer_offer", office: true, ref: `ask-expired:${a.id}`, title: "No reply: re-match", detail: `No reply by the deadline, which means no: re-match. ${a.detail || ""}`, link: `${site()}/a` }, sb);
    const { count } = await sb.from("booking_asks").select("id", { count: "exact", head: true }).eq("trainer_id", a.trainer_id).eq("status", "expired").gte("created_at", new Date(now.getTime() - 60 * 864e5).toISOString());
    if ((count || 0) >= 2) {
      const { data: t } = await sb.from("trainers").select("name").eq("id", a.trainer_id).maybeSingle();
      await raiseIncident({ kind: "ask_pedro", office: true, ref: `reach:${a.trainer_id}:${now.toISOString().slice(0, 7)}`, title: `${t?.name || "A trainer"}: silent on two offers`,
        detail: `${t?.name || "A trainer"} didn't reply to ${count} offers in the last 60 days: a reachability conversation for Pedro.`, link: `${site()}/a/trainers/${a.trainer_id}` }, sb);
    }
    expired++;
  }
  return { expired };
}
