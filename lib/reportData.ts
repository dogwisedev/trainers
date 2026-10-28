import { programFor } from "./programs";
import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDemo, serverClient, serviceClient } from "./supabase";
import { listBookings } from "./data";
import seed from "./demo-seed.json";
import { addDays, todayIso } from "./dates";
import { Answers, BookingForReports, Kind, MediaItem, RowLike, Status, Todo, endOfDay, expectedReports, healthFlags, lateDays, startOfDay, todos } from "./reports";
import { dealKey } from "./chatTypes";
import { loadProfile } from "./pretraining";
import { Booking, Trainer } from "./types";

export type ReportRow = RowLike & {
  id: string; trainer_id: string; answers: Answers; media: MediaItem[]; due_by: string | null; submitted_at: string | null; review_note: string | null; by_admin: boolean;
  approved_by_name: string | null; approved_at: string | null; sent_at: string | null; sent_to: string | null; send_error: string | null; updated_at: string;
  waived_by?: string | null; waived_at?: string | null;
};
export type ReportBundle = { report: ReportRow; booking: Booking; trainer: Pick<Trainer, "id" | "name" | "email">; late: number; chat: { id: string } | null };

const demo = seed as unknown as { trainers: Trainer[]; bookings: Booking[] };
const asDemoBooking = (b: Booking): Booking => ({ ...b, reports_enabled: true, client_email: b.client_email || "client@example.com" });

/** What we already know, filled in for the trainer. */
export const prefill = (kind: Kind, b: Booking, trainerName: string, week: number): Answers => ({
  dogName: b.dog_name || "", trainerName, clientName: b.client_name,
  ...(kind === "weekly" ? { weekNumber: week } : {}),
  ...(kind === "intake" ? { pickupDate: b.start_date } : {}),
  ...(kind === "handover" ? { clientEmail: b.client_email || "", program: programFor((b as { program_choice?: string | null }).program_choice || "") || programFor(b.program) || "" } : {})
});

/** Reports a trainer (or everyone, for admins) still owes: from bookings plus the reports that exist. */
/** Forms open, due or late. Looked up once per page load (the menu badge and the page share it). */
export function listTodos(opts: { trainerId?: string } = {}): Promise<(Todo & { trainerName: string })[]> { return todosFor(opts.trainerId || null); }
const todosFor = cache((trainerId: string | null) => listTodosUncached(trainerId ? { trainerId } : {}));
async function listTodosUncached(opts: { trainerId?: string } = {}): Promise<(Todo & { trainerName: string })[]> {
  const from = addDays(todayIso(), -75);
  const bookings = (await listBookings({ trainerId: opts.trainerId, from })).map((b) => (isDemo() ? asDemoBooking(b) : b));
  let rows: RowLike[] = [];
  if (!isDemo()) {
    let q = serverClient().from("reports").select("id, booking_id, kind, week_number, status, submitted_at, due_by").in("booking_id", bookings.map((b) => b.id));
    if (opts.trainerId) q = q.eq("trainer_id", opts.trainerId);
    rows = ((await q).data || []) as RowLike[];
  }
  const names = new Map<string, string>((isDemo() ? demo.trainers : (await serverClient().from("trainers").select("id, name")).data || []).map((t: { id: string; name: string }) => [t.id, t.name]));
  return todos(bookings as BookingForReports[], rows).map((t) => ({ ...t, trainerName: names.get(t.booking.trainer_id) || "" }));
}

export const demoId = (b: string, kind: Kind, week: number) => `demo|${b}|${kind}|${week}`;

export async function getReport(id: string): Promise<ReportBundle | null> {
  if (isDemo()) {
    const [, bid, kind, week] = id.split("|");
    const b = demo.bookings.find((x) => x.id === bid);
    const t = b && demo.trainers.find((x) => x.id === b.trainer_id);
    if (!b || !t) return null;
    const booking = asDemoBooking(b), w = Number(week) || 0, k = kind as Kind;
    const win = expectedReports(b as BookingForReports).find((x) => x.kind === k && x.week === w) || { deadline: b.end_date };
    return { report: { id, booking_id: b.id, trainer_id: t.id, kind: k, week_number: w, status: "draft", answers: prefill(k, booking, t.name, w), media: [], due_by: endOfDay(win.deadline).toISOString(), submitted_at: null, review_note: null, by_admin: false, approved_by_name: null, approved_at: null, sent_at: null, sent_to: null, send_error: null, updated_at: new Date().toISOString() }, booking, trainer: { id: t.id, name: t.name, email: t.email }, late: 0, chat: null };
  }
  const sb = serverClient();
  const { data: r } = await sb.from("reports").select("*").eq("id", id).maybeSingle();
  if (!r) return null;
  const [{ data: booking }, { data: trainer }] = await Promise.all([
    sb.from("bookings").select("*").eq("id", r.booking_id).maybeSingle(),
    sb.from("trainers").select("id, name, email").eq("id", r.trainer_id).maybeSingle()
  ]);
  if (!booking || !trainer) return null;
  const { data: chat } = await sb.from("chats").select("id").eq("deal_key", dealKey(booking as Booking)).eq("status", "open").maybeSingle();
  return { report: { ...r, media: (r.media || []) as MediaItem[], answers: (r.answers || {}) as Answers } as ReportRow, booking: booking as Booking, trainer, late: lateDays(r.submitted_at, r.due_by), chat: chat ? { id: chat.id } : null };
}

/** "Austin, TX" from the client's before-training answers (the HubSpot contact the app keeps), or "" if not given. */
async function clientCityState(dealId: string): Promise<string> {
  try {
    const { data } = await serviceClient().from("pretraining_deals").select("contact").eq("deal_id", dealId).maybeSingle();
    const c = (data?.contact || {}) as Record<string, string | null>;
    return [c.city, c.state].map((x) => String(x || "").trim()).filter(Boolean).join(", ");
  } catch { return ""; }
}

/** Intake form: breed and medication from the owner's before-training answers, for the trainer to check at pickup. */
async function intakeFromOwner(b: Booking): Promise<Answers> {
  try {
    const p = await loadProfile(b.hubspot_deal_id!, 24 * 60); // the copy the app keeps; no HubSpot call unless it's a day old
    const d = p?.dogs.find((x) => x.booking.id === b.id) || (p?.dogs.length === 1 ? p.dogs[0] : null);
    if (!d) return {};
    const a = d.answers as Record<string, unknown>, txt = (k: string) => String(a[k] ?? "").trim();
    const out: Answers = {};
    if (txt("dog_s_breed")) out.dogBreed = txt("dog_s_breed");
    const meds = txt("is_your_dog_on_any_medication__").toLowerCase();
    if (/^(yes|true)$/.test(meds)) { out.medication = "yes"; if (txt("if_so__please_list_the_medication_")) out.medication_detail = txt("if_so__please_list_the_medication_"); }
    else if (/^(no|false)$/.test(meds)) out.medication = "no";
    return out;
  } catch { return {}; }
}

/** Finds or starts the report for a booking/week. Trainers start their own; admins can start one for a trainer. */
export async function ensureReport(sb: SupabaseClient, b: Booking, trainerName: string, kind: Kind, week: number, byAdmin: boolean): Promise<string> {
  const wk = kind === "weekly" ? week : 0;
  const found = async () => (await sb.from("reports").select("id").eq("booking_id", b.id).eq("kind", kind).eq("week_number", wk).maybeSingle()).data?.id as string | undefined;
  const have = await found();
  if (have) return have;
  const win = expectedReports(b as BookingForReports).find((w) => w.kind === kind && w.week === wk);
  if (!win) throw new Error("That report isn't part of this booking.");
  const answers = prefill(kind, b, trainerName, wk);
  if (kind === "handover" && b.hubspot_deal_id) answers.clientLocation = await clientCityState(b.hubspot_deal_id);
  if (kind === "intake" && b.hubspot_deal_id) Object.assign(answers, await intakeFromOwner(b));
  const { data, error } = await sb.from("reports").insert({
    booking_id: b.id, trainer_id: b.trainer_id, kind, week_number: wk, status: "draft", answers,
    due_by: endOfDay(win.deadline).toISOString(), by_admin: byAdmin
  }).select("id").single();
  if (error) { const again = await found(); if (again) return again; throw new Error(error.message); }
  return data.id;
}

export type QueueItem = { id: string; status: Status; kind: Kind; week: number; dog: string; client: string; trainer: string; submittedAt: string | null; late: number; note: string | null; byAdmin: boolean; sentAt: string | null; sentTo: string | null; error: string | null; flags: string[] };
/** Admin queue: everything waiting for review, sent back, and recently approved. */
export async function listQueue(): Promise<QueueItem[]> {
  if (isDemo()) return [];
  const { data } = await serverClient().from("reports").select("id, status, kind, week_number, submitted_at, due_by, review_note, by_admin, sent_at, sent_to, send_error, answers, trainers(name)").not("status", "in", "(draft,waived)").order("submitted_at", { ascending: true, nullsFirst: false }).limit(300);
  return ((data || []) as unknown as { id: string; status: Status; kind: Kind; week_number: number; submitted_at: string | null; due_by: string | null; review_note: string | null; by_admin: boolean; sent_at: string | null; sent_to: string | null; send_error: string | null; answers: Answers; trainers: { name: string } | null }[]).map((r) => ({
    id: r.id, status: r.status, kind: r.kind, week: r.week_number, dog: String(r.answers?.dogName || ""), client: String(r.answers?.clientName || ""), trainer: r.trainers?.name || "",
    submittedAt: r.submitted_at, late: lateDays(r.submitted_at, r.due_by), note: r.review_note, byAdmin: r.by_admin, sentAt: r.sent_at, sentTo: r.sent_to, error: r.send_error, flags: healthFlags(r.kind, r.answers || {})
  }));
}

export async function pendingReportCount(): Promise<number> {
  if (isDemo()) return 0;
  const { count } = await serverClient().from("reports").select("id", { count: "exact", head: true }).eq("status", "submitted");
  return count || 0;
}

/** The trainer's own reports for the history list. */
export async function listMyReports(trainerId: string) {
  if (isDemo()) return [];
  const { data } = await serverClient().from("reports").select("id, status, kind, week_number, submitted_at, due_by, answers, review_note").eq("trainer_id", trainerId).not("status", "in", "(draft,waived)").order("submitted_at", { ascending: false, nullsFirst: false }).limit(60);
  return (data || []) as { id: string; status: Status; kind: Kind; week_number: number; submitted_at: string | null; due_by: string | null; answers: Answers; review_note: string | null }[];
}

/** Photos and videos the trainer has posted in the dog's chat since the pickup date. chatId null = the dog has no chat. */
export async function pickupMedia(booking: Booking, sinceDate: string): Promise<{ chatId: string | null; count: number }> {
  if (isDemo()) return { chatId: null, count: 0 };
  const sb = serverClient();
  const { data: chat } = await sb.from("chats").select("id").eq("deal_key", dealKey(booking)).eq("status", "open").maybeSingle();
  if (!chat) return { chatId: null, count: 0 };
  const { data } = await sb.from("chat_messages").select("media").eq("chat_id", chat.id).eq("kind", "media").eq("sender_role", "trainer").gte("created_at", startOfDay(sinceDate).toISOString()).limit(300);
  const count = (data || []).reduce((n: number, m: { media: { kind: string }[] }) => n + (m.media || []).filter((x) => x.kind === "photo" || x.kind === "video").length, 0);
  return { chatId: chat.id, count };
}
