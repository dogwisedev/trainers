// What a Dogs row says, in plain words, and its one colour: red = something's wrong, amber = needs a look, green = on
// track, grey = nothing to do. Pure, so it's tested and the list never says something different from the dog page.
import { handoverWindow, weeklyWindows } from "./reports";
import { CONFIRM_FROM } from "./moveRules";
import type { Strip, Dot } from "./programStrip";

export type Tone = "red" | "amber" | "green" | "grey";
export type Step = { label: string; state: "in" | "late" | "missing" | "next" };
export type RowStatus = { tone: Tone; headline: string; issues: { text: string; tone: Tone }[]; steps: Step[] };
type R = { start_date: string; end_date: string; status: string; picked_up_at?: string | null; dropped_off_at?: string | null; cancelReason?: string | null; strip?: Strip };

const day = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const short = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const between = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const worst = (xs: Tone[]): Tone => (xs.includes("red") ? "red" : xs.includes("amber") ? "amber" : "green");

/** The forms so far, in words: what's in, what's late or missing, and the next one due. Before-the-app forms are left out. */
function steps(r: R): Step[] {
  const s = r.strip; if (!s) return [];
  const w = weeklyWindows(r.start_date, r.end_date), hw = handoverWindow(r.end_date);
  const all: { label: string; d: Dot; due: string }[] = [{ label: "Intake", d: s.intake, due: r.start_date }, ...s.weeks.map((d, i) => ({ label: `Week ${i + 1}`, d, due: w[i]?.deadline || r.end_date })), { label: "Handover", d: s.handover, due: hw.deadline }];
  const out: Step[] = [];
  for (const x of all) {
    if (x.d === "old" || x.d === "na") continue;
    if (x.d === "in") out.push({ label: x.label, state: "in" });
    else if (x.d === "late") out.push({ label: x.label, state: "late" });
    else if (x.d === "missing") out.push({ label: x.label, state: "missing" });
    else { out.push({ label: `${x.label} due ${short(x.due)}`, state: "next" }); break; } // only the next one ahead
  }
  return out;
}

export function rowStatus(r: R, tab: string, today: string, beforeMissing: number | null): RowStatus {
  const owed = r.strip?.paid?.owed ?? 0;
  if (r.status === "cancelled") return { tone: "grey", headline: `Cancelled${r.cancelReason ? `: ${r.cancelReason}` : ""}`, issues: [], steps: [] };
  const issues: { text: string; tone: Tone }[] = [];
  // Upcoming: before training
  if (tab === "upcoming") {
    const overdue = !r.picked_up_at && r.start_date < today && r.start_date >= CONFIRM_FROM;
    const inDays = between(today, r.start_date);
    const headline = overdue ? `Pickup not confirmed (was ${day(r.start_date)})` : inDays === 0 ? "Starts today" : inDays === 1 ? `Starts tomorrow, ${day(r.start_date)}` : `Starts ${day(r.start_date)}, in ${inDays} days`;
    const soon = overdue || inDays <= 3;
    if (beforeMissing) issues.push({ text: `${beforeMissing} before-training ${beforeMissing === 1 ? "item" : "items"} missing`, tone: soon ? "red" : "amber" });
    if (owed > 0) issues.push({ text: `${money(owed)} owed`, tone: soon ? "red" : "amber" });
    return { tone: overdue ? "red" : issues.length ? worst(issues.map((i) => i.tone)) : "green", headline, issues, steps: [] };
  }
  const st = steps(r);
  for (const x of st) if (x.state === "missing") issues.push({ text: `${x.label} ${x.label === "Intake" ? "form" : "report"} missing`, tone: "red" });
  if (owed > 0) issues.push({ text: `${money(owed)} owed`, tone: "amber" });
  // In care
  if (tab === "now") {
    const overdue = !r.dropped_off_at && r.end_date < today && r.end_date >= CONFIRM_FROM;
    const total = between(r.start_date, r.end_date), dayN = Math.min(total, Math.max(1, between(r.start_date, today) + 1));
    const headline = overdue ? `Drop-off not confirmed (was ${day(r.end_date)})` : r.end_date === today ? "Going home today" : `Day ${dayN} of ${total} · home ${day(r.end_date)}`;
    if (overdue) issues.unshift({ text: "Confirm the drop-off", tone: "red" });
    return { tone: issues.length ? worst(issues.map((i) => i.tone)) : "green", headline, issues, steps: st };
  }
  // Finished
  const fu = r.strip?.fups || [];
  const done = fu.filter((d) => d === "in").length, booked = fu.filter((d) => d === "booked").length, asked = fu.includes("asked");
  if (asked) issues.push({ text: "The client asked for a follow-up", tone: "amber" });
  const fuText = done || booked ? `Follow-ups: ${[done && `${done} done`, booked && `${booked} booked`].filter(Boolean).join(", ")} of 3` : "No follow-ups booked";
  return { tone: issues.length ? worst(issues.map((i) => i.tone)) : "grey", headline: `Home ${day(r.end_date)} · ${fuText}`, issues, steps: st.filter((x) => x.state !== "next") };
}
