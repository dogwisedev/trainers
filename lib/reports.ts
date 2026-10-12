// Report cards: the form definitions, deadlines and validation. Pure functions (no database), so they're easy to test.
//
// Weekly report: due by the Wednesday of each program week (window opens the Thursday before). Anita's rule:
//   for the week ending Sunday Oct 18, submit between Thu Oct 8 and Wed Oct 14.
// Handover report: due within 2 days after drop-off (the program's last day).
// Deadlines are the END of that day, Eastern time.
import { addDays, toDate } from "./dates";

export type Kind = "weekly" | "handover";
export type MediaItem = { id: string; name: string; kind: "video" | "photo"; slot: "training" | "homework" | "health"; description?: string; sig?: string; size?: number };
export type Answers = Record<string, unknown>;
export type Status = "draft" | "submitted" | "changes_requested" | "approved";

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

/** Sunday that ends the Monday-to-Sunday week containing program week `k` (1-based). */
function weekEndingSunday(start: string, k: number) {
  const d = addDays(start, 7 * k - 1);
  return addDays(d, (7 - toDate(d).getUTCDay()) % 7);
}
export type Window = { kind: Kind; week: number; opens: string; deadline: string }; // dates (YYYY-MM-DD)
export function weeklyWindow(start: string, k: number): Window {
  const deadline = addDays(weekEndingSunday(start, k), -4); // the Wednesday
  return { kind: "weekly", week: k, opens: addDays(deadline, -6), deadline };
}
export function handoverWindow(end: string): Window {
  return { kind: "handover", week: 0, opens: addDays(end, -6), deadline: addDays(end, 2) };
}

export type BookingForReports = { id: string; trainer_id: string; client_name: string; dog_name: string | null; start_date: string; end_date: string; weeks: number | null; status: string; reports_enabled?: boolean | null };
/** Every report a booking should produce, with its window. */
export function expectedReports(b: BookingForReports): Window[] {
  const weeks = b.weeks || Math.max(1, Math.floor((Math.round((toDate(b.end_date).getTime() - toDate(b.start_date).getTime()) / 86400000) + 1) / 7));
  return [...Array.from({ length: weeks }, (_, i) => weeklyWindow(b.start_date, i + 1)), handoverWindow(b.end_date)];
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
      if (r?.status === "approved") { continue; }
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
export type Field =
  | { key: string; label: string; type: "text" | "textarea"; required?: boolean; hint?: string }
  | { key: string; label: string; type: "single" | "multi"; options: string[]; required?: boolean; hint?: string; other?: boolean }
  | { key: string; label: string; type: "yesno"; required?: boolean };
export type Section = { title: string; fields: Field[] };

export const FOCUS_OPTIONS = ["Obedience", "Manners", "Socialization", "Proper Play", "Canine Communication", "Fearful Behavior", "Separation Anxiety", "Confidence Building", "Reactivity", "Distractions"];
export const PROGRAM_TYPES = ["Puppy Program", "Adolescent & Adult Basic Obedience Program", "Advanced Program", "Anxiety Rehab Program", "Aggression Rehab Program"];

export const WEEKLY_SECTIONS: Section[] = [
  { title: "New routine", fields: [
    { key: "acclimating", label: "How I am acclimating to the new routine", type: "single", required: true, options: ["Great! Settling in nicely", "A little whiny here and there", "Still getting used to it"] },
    { key: "playtime", label: "During our playtimes I was", type: "single", required: true, options: ["Happy to play!", "Loved romping with my friends!", "A little distracted", "Testing boundaries", "A little devil"] },
    { key: "walks", label: "On our walks we", type: "multi", required: true, options: ["Enjoyed the weather", "Met new people", "Met new friends", "Focused on loose leash walking", "Got some energy out", "Happy to explore!"] },
    { key: "crate", label: "When crated I was", type: "single", required: true, options: ["A perfect angel!", "Took some time to settle down", "Still working on crate training"] },
    { key: "rewards", label: "My favorite rewards are", type: "text" }
  ] },
  { title: "Training", fields: [
    { key: "focuses", label: "This week our main focuses were", type: "multi", required: true, options: FOCUS_OPTIONS, other: true },
    { key: "personality", label: "My personality during training was", type: "multi", required: true, options: ["Outgoing", "Ready for whatever's next!", "Ready to work!", "A little distracted", "Shy", "Taking things slowly", "Loved every second!"] },
    { key: "improvements", label: "Notable improvements from this week", type: "textarea", required: true },
    { key: "nextFocus", label: "Next week's focuses are", type: "textarea", required: true },
    { key: "notes", label: "Additional notes from the trainer", type: "textarea", required: true }
  ] },
  { title: "Snout to tail: health check", fields: [
    { key: "physical", label: "Any physical observations on the dog upon health check?", type: "yesno", required: true },
    { key: "diet", label: "Any diet changes?", type: "yesno", required: true },
    { key: "appetite", label: "Any changes in the dog's appetite or thirst?", type: "yesno", required: true },
    { key: "bowel", label: "Any changes in bowel movements?", type: "yesno", required: true },
    { key: "potty", label: "Any potty accidents?", type: "yesno", required: true }
  ] }
];
// Handover has a few repeatable parts (training items, homework items) handled by the form itself.
export const HANDOVER_SIMPLE: Field[] = [
  { key: "programType", label: "Program type", type: "single", required: true, options: PROGRAM_TYPES },
  { key: "clientLocation", label: "Client's location", type: "text" },
  { key: "goals", label: "What are the client's main goals and focus?", type: "textarea", required: true, hint: "The personal goal or behavior the client wants worked on. This is the main focus of the training." },
];
export const HANDOVER_AFTER: Field[] = [
  { key: "additionalTraining", label: "Additional training details", type: "textarea", hint: "What was done and how. Can be generic, used for all reports with the same training." },
  { key: "additionalHomework", label: "Additional homework details", type: "textarea", hint: "Clear directions from the trainer, personalized for this client." },
  { key: "overall", label: "Overall trainer review of the program", type: "textarea", required: true, hint: "Biggest opportunities and challenges, top 5 issues and outcomes, overall review." }
];
export type Item = { title: string; text: string };

export const HEADER_KEYS = { weekly: ["clientName", "clientEmail", "dogName", "trainerName"], handover: ["clientName", "clientEmail", "dogName", "trainerName"] } as const;

// ── Answers helpers ─────────────────────────────────────────────────────
export const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
export const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);
export const items = (v: unknown): Item[] => (Array.isArray(v) ? v.map((x) => ({ title: s((x as Item)?.title), text: s((x as Item)?.text) })) : []);
export const yesno = (a: Answers, key: string) => ({ yes: a[key] === "yes", no: a[key] === "no", detail: s(a[`${key}_detail`]) });

/** Missing required things, in plain words. Empty = ready to submit. */
export function validate(kind: Kind, a: Answers, media: MediaItem[]): string[] {
  const missing: string[] = [];
  const need = (label: string, ok: boolean) => { if (!ok) missing.push(label); };
  need("Client's name", !!s(a.clientName)); need("Client's email", /^\S+@\S+\.\S+$/.test(s(a.clientEmail)));
  need("Dog's name", !!s(a.dogName)); need("Trainer's name", !!s(a.trainerName));
  const check = (f: Field) => {
    if (!("required" in f) || !f.required) return;
    if (f.type === "multi") { const picked = arr(a[f.key]); need(f.label, picked.length > 0 || !!s(a[`${f.key}_other`])); }
    else if (f.type === "yesno") { need(f.label, a[f.key] === "yes" || a[f.key] === "no"); if (a[f.key] === "yes") need(`${f.label} (describe it)`, !!s(a[`${f.key}_detail`])); }
    else need(f.label, !!s(a[f.key]));
  };
  if (kind === "weekly") {
    need("Training week number", Number(a.weekNumber) > 0);
    WEEKLY_SECTIONS.forEach((sec) => sec.fields.forEach(check));
  } else {
    HANDOVER_SIMPLE.forEach(check); HANDOVER_AFTER.forEach(check);
    const t = items(a.training).filter((i) => i.title || i.text), h = items(a.homework).filter((i) => i.title || i.text);
    need("At least one training item", t.length > 0 && t.every((i) => i.text));
    need("At least one homework item", h.length > 0 && h.every((i) => i.text));
    need("A photo of the dog with the trainer", media.some((m) => m.slot === "health" && m.kind === "photo"));
  }
  return missing;
}

export const reportTitle = (kind: Kind, week: number, dog: string) => (kind === "weekly" ? `Week ${week} report for ${dog || "your dog"}` : `Handover report for ${dog || "your dog"}`);
