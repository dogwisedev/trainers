// The three trainer forms, their deadlines and validation. Pure functions (no database), so they're easy to test.
//
//  Intake form          on the day of pickup (the booking's first day)
//  Weekly health check  one for every Wednesday the dog is in care: open Wed, late after Fri ($100 penalty if late or missing)
//  Handover report      open from the last day of training, late after 2 more days; this one goes to the client
// Deadlines are the END of that day, Eastern time.
import { addDays, toDate } from "./dates";

export type Kind = "intake" | "weekly" | "handover";
export type MediaItem = { id: string; name: string; kind: "video" | "photo"; slot: "training" | "homework" | "health"; description?: string; sig?: string; size?: number };
export type Answers = Record<string, unknown>;
export type Status = "draft" | "submitted" | "changes_requested" | "approved" | "waived"; // waived = an admin marked it "not needed"

// ── Deadlines ───────────────────────────────────────────────────────────
export const REPORT_TZ = "America/New_York";

function tzOffsetMs(utcMs: number, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}
/** The instant 23:59:59 on that calendar date in the business timezone. */
export function endOfDay(iso: string, tz = REPORT_TZ): Date {
  const [y, m, d] = iso.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 23, 59, 59);
  let t = guess - tzOffsetMs(guess, tz);
  const off2 = tzOffsetMs(t, tz);
  if (guess - off2 !== t) t = guess - off2;
  return new Date(t);
}
export const startOfDay = (iso: string, tz = REPORT_TZ) => new Date(endOfDay(iso, tz).getTime() - (86400000 - 1000));

export type Window = { kind: Kind; week: number; opens: string; deadline: string }; // dates (YYYY-MM-DD)
export const intakeWindow = (start: string): Window => ({ kind: "intake", week: 0, opens: start, deadline: start });
/**
 * One health check per Wednesday the dog is in care (after pickup day, before drop-off).
 * The window is Thursday to Wednesday: it opens the Thursday before (or on pickup day if later) and is late after the Wednesday,
 * so it's in before the pay weekend it counts for (e.g. week ending Oct 18: Oct 8 to Oct 14). Late or missing = $100.
 * Weeks before NEW_WEEKLY_FROM keep the old Wednesday-to-Friday window, so nobody is made late after the fact.
 */
const NEW_WEEKLY_FROM = "2026-10-21";
export function weeklyWindows(start: string, end: string): Window[] {
  const out: Window[] = [];
  for (let d = addDays(start, 1); d < end; d = addDays(d, 1)) {
    if (toDate(d).getUTCDay() !== 3) continue;
    const thursday = addDays(d, -6);
    out.push(d >= NEW_WEEKLY_FROM
      ? { kind: "weekly", week: out.length + 1, opens: thursday > start ? thursday : start, deadline: d }
      : { kind: "weekly", week: out.length + 1, opens: d, deadline: addDays(d, 2) });
  }
  return out;
}
export const handoverWindow = (end: string): Window => ({ kind: "handover", week: 0, opens: end, deadline: addDays(end, 2) });

export type BookingForReports = { id: string; trainer_id: string; client_name: string; dog_name: string | null; start_date: string; end_date: string; weeks: number | null; status: string; reports_enabled?: boolean | null };
/** Every form a booking should produce, with its window. */
export function expectedReports(b: BookingForReports): Window[] {
  return [intakeWindow(b.start_date), ...weeklyWindows(b.start_date, b.end_date), handoverWindow(b.end_date)];
}

export type RowLike = { booking_id: string; kind: Kind; week_number: number; status: Status; submitted_at?: string | null; due_by?: string | null; id?: string };
export type Todo = { booking: BookingForReports; window: Window; state: "open" | "overdue" | "draft" | "changes" | "waiting" | "approved"; report?: RowLike; daysLate: number };

/** What a trainer (or admin) still owes, from bookings + the reports that exist. `now` is injectable for tests. */
export function todos(bookings: BookingForReports[], reports: RowLike[], now = new Date(), horizonDays = 60): Todo[] {
  const out: Todo[] = [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TZ }).format(now);
  for (const b of bookings) {
    if (b.status === "cancelled" || !b.reports_enabled) continue;
    for (const w of expectedReports(b)) {
      if (now < startOfDay(w.opens)) continue;                       // window hasn't opened yet
      const r = reports.find((x) => x.booking_id === b.id && x.kind === w.kind && x.week_number === w.week);
      const deadline = endOfDay(w.deadline);
      const late = now > deadline;
      const daysLate = late ? Math.max(1, Math.ceil((now.getTime() - deadline.getTime()) / 86400000)) : 0;
      if (r?.status === "approved" || r?.status === "waived") { continue; }
      if (r?.status === "submitted") { out.push({ booking: b, window: w, state: "waiting", report: r, daysLate: 0 }); continue; }
      if (late && daysLate > horizonDays) continue;                  // ancient: ignore
      out.push({ booking: b, window: w, report: r, daysLate,
        state: r?.status === "changes_requested" ? "changes" : r ? (late ? "overdue" : "draft") : late ? "overdue" : "open" });
    }
  }
  const order = { changes: 0, overdue: 1, open: 2, draft: 2, waiting: 3, approved: 4 } as const;
  return out.sort((a, z) => order[a.state] - order[z.state] || a.window.deadline.localeCompare(z.window.deadline));
}

/** Days late a submission was (0 = on time). */
export function lateDays(submittedAt: string | null | undefined, dueBy: string | null | undefined) {
  if (!submittedAt || !dueBy) return 0;
  const ms = new Date(submittedAt).getTime() - new Date(dueBy).getTime();
  return ms > 0 ? Math.ceil(ms / 86400000) : 0;
}

// ── Form definitions ────────────────────────────────────────────────────
// Names, emails and dates the app already knows are filled in for the trainer; they only answer what we can't know.
export type Field =
  | { key: string; label: string; type: "text" | "textarea" | "date" | "number"; required?: boolean; hint?: string }
  | { key: string; label: string; type: "single" | "multi"; options: string[]; required?: boolean; hint?: string; other?: boolean }
  | { key: string; label: string; type: "yesno"; required?: boolean; detail?: "yes" | "no" | "none"; detailLabel?: string }
  | { key: string; label: string; type: "confirm"; required?: boolean };
export type Section = { title: string; fields: Field[] };

export const WEEKLY_SECTIONS: Section[] = [
  { title: "Health", fields: [
    { key: "skin", label: "Skin & coat: any hot spots, missing fur, redness, bumps or irritation?", type: "yesno", required: true },
    { key: "body", label: "Body & limbs: any limping, swelling, sensitivity to touch or discomfort?", type: "yesno", required: true },
    { key: "eyes", label: "Eyes, ears & mouth: any discharge, odor, redness or unusual buildup?", type: "yesno", required: true },
    { key: "weight", label: "Weight & body condition compared with last week", type: "single", required: true, options: ["About the same", "Heavier", "Lighter"], hint: "Ribs easily felt? Belly tuck visible?" },
    { key: "weightNote", label: "If heavier or lighter, what did you notice?", type: "textarea" },
    { key: "weightLb", label: "Weight in lb, if you have a scale", type: "number" }
  ] },
  { title: "Digestion and appetite", fields: [
    { key: "stool", label: "Stool consistency this week", type: "single", required: true, options: ["Firm", "Soft", "Loose", "Mixed"] },
    { key: "potty", label: "Any potty accidents, vomiting or unusual straining?", type: "yesno", required: true },
    { key: "appetite", label: "Any change in how eagerly the dog eats or drinks, or in food, portions or supplements?", type: "yesno", required: true }
  ] },
  { title: "Energy and mood", fields: [
    { key: "mood", label: "How have the dog's energy and mood been this week?", type: "textarea", required: true },
    { key: "notes", label: "Anything else the team should know?", type: "textarea" }
  ] }
];

export const INTAKE_SECTIONS: Section[] = [
  { title: "Pickup", fields: [
    { key: "pickupDate", label: "Date of pickup", type: "date", required: true },
    { key: "dogBreed", label: "Dog's breed", type: "text" },
    { key: "behavior", label: "Overall behavior assessment during pickup", type: "textarea", required: true }
  ] },
  { title: "What came with the dog", fields: [
    { key: "items", label: "List of items given by the client", type: "textarea", required: true },
    { key: "foodProvided", label: "Did the client provide dog food?", type: "yesno", required: true, detailLabel: "how much food was provided?" },
    { key: "foodDaily", label: "How much does the dog eat daily?", type: "text", required: true },
    { key: "foodSame", label: "Is it the same food the dog eats at home?", type: "yesno", required: true, detail: "none" },
    { key: "medication", label: "Is the dog on medication?", type: "yesno", required: true, detailLabel: "health issue, medication name and how often it's given" }
  ] },
  { title: "Condition at pickup", fields: [
    { key: "snout", label: "Snout to tail: thorough check of the dog's physical well-being, with the owner present", type: "textarea", required: true },
    { key: "concerns", label: "Did the client raise any training concerns at pickup that we didn't already know about?", type: "textarea" }
  ] },
  { title: "Route and mileage", fields: [
    { key: "mileage", label: "Miles driven for this pickup", type: "number", required: true, hint: "Round trip. Used for your mileage pay. Enter 0 if the client brought the dog to you." },
    { key: "route", label: "Route taken (optional)", type: "text" }
  ] }
];

// The handover report has repeatable parts (training items, homework items) and picks its videos from the chat.
export const HANDOVER_SIMPLE: Field[] = [
  { key: "program", label: "Training program", type: "text", required: true, hint: "One of: Adolescent Essentials, Anxiety Support, Big Puppy, Puppy Foundations, Reactivity & Aggression Reset, Rescue Restart, Strong Companion. It's on the client's certificate." },
  { key: "clientLocation", label: "Client's location", type: "text" },
  { key: "goals", label: "What are the client's main goals and focus?", type: "textarea", required: true, hint: "The personal goal or behavior the client wants worked on. This was the main focus of the training." }
];
export const HANDOVER_AFTER: Field[] = [
  { key: "healthAtHandover", label: "Snout to tail: findings from the health check at the handover session, with the owner present", type: "textarea", required: true },
  { key: "extra", label: "Anything else to tell the client", type: "textarea" },
  { key: "overall", label: "Overall trainer review of the program", type: "textarea", required: true, hint: "Biggest opportunities and challenges, top 5 issues and outcomes, overall review." }
];
/** Drop-off mileage: for the trainer's pay, never shown to the client (not in the handover report). */
export const HANDOVER_ROUTE: Field[] = [
  { key: "mileage", label: "Miles driven for this drop-off", type: "number", required: true, hint: "Round trip. Used for your mileage pay, not sent to the client. Enter 0 if the client collected the dog." },
  { key: "route", label: "Route taken (optional)", type: "text" }
];
export type Item = { title: string; text: string };


// ── Answers helpers ─────────────────────────────────────────────────────
export const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
/** What the person typed, spaces and all (for text boxes). Use s() only to check or display. */
export const raw = (v: unknown) => (typeof v === "string" ? v : "");
export const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);
export const items = (v: unknown): Item[] => (Array.isArray(v) ? v.map((x) => ({ title: s((x as Item)?.title), text: s((x as Item)?.text) })) : []);
export const rawItems = (v: unknown): Item[] => (Array.isArray(v) ? v.map((x) => ({ title: raw((x as Item)?.title), text: raw((x as Item)?.text) })) : []);
export const yesno = (a: Answers, key: string) => ({ yes: a[key] === "yes", no: a[key] === "no", detail: s(a[`${key}_detail`]) });


/** Short things for the admin to look at in a weekly check or intake form. */
export function healthFlags(kind: Kind, a: Answers): string[] {
  const out: string[] = [];
  if (kind === "weekly") {
    const names: Record<string, string> = { skin: "Skin & coat", body: "Body & limbs", eyes: "Eyes, ears & mouth", potty: "Digestion", appetite: "Appetite or diet" };
    for (const [k, n] of Object.entries(names)) if (a[k] === "yes") out.push(n);
    if (s(a.weight) && s(a.weight) !== "About the same") out.push(`Weight: ${s(a.weight).toLowerCase()}`);
    if (s(a.stool) && s(a.stool) !== "Firm") out.push(`Stool: ${s(a.stool).toLowerCase()}`);
  }
  if (kind === "intake" && a.medication === "yes") out.push("On medication");
  return out;
}

/** Missing required things, in plain words. Empty = ready to submit. */
/** `skip`: questions not to insist on (admins approving forms sent before mileage was asked). */
export function validate(kind: Kind, a: Answers, media: MediaItem[], opts: { skip?: string[] } = {}): string[] {
  const missing: string[] = [];
  const need = (label: string, ok: boolean) => { if (!ok) missing.push(label); };
  need("Dog's name", !!s(a.dogName)); need("Trainer's name", !!s(a.trainerName));
  if (kind === "handover") { need("Client's name", !!s(a.clientName)); need("Client's email", /^\S+@\S+\.\S+$/.test(s(a.clientEmail))); }
  const check = (f: Field) => {
    if (!("required" in f) || !f.required || opts.skip?.includes(f.key)) return;
    if (f.type === "multi") { const picked = arr(a[f.key]); need(f.label, picked.length > 0 || !!s(a[`${f.key}_other`])); }
    else if (f.type === "yesno") {
      need(f.label, a[f.key] === "yes" || a[f.key] === "no");
      const on = f.detail ?? "yes";
      if (on !== "none" && a[f.key] === on) need(`${f.label} (${f.detailLabel || "describe it"})`, !!s(a[`${f.key}_detail`]));
    }
    else if (f.type === "confirm") need(f.label, a[f.key] === true);
    else if (f.type === "date") need(f.label, /^\d{4}-\d{2}-\d{2}$/.test(s(a[f.key])));
    else if (f.type === "number") need(f.label, /^\d+(\.\d+)?$/.test(s(String(a[f.key] ?? ""))) && Number(a[f.key]) <= 2000);
    else need(f.label, !!s(a[f.key]));
  };
  if (kind === "weekly") WEEKLY_SECTIONS.forEach((sec) => sec.fields.forEach(check));
  else if (kind === "intake") INTAKE_SECTIONS.forEach((sec) => sec.fields.forEach(check));
  else {
    HANDOVER_SIMPLE.forEach(check); HANDOVER_AFTER.forEach(check); HANDOVER_ROUTE.forEach(check);
    const t = items(a.training).filter((i) => i.title || i.text), h = items(a.homework).filter((i) => i.title || i.text);
    need("At least one training item", t.length > 0 && t.every((i) => i.text));
    need("At least one homework item", h.length > 0 && h.every((i) => i.text));
    // The photo with the trainer is NOT required: the form can go without it, and an incident is opened instead (app/report-actions.ts).
  }
  return missing;
}

/** Has the handover got its photo of the dog with the trainer? */
export const hasTrainerPhoto = (media: MediaItem[]) => media.some((m) => m.slot === "health" && m.kind === "photo");
/** The reminder shown on the form instead of blocking it. */
export const MEDIA_ADVICE: Record<Kind, string> = {
  intake: "Please update video on chat: post the pickup photos and a video in the dog's chat (show any injuries, cuts, scars or missing parts clearly).",
  weekly: "Please update video on chat: send photos and videos in the dog's chat, not on this form.",
  handover: "Please update video on chat: post a photo of you with the dog in the chat, then pick it below."
};

export const kindName = (kind: Kind) => (kind === "weekly" ? "Weekly health check" : kind === "intake" ? "Intake form" : "Handover report");
export const reportTitle = (kind: Kind, week: number, dog: string) =>
  kind === "weekly" ? `Weekly health check, week ${week}: ${dog || "dog"}` : kind === "intake" ? `Intake form for ${dog || "the dog"}` : `Handover report for ${dog || "your dog"}`;
/** One line telling the trainer when it's due. */
export const deadlineHint = (kind: Kind) =>
  kind === "weekly" ? "Submit between Thursday and the Wednesday it's due. Late (after the Wednesday) or missing checks carry a $100 penalty."
  : kind === "intake" ? "Complete this on the day of pickup."
  : "Open from the last day of training. Submit within 2 days after drop-off. This is what the client receives as their graduation report card.";
