// Dogs → Filters: conditions that stack (all must match), on top of the tab, trainer, POC and search. Built from the
// office's HubSpot reports, which are all "a date window + a condition": "Vaccines missing - This Weekend",
// "Forms missing - This Weekend", "Remaining balance missing - This Weekend", "To Start - This Weekend",
// "Handover this Weekend", "To complete this week / next week" (by State, Trainer, POC), "Money Outstanding"…
// Kept in the URL, so a filtered list can be bookmarked, shared, and exported as it is.
import type { Strip } from "./programStrip";

export type DogFilter = {
  sw?: string; ew?: string;           // a relative window for the start / end (today, weekend, week…): saved views stay right
  sf?: string; st?: string;           // starts from / to (YYYY-MM-DD; the same day twice = "on")
  ef?: string; et?: string;           // ends from / to
  vac?: "missing" | "ok"; forms?: "missing" | "done"; bal?: "owed" | "paid";
  rep?: "late"; ho?: "missing" | "in"; fu?: "none" | "asked" | "booked" | "done"; pu?: "late";
  state?: string; prog?: string;
};
export const FILTER_KEYS = ["sw", "ew", "sf", "st", "ef", "et", "vac", "forms", "bal", "rep", "ho", "fu", "pu", "state", "prog"] as const;
export const WINDOWS: [string, string][] = [["today", "Today"], ["weekend", "This weekend (Thu–Wed)"], ["week", "This week"], ["nextweek", "Next week"], ["next7", "Next 7 days"], ["next14", "Next 14 days"], ["month", "This month"], ["last7", "Last 7 days"]];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const one = <T extends string>(v: unknown, ok: readonly T[]) => (ok.includes(String(v) as T) ? (String(v) as T) : undefined);

export function parseFilter(sp: Record<string, string | undefined> | URLSearchParams, today?: string): DogFilter {
  const g = (k: string) => (sp instanceof URLSearchParams ? sp.get(k) || undefined : sp[k]);
  const d = (k: string) => (DATE.test(g(k) || "") ? g(k) : undefined);
  const win = (k: string) => (WINDOWS.some(([x]) => x === g(k)) ? g(k) : undefined);
  const sw = win("sw"), ew = win("ew"), w = today ? windows(today) : null;
  return {
    sw, ew,
    sf: sw && w ? w[sw][0] : d("sf"), st: sw && w ? w[sw][1] : d("st"), ef: ew && w ? w[ew][0] : d("ef"), et: ew && w ? w[ew][1] : d("et"),
    vac: one(g("vac"), ["missing", "ok"] as const), forms: one(g("forms"), ["missing", "done"] as const), bal: one(g("bal"), ["owed", "paid"] as const),
    rep: one(g("rep"), ["late"] as const), ho: one(g("ho"), ["missing", "in"] as const), fu: one(g("fu"), ["none", "asked", "booked", "done"] as const), pu: one(g("pu"), ["late"] as const),
    state: /^[A-Z]{2}$/.test(g("state") || "") ? g("state") : undefined, prog: (g("prog") || "").trim().slice(0, 80) || undefined
  };
}
export const activeCount = (f: DogFilter) => FILTER_KEYS.filter((k) => !["sw", "ew", "st", "et"].includes(k) && f[k]).length + (!f.sf && f.st ? 1 : 0) + (!f.ef && f.et ? 1 : 0);
/** Needs the before-training checklist (vaccines, forms, balance from the checklist). */
export const needsReadiness = (f: DogFilter) => !!(f.vac || f.forms || f.bal);

// ── Date windows, as the reports use them ("This Weekend" = Thursday to Wednesday) ──
const iso = (d: Date) => d.toISOString().slice(0, 10);
const at = (s: string) => new Date(`${s}T12:00:00Z`);
const plus = (s: string, n: number) => { const d = at(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export function windows(today: string) {
  const dow = at(today).getUTCDay();                                  // 0 Sun … 6 Sat
  const thu = plus(today, dow === 4 ? 0 : dow < 4 ? 4 - dow : 11 - dow); // this coming Thursday (today if Thursday)
  const weekendFrom = dow >= 4 || dow === 0 ? plus(today, -((dow + 3) % 7)) : thu;  // Thu–Sun: the current Thu–Wed; Mon–Wed: the next one
  const mon = plus(today, -((dow + 6) % 7));
  const m0 = `${today.slice(0, 7)}-01`, mEnd = iso(new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 0)));
  return { weekend: [weekendFrom, plus(weekendFrom, 6)], week: [mon, plus(mon, 6)], nextweek: [plus(mon, 7), plus(mon, 13)], month: [m0, mEnd], today: [today, today],
    next7: [today, plus(today, 6)], next14: [today, plus(today, 13)], last7: [plus(today, -6), today] } as Record<string, [string, string]>;
}

// ── The starting views (the office's reports); saved in the database so people can add their own and remove these ──
export const DEFAULT_VIEWS: { name: string; query: string }[] = [
  { name: "Starting this weekend", query: "f=upcoming&sw=weekend" },
  { name: "Vaccines missing · this weekend", query: "f=upcoming&sw=weekend&vac=missing" },
  { name: "Forms missing · this weekend", query: "f=upcoming&sw=weekend&forms=missing" },
  { name: "Balance due · this weekend", query: "f=upcoming&sw=weekend&bal=owed" },
  { name: "Handover this weekend", query: "f=now&ew=weekend" },
  { name: "Completing next week", query: "f=now&ew=nextweek" },
  { name: "Money outstanding", query: "f=now&bal=owed" },
  { name: "Finished, no follow-up booked", query: "f=finished&fu=none" }
];

// ── The rule ──
export type FilterRow = { start_date: string; end_date: string; status: string; program: string | null; weeks: number; picked_up_at?: string | null; strip?: Strip; state?: string | null };
export type FilterReady = { missing: { key: string }[] } | null | undefined;
export function matches(r: FilterRow, f: DogFilter, ready: FilterReady, today: string): boolean {
  if (f.sf && r.start_date < f.sf) return false; if (f.st && r.start_date > f.st) return false;
  if (f.ef && r.end_date < f.ef) return false; if (f.et && r.end_date > f.et) return false;
  if (f.state && (r.state || "") !== f.state) return false;
  if (f.prog && (r.program || `${r.weeks}-week`).toLowerCase() !== f.prog.toLowerCase()) return false;
  const miss = new Set((ready?.missing || []).map((m) => m.key));
  if (f.vac && (f.vac === "missing") !== miss.has("vaccines")) return false;
  if (f.forms) { const m = ["home", "dog", "goals", "food", "meds"].some((k) => miss.has(k)); if ((f.forms === "missing") !== m) return false; }
  if (f.bal) { const owed = miss.has("balance") || (r.strip?.paid?.owed ?? 0) > 0; if ((f.bal === "owed") !== owed) return false; }
  const s = r.strip;
  if (f.rep === "late" && !(s && s.weeks.some((d) => d === "late" || d === "missing"))) return false;
  if (f.ho) { const v = s?.handover; if (f.ho === "missing" ? v !== "missing" : !(v === "in" || v === "late")) return false; }
  if (f.fu) { const fu = s?.fups || []; const ok = f.fu === "none" ? fu.every((d) => d === "due" || d === "missing" || d === "na") : f.fu === "asked" ? fu.includes("asked") : f.fu === "booked" ? fu.includes("booked") : fu.includes("in"); if (!ok) return false; }
  if (f.pu === "late" && !(r.status !== "cancelled" && !r.picked_up_at && r.start_date < today && r.start_date >= "2026-11-01")) return false;
  return true;
}

/** Plain words for the chips above the list. */
export function describe(f: DogFilter): { key: string; text: string; drop: string[] }[] {
  const out: { key: string; text: string; drop: string[] }[] = [];
  const day = (s: string) => at(s).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const range = (a?: string, b?: string) => (a && b ? (a === b ? `on ${day(a)}` : `${day(a)} to ${day(b)}`) : a ? `from ${day(a)}` : b ? `until ${day(b)}` : "");
  const wl = (k?: string) => WINDOWS.find(([x]) => x === k)?.[1].replace(/ \(Thu–Wed\)/, "").toLowerCase();
  if (f.sw || f.sf || f.st) out.push({ key: "s", text: `Starts ${f.sw ? wl(f.sw) : range(f.sf, f.st)}`, drop: ["sw", "sf", "st"] });
  if (f.ew || f.ef || f.et) out.push({ key: "e", text: `Ends ${f.ew ? wl(f.ew) : range(f.ef, f.et)}`, drop: ["ew", "ef", "et"] });
  if (f.vac) out.push({ key: "vac", text: f.vac === "missing" ? "Vaccines missing" : "Vaccines OK", drop: ["vac"] });
  if (f.forms) out.push({ key: "forms", text: f.forms === "missing" ? "Forms missing" : "Forms done", drop: ["forms"] });
  if (f.bal) out.push({ key: "bal", text: f.bal === "owed" ? "Balance owed" : "Paid in full", drop: ["bal"] });
  if (f.pu) out.push({ key: "pu", text: "Pickup not confirmed", drop: ["pu"] });
  if (f.rep) out.push({ key: "rep", text: "Weekly reports late or missing", drop: ["rep"] });
  if (f.ho) out.push({ key: "ho", text: f.ho === "missing" ? "Handover missing" : "Handover in", drop: ["ho"] });
  if (f.fu) out.push({ key: "fu", text: { none: "No follow-up booked", asked: "Follow-up asked for", booked: "Follow-up booked", done: "Follow-up done" }[f.fu], drop: ["fu"] });
  if (f.state) out.push({ key: "state", text: `In ${f.state}`, drop: ["state"] });
  if (f.prog) out.push({ key: "prog", text: f.prog, drop: ["prog"] });
  return out;
}
