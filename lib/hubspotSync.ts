import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { addDays, short } from "./dates";
import { etParts } from "./chatRules";
import { overbookedDays } from "./capacity";
import { notifyBookings } from "./bookingEmail";
import { endOfDay, expectedReports, BookingForReports, Kind } from "./reports";
import { raiseIncident, resolveIncidents } from "./incidents";
import { SyncMode, dealDateProps, hsDate, hubspotConfigured, readDeals, stageLabel, syncMode } from "./hubspot";
import { PlanIn, planDeal } from "./hubspotDates";

// HubSpot is the source of truth for booking dates. Runs on a Vercel cron (vercel.json) and right after a booking is made.
//  dry   : reads HubSpot, writes nothing, returns what it would change (the default until HUBSPOT_SYNC is set)
//  quiet : writes the dates, no emails and no change incidents (for the first catch-up, so trainers aren't flooded)
//  live  : writes the dates, emails the trainer the updated booking, opens incidents (overbooked, length changed)
// Always (except dry): deals no longer Closed Won → "Training cancelled" incident, emailed to admins and info@;
// deals missing in HubSpot or with no start date → "Check HubSpot" incident.

const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const KEEP_DAYS = 14; // bookings that ended more than this long ago are history: never moved

type Row = PlanIn & { trainer_id: string; client_name: string; status: string; hubspot_deal_id: string; trainers: { name: string; capacity: number } | null };
export type Change = { booking: string; deal: string; dog: string; client: string; trainer: string; from: string; to: string; days: [number, number]; extra: [number, number] };
export type SyncResult = {
  mode: SyncMode; skipped?: string; startProp?: string; endProp?: string | null;
  deals: number; bookings: number; changed: Change[]; unchanged: number; incidents: string[]; problems: string[]; errors: string[];
};

export async function syncHubspotDates(opts: { mode?: SyncMode; dealIds?: string[]; emailTrainers?: boolean; sb?: SupabaseClient } = {}): Promise<SyncResult> {
  const mode = opts.mode ?? syncMode();
  const out: SyncResult = { mode, deals: 0, bookings: 0, changed: [], unchanged: 0, incidents: [], problems: [], errors: [] };
  if (!hubspotConfigured()) { out.skipped = "HUBSPOT_TOKEN isn't set"; return out; }
  const sb = opts.sb || serviceClient();
  const write = mode !== "dry", announce = mode === "live", emailTrainers = announce && opts.emailTrainers !== false;
  const today = etParts(new Date()).date;

  let q = sb.from("bookings").select("id, trainer_id, client_name, dog_name, start_date, end_date, weeks, extra_days, status, hubspot_deal_id, trainers(name, capacity)")
    .not("hubspot_deal_id", "is", null).neq("status", "cancelled").gte("end_date", addDays(today, -KEEP_DAYS));
  if (opts.dealIds?.length) q = q.in("hubspot_deal_id", opts.dealIds);
  const { data, error } = await q;
  if (error) { out.errors.push(error.message); return out; }
  const rows = (data || []) as unknown as Row[];
  const byDeal = new Map<string, Row[]>();
  for (const r of rows) byDeal.set(r.hubspot_deal_id, [...(byDeal.get(r.hubspot_deal_id) || []), r]);
  out.deals = byDeal.size; out.bookings = rows.length;
  if (!byDeal.size) return out;

  let props;
  try { props = await dealDateProps(); } catch (e) { out.errors.push((e as Error).message); return out; }
  out.startProp = props.start.name; out.endProp = props.end?.name || null;
  let deals;
  try { deals = await readDeals([...byDeal.keys()].filter((id) => /^\d+$/.test(id)), [props.start.name, ...(props.end ? [props.end.name] : []), "hs_is_closed_won", "dealstage", "dealname"]); }
  catch (e) { out.errors.push((e as Error).message); return out; }

  // Open chats, so incidents link straight to the dog's chat
  const { data: chatRows } = await sb.from("chats").select("id, deal_key").eq("status", "open").in("deal_key", [...byDeal.keys()]);
  const chatOf = new Map(((chatRows || []) as { id: string; deal_key: string }[]).map((c) => [c.deal_key, c.id]));
  const dealUrl = (id: string) => `https://app.hubspot.com/contacts/21869370/record/0-3/${id}`;
  const label = (list: Row[]) => `${[...new Set(list.map((b) => b.dog_name).filter(Boolean))].join(" & ") || "Dog"} (${list[0].client_name}), ${list[0].trainers?.name || "trainer"}`;
  const problem = async (dealId: string, list: Row[], detail: string) => {
    out.problems.push(`${label(list)}: ${detail}`);
    if (write && await raiseIncident({ kind: "hubspot_problem", title: label(list), detail: `${detail} Deal: ${dealUrl(dealId)}`, ref: `deal:${dealId}`, chatId: chatOf.get(dealId), bookingId: list[0].id, link: dealUrl(dealId) }, sb)) out.incidents.push(`Check HubSpot: ${label(list)}`);
  };

  const applied: { row: Row; start: string; end: string; extra: number; oldDays: number; newDays: number }[] = [];
  const checked: string[] = [];
  for (const [dealId, list] of byDeal) {
    try {
      const p = deals.get(dealId);
      if (!p) { await problem(dealId, list, /^\d+$/.test(dealId) ? `The HubSpot deal ${dealId} wasn't found (deleted or merged?), so the dates can't be checked.` : `"${dealId}" isn't a HubSpot deal ID. Fix it on the booking.`); continue; }
      if (p.hs_is_closed_won !== "true") {
        const stage = await stageLabel(p.dealstage);
        out.problems.push(`${label(list)}: deal is now "${stage}"`);
        if (write && await raiseIncident({
          kind: "booking_cancelled", title: label(list), office: true, ref: `deal:${dealId}`, chatId: chatOf.get(dealId), bookingId: list[0].id, link: dealUrl(dealId),
          detail: `The HubSpot deal for ${label(list)} moved to "${stage}" but the booking is still live in the app (${list.map((b) => `${b.dog_name || "dog"} ${short(b.start_date)} to ${short(b.end_date)}`).join(", ")}). Cancel or fix the booking, and the trainer's pay.`
        }, sb)) out.incidents.push(`Training cancelled: ${label(list)}`);
        continue;
      }
      const hsStart = hsDate(p[props.start.name]), hsEnd = props.end ? hsDate(p[props.end.name]) : null;
      if (!hsStart) { await problem(dealId, list, `The deal has no ${props.start.label}.`); continue; }
      const { plan, problem: why } = planDeal(list, hsStart, hsEnd);
      if (why) { await problem(dealId, list, why); continue; }
      if (write) await resolveIncidents({ kinds: ["hubspot_problem", "booking_cancelled"], ref: `deal:${dealId}` }, "automatic", "HubSpot deal is fine again", sb);
      for (const x of plan) {
        const row = list.find((b) => b.id === x.id)!;
        checked.push(row.id);
        if (!x.changed) { out.unchanged++; continue; }
        out.changed.push({ booking: row.id, deal: dealId, dog: row.dog_name || "Dog", client: row.client_name, trainer: row.trainers?.name || "", from: `${row.start_date} to ${row.end_date}`, to: `${x.start} to ${x.end}`, days: [x.oldDays, x.newDays], extra: [row.extra_days ?? 0, x.extra] });
        applied.push({ row, start: x.start, end: x.end, extra: x.extra, oldDays: x.oldDays, newDays: x.newDays });
      }
    } catch (e) { out.errors.push(`deal ${dealId}: ${(e as Error).message}`); }
  }
  if (!write) return out;

  // ── Write ──
  const now = new Date().toISOString();
  const done: typeof applied = [];
  for (const a of applied) {
    const { error: e } = await sb.from("bookings").update({ start_date: a.start, end_date: a.end, extra_days: a.extra, hubspot_synced_at: now }).eq("id", a.row.id);
    if (e) { out.errors.push(`${a.row.dog_name || a.row.id}: ${e.message}`); continue; }
    done.push(a);
    await moveReportDeadlines(sb, { ...a.row, start_date: a.start, end_date: a.end }).catch((err) => out.errors.push(`reports ${a.row.id}: ${(err as Error).message}`));
  }
  const untouched = checked.filter((id) => !applied.some((a) => a.row.id === id));
  for (let i = 0; i < untouched.length; i += 150) await sb.from("bookings").update({ hubspot_synced_at: now }).in("id", untouched.slice(i, i + 150));
  if (!announce || !done.length) return out;

  // ── Tell people (live only) ──
  if (emailTrainers) {
    const n = await notifyBookings(sb, done.map((a) => a.row.id), "changed");
    out.errors.push(...n.errors.map((x) => `email: ${x}`));
  }
  for (const a of done) {
    if (a.newDays !== a.oldDays) {
      const what = `${a.row.dog_name || "the dog"} (${a.row.client_name}, with ${a.row.trainers?.name || "the trainer"})`;
      if (await raiseIncident({
        kind: "length_changed", title: label([a.row]), office: true, ref: `booking:${a.row.id}`, bookingId: a.row.id, chatId: chatOf.get(a.row.hubspot_deal_id), link: dealUrl(a.row.hubspot_deal_id),
        detail: `HubSpot ${a.newDays < a.oldDays ? "shortened" : "lengthened"} the program for ${what} from ${a.oldDays} to ${a.newDays} days (now ${short(a.start)} to ${short(a.end)}). The trainer's pay follows the new days.`
      }, sb)) out.incidents.push(`Length changed: ${label([a.row])}`);
    }
  }
  // Overbooked? Day by day, for each trainer whose bookings moved
  const byTrainer = new Map<string, typeof done>();
  for (const a of done) byTrainer.set(a.row.trainer_id, [...(byTrainer.get(a.row.trainer_id) || []), a]);
  for (const [trainerId, list] of byTrainer) {
    const from = list.reduce((m, a) => (a.start < m ? a.start : m), list[0].start), to = list.reduce((m, a) => (a.end > m ? a.end : m), list[0].end);
    const [{ data: bk }, { data: off }] = await Promise.all([
      sb.from("bookings").select("trainer_id, status, start_date, end_date").eq("trainer_id", trainerId).neq("status", "cancelled").lte("start_date", to).gte("end_date", from),
      sb.from("time_off").select("trainer_id, start_date, end_date, slots_blocked").eq("trainer_id", trainerId).lte("start_date", to).gte("end_date", from)
    ]);
    const cap = list[0].row.trainers?.capacity ?? 0;
    for (const a of list) {
      const over = overbookedDays({ id: trainerId, capacity: cap }, bk || [], off || [], a.start, a.end);
      if (!over.length) continue;
      if (await raiseIncident({
        kind: "overbooked", title: label([a.row]), ref: `booking:${a.row.id}`, bookingId: a.row.id, chatId: chatOf.get(a.row.hubspot_deal_id), link: `${site()}/a/trainers/${trainerId}`,
        detail: `After HubSpot moved ${a.row.dog_name || "the dog"} to ${short(a.start)} to ${short(a.end)}, ${a.row.trainers?.name || "the trainer"} has more dogs than kennels (${cap}) on ${over.length} day${over.length > 1 ? "s" : ""}, from ${short(over[0])}.`
      }, sb)) out.incidents.push(`Overbooked: ${label([a.row])}`);
    }
  }
  return out;
}

/** Forms not yet submitted get deadlines that match the new dates. Submitted and approved ones keep theirs (lateness is already settled). */
async function moveReportDeadlines(sb: SupabaseClient, b: BookingForReports) {
  const { data } = await sb.from("reports").select("id, kind, week_number, due_by").eq("booking_id", b.id).in("status", ["draft", "changes_requested"]);
  if (!data?.length) return;
  const windows = expectedReports(b);
  for (const r of data as { id: string; kind: Kind; week_number: number; due_by: string | null }[]) {
    const w = windows.find((x) => x.kind === r.kind && x.week === r.week_number);
    if (!w) continue;
    const due = endOfDay(w.deadline).toISOString();
    if (due !== r.due_by) await sb.from("reports").update({ due_by: due }).eq("id", r.id);
  }
}
