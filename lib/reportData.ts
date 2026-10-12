import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDemo, serverClient } from "./supabase";
import { listBookings } from "./data";
import seed from "./demo-seed.json";
import { addDays, todayIso } from "./dates";
import { Answers, BookingForReports, Kind, MediaItem, RowLike, Status, Todo, endOfDay, expectedReports, lateDays, todos, weeklyWindow, handoverWindow } from "./reports";
import { Booking, Trainer } from "./types";

export type ReportRow = RowLike & {
  id: string; trainer_id: string; answers: Answers; media: MediaItem[]; due_by: string | null; submitted_at: string | null; review_note: string | null; by_admin: boolean;
  approved_by_name: string | null; approved_at: string | null; sent_at: string | null; sent_to: string | null; send_error: string | null; updated_at: string;
};
export type ReportBundle = { report: ReportRow; booking: Booking; trainer: Pick<Trainer, "id" | "name" | "email">; late: number };

const demo = seed as unknown as { trainers: Trainer[]; bookings: Booking[] };
const asDemoBooking = (b: Booking): Booking => ({ ...b, reports_enabled: true, client_email: b.client_email || "client@example.com" });

export const prefill = (kind: Kind, b: Booking, trainerName: string, week: number): Answers => ({
  clientName: b.client_name, clientEmail: b.client_email || "", dogName: b.dog_name || "", trainerName, ...(kind === "weekly" ? { weekNumber: week } : {})
});

/** Reports a trainer (or everyone, for admins) still owes: from bookings plus the reports that exist. */
export async function listTodos(opts: { trainerId?: string } = {}): Promise<(Todo & { trainerName: string })[]> {
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
    const win = k === "weekly" ? weeklyWindow(b.start_date, w) : handoverWindow(b.end_date);
    return { report: { id, booking_id: b.id, trainer_id: t.id, kind: k, week_number: w, status: "draft", answers: prefill(k, booking, t.name, w), media: [], due_by: endOfDay(win.deadline).toISOString(), submitted_at: null, review_note: null, by_admin: false, approved_by_name: null, approved_at: null, sent_at: null, sent_to: null, send_error: null, updated_at: new Date().toISOString() }, booking, trainer: { id: t.id, name: t.name, email: t.email }, late: 0 };
  }
  const sb = serverClient();
  const { data: r } = await sb.from("reports").select("*").eq("id", id).maybeSingle();
  if (!r) return null;
  const [{ data: booking }, { data: trainer }] = await Promise.all([
    sb.from("bookings").select("*").eq("id", r.booking_id).maybeSingle(),
    sb.from("trainers").select("id, name, email").eq("id", r.trainer_id).maybeSingle()
  ]);
  if (!booking || !trainer) return null;
  return { report: { ...r, media: (r.media || []) as MediaItem[], answers: (r.answers || {}) as Answers } as ReportRow, booking: booking as Booking, trainer, late: lateDays(r.submitted_at, r.due_by) };
}

/** Finds or starts the report for a booking/week. Trainers start their own; admins can start one for a trainer. */
export async function ensureReport(sb: SupabaseClient, b: Booking, trainerName: string, kind: Kind, week: number, byAdmin: boolean): Promise<string> {
  const wk = kind === "weekly" ? week : 0;
  const found = async () => (await sb.from("reports").select("id").eq("booking_id", b.id).eq("kind", kind).eq("week_number", wk).maybeSingle()).data?.id as string | undefined;
  const have = await found();
  if (have) return have;
  const win = expectedReports(b as BookingForReports).find((w) => w.kind === kind && w.week === wk);
  if (!win) throw new Error("That report isn't part of this booking.");
  const { data, error } = await sb.from("reports").insert({
    booking_id: b.id, trainer_id: b.trainer_id, kind, week_number: wk, status: "draft", answers: prefill(kind, b, trainerName, wk),
    due_by: endOfDay(win.deadline).toISOString(), by_admin: byAdmin
  }).select("id").single();
  if (error) { const again = await found(); if (again) return again; throw new Error(error.message); }
  return data.id;
}

export type QueueItem = { id: string; status: Status; kind: Kind; week: number; dog: string; client: string; trainer: string; submittedAt: string | null; late: number; note: string | null; byAdmin: boolean; sentAt: string | null; error: string | null };
/** Admin queue: everything waiting for review, sent back, and recently approved. */
export async function listQueue(): Promise<QueueItem[]> {
  if (isDemo()) return [];
  const { data } = await serverClient().from("reports").select("id, status, kind, week_number, submitted_at, due_by, review_note, by_admin, sent_at, send_error, answers, trainers(name)").neq("status", "draft").order("submitted_at", { ascending: true, nullsFirst: false }).limit(300);
  return ((data || []) as unknown as { id: string; status: Status; kind: Kind; week_number: number; submitted_at: string | null; due_by: string | null; review_note: string | null; by_admin: boolean; sent_at: string | null; send_error: string | null; answers: Answers; trainers: { name: string } | null }[]).map((r) => ({
    id: r.id, status: r.status, kind: r.kind, week: r.week_number, dog: String(r.answers?.dogName || ""), client: String(r.answers?.clientName || ""), trainer: r.trainers?.name || "",
    submittedAt: r.submitted_at, late: lateDays(r.submitted_at, r.due_by), note: r.review_note, byAdmin: r.by_admin, sentAt: r.sent_at, error: r.send_error
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
  const { data } = await serverClient().from("reports").select("id, status, kind, week_number, submitted_at, due_by, answers, review_note").eq("trainer_id", trainerId).neq("status", "draft").order("submitted_at", { ascending: false, nullsFirst: false }).limit(60);
  return (data || []) as { id: string; status: Status; kind: Kind; week_number: number; submitted_at: string | null; due_by: string | null; answers: Answers; review_note: string | null }[];
}
