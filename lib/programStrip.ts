// One program at a glance (Dogs list and the CSV export): Intake · W1–W6 · Handover · FUP 1–3 · Paid.
// Pure, so the screen and the spreadsheet always say the same thing.
import { beforeApp, endOfDay, handoverWindow, intakeWindow, lateDays, weeklyWindows } from "./reports";

export type Dot = "in" | "late" | "missing" | "due" | "old" | "na" | "booked" | "asked";
export type StripForm = { kind: string; week_number: number; status: string; submitted_at: string | null; due_by: string | null };
export type StripFollowup = { n: number; status: string };
export type Strip = {
  intake: Dot; weeks: Dot[]; handover: Dot; fups: Dot[];
  paid: { amount: number | null; paid: number | null; owed: number | null; status: string | null } | null;
};
export const DOT_LABEL: Record<Dot, string> = { in: "in on time", late: "in, late", missing: "missing", due: "not due yet", old: "before the app", na: "not needed", booked: "booked", asked: "asked for" };

function one(forms: StripForm[], kind: string, week: number, deadline: string, now: Date): Dot {
  const r = forms.find((x) => x.kind === kind && x.week_number === week);
  if (r?.status === "waived") return "na";
  if (r && r.submitted_at && ["submitted", "approved", "changes_requested"].includes(r.status)) return lateDays(r.submitted_at, r.due_by || endOfDay(deadline).toISOString()) > 0 ? "late" : "in";
  if (deadline < "2026-10-23") return "old";
  return now > endOfDay(deadline) ? "missing" : "due";
}

export function programStrip(b: { start_date: string; end_date: string; status: string }, forms: StripForm[], fups: StripFollowup[], money: Strip["paid"], now = new Date()): Strip {
  const cancelled = b.status === "cancelled";
  const iw = intakeWindow(b.start_date), hw = handoverWindow(b.end_date);
  const intake = beforeApp(iw) ? "old" : one(forms, "intake", 0, iw.deadline, now);
  const weeks = weeklyWindows(b.start_date, b.end_date).slice(0, 6).map((w) => (beforeApp(w) ? "old" : one(forms, "weekly", w.week, w.deadline, now)));
  const handover = beforeApp(hw) ? "old" : one(forms, "handover", 0, hw.deadline, now);
  const fu = [1, 2, 3].map((n): Dot => { const s = fups.filter((f) => f.n === n).map((f) => f.status); return s.includes("done") ? "in" : s.includes("confirmed") ? "booked" : s.includes("requested") ? "asked" : s.includes("missed") ? "missing" : "due"; });
  return cancelled ? { intake: "na", weeks: weeks.map(() => "na"), handover: "na", fups: fu.map(() => "na"), paid: money } : { intake, weeks, handover, fups: fu, paid: money };
}
