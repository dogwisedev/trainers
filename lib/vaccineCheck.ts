import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { AiFile, aiOn, claude, jsonFrom, writerModel } from "./ai";
import { aiSettings } from "./aiSettings";
import { auditSystem } from "./audit";
import { fileBytes, fileMeta, photoBytes } from "./drive";
import { VACCINES, type VaccineAi, type VaccineState } from "./pretrainingFields";

// AI vaccine checks (migration 057). When a dog's vaccine records are uploaded in the app, Claude reads the files (PDFs and
// photos, from the dog's Drive folder) for Rabies, Bordetella and the distemper combination, and for each one the date
// given and the date it's valid until. The app, not Claude, then decides against the dog's stay: every one must be valid
// through the last day. The result ("all in order", what's missing or expired, or "check by hand") shows on the dog's
// Vaccines section and on the To do item, with the missing ones already ticked. A person still presses All OK or Save as
// missing, and what they decided is kept beside what the app said (Pulse → Office → AI help).
// Only records uploaded in the app are read: ones from the HubSpot form or by email are checked by hand, as before.
// The rules are on /a/ai (any admin can change them). Switch: Pulse → Office → AI help → Vaccine checks.

type Found = { found?: boolean; given?: string | null; validUntil?: string | null; sure?: boolean; note?: string; name?: string };
type Answer = { dogMatches?: boolean | null; rabies?: Found; bordetella?: Found; combo?: Found; note?: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clip = (v: unknown, n: number) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const SYSTEM = (rules: string) => `You read a dog's vaccination records for Dogwise Academy, a dog board-and-train business, so the office can confirm the dog is covered for its stay. You are given the records (photos or PDFs), the dog's name, the owner's name and the dates of the stay.

The office's rules:
${rules}

Read every page. For each of the three vaccines, find the most recent dose and report what the record says. Do not decide whether the dog may stay: only report what you can read.

Answer with JSON only:
{"dogMatches":true|false|null,"rabies":{"found":true|false,"given":"YYYY-MM-DD"|null,"validUntil":"YYYY-MM-DD"|null,"sure":true|false,"note":""},"bordetella":{...},"combo":{...,"name":"as written on the record"},"note":""}

- dogMatches: true if the record is clearly for this dog, false if it names a different dog, null if you can't tell.
- found: the vaccine appears on the record as given (not only "due" or "recommended").
- validUntil: by the rules above (the written due or expiry date, otherwise 1 year from the date given). null if you can't tell.
- sure: false whenever you had to guess a date or a name, the writing is hard to read, or the rules say it is for a person.
- note: a few words, only where a person needs to know something (for example "handwritten, year unclear"). Top-level note: one short sentence for the admin, or empty.`;

/** What the record says, turned into the office's answer for this stay. The dates are compared here, not by Claude. */
export function decide(a: Answer, stayEnd: string): Pick<VaccineAi, "verdict" | "missing" | "lines" | "note"> {
  const lines: VaccineAi["lines"] = [];
  const missing: string[] = [];
  let unclear = a.dogMatches !== true;
  const one = (label: (typeof VACCINES)[number], f: Found | undefined) => {
    const given = f?.given && DATE.test(f.given) ? f.given : null, until = f?.validUntil && DATE.test(f.validUntil) ? f.validUntil : null;
    const name = label === "DHLPP" && f?.name ? ` (${clip(f.name, 30)})` : "";
    let status = "ok", note = clip(f?.note, 120);
    if (!f || f.found !== true) { status = f?.sure === false ? "unclear" : "missing"; if (status === "missing") missing.push(label); else unclear = true; note = note || (status === "missing" ? "Not on the record" : "Couldn't tell if it's on the record"); }
    else if (f.sure === false || !until) { status = "unclear"; unclear = true; note = note || "Couldn't read the dates with confidence"; }
    else if (until < stayEnd) { status = "expired"; missing.push(label); note = `Valid until ${day(until)}, the stay ends ${day(stayEnd)}${note ? `. ${note}` : ""}`; }
    lines.push({ vaccine: `${label}${name}`, status, given, validUntil: until, note: note || undefined });
  };
  one("Rabies", a.rabies); one("Bordetella", a.bordetella); one("DHLPP", a.combo);
  const why = a.dogMatches === false ? "The record names a different dog." : a.dogMatches == null ? "Couldn't tell whether the record is for this dog." : "";
  return { verdict: unclear ? "unclear" : missing.length ? "missing" : "ok", missing, lines, note: [why, clip(a.note, 200)].filter(Boolean).join(" ") || undefined };
}

/** One line for To do and the dog page. */
export function vaccineSummary(ai: Pick<VaccineAi, "verdict" | "missing" | "lines" | "note">, stayEnd: string): string {
  if (ai.verdict === "ok") return `The app's check: all three in order through ${day(stayEnd)}. Confirm with All OK.`;
  const bad = ai.lines.filter((l) => l.status === "missing" || l.status === "expired").map((l) => `${l.vaccine.split(" (")[0]} ${l.status === "expired" ? "runs out before the stay ends" : "isn't on the record"}`);
  if (ai.verdict === "missing") return `The app's check: ${bad.join("; ")}. Look, then Save as missing (already ticked) or All OK.`;
  return `The app's check: needs a person${bad.length ? ` (${bad.join("; ")})` : ""}. ${ai.note || ai.lines.filter((l) => l.status === "unclear").map((l) => `${l.vaccine.split(" (")[0]}: ${l.note}`).join("; ")}`.trim();
}

/** The records uploaded in the app, as files Claude can read (up to 4). */
async function readable(files: { id: string; source?: string }[]): Promise<AiFile[]> {
  const out: AiFile[] = [];
  for (const f of files.filter((x) => x.source !== "hubspot" && !/^https?:/.test(x.id)).slice(-4)) {
    const meta = await fileMeta(f.id).catch(() => ({ ok: false as const }));
    const type = ("mimeType" in meta && meta.mimeType) || "";
    if (type === "application/pdf") { const b = await fileBytes(f.id); if (b) out.push({ kind: "pdf", mediaType: "application/pdf", base64: Buffer.from(b).toString("base64") }); }
    else if (type.startsWith("image/") || !type) {
      // Drive's own large preview: a JPEG whatever the phone took (HEIC too), and small enough to send
      const b = (await photoBytes(f.id, 2200)) || (await photoBytes(f.id, 1600));
      if (b && b.byteLength < 4_500_000) out.push({ kind: "image", mediaType: "image/jpeg", base64: Buffer.from(b).toString("base64") });
    }
  }
  return out;
}

type DogRow = { booking_id: string; vaccines: VaccineState | null };
/** Checks one dog's records. `force`: again, even if they were already checked. Never throws. */
export async function checkVaccines(bookingId: string, sb: SupabaseClient = serviceClient(), force = false): Promise<{ ok: boolean; message: string; ai?: VaccineAi }> {
  try {
    if (!aiOn()) return { ok: false, message: "The Claude key isn't set up (ANTHROPIC_API_KEY in Vercel)." };
    const cfg = await aiSettings(sb);
    if (!cfg.vaccineChecks) return { ok: false, message: "Vaccine checks are switched off (Pulse, Office, AI help)." };
    const [{ data: d }, { data: b }] = await Promise.all([
      sb.from("pretraining_dogs").select("booking_id, vaccines").eq("booking_id", bookingId).maybeSingle(),
      sb.from("bookings").select("id, dog_name, client_name, start_date, end_date").eq("id", bookingId).maybeSingle()
    ]);
    const row = d as DogRow | null;
    if (!row || !b) return { ok: false, message: "Dog not found." };
    const v = row.vaccines || {}, files = (v.files || []).filter((f) => f.source !== "hubspot");
    if (!files.length) return { ok: false, message: "No records uploaded in the app to read. Ones from the HubSpot form or by email are checked by hand." };
    const newest = files.reduce((a, f) => (f.at > a ? f.at : a), "");
    if (!force && v.ai && v.ai.at >= newest) return { ok: true, message: "Already checked.", ai: v.ai };
    const docs = await readable(files);
    const stamp = { at: new Date().toISOString(), files: docs.length };
    let result: Pick<VaccineAi, "verdict" | "missing" | "lines" | "note">;
    if (!docs.length) result = { verdict: "unclear", missing: [], lines: [], note: "The app couldn't open the files (a type it can't read, or too large). Check them by hand." };
    else {
      const a = jsonFrom<Answer>(await claude({ system: SYSTEM(cfg.vaccineRules), files: docs, maxTokens: 900, timeoutMs: 45000,
        user: `Dog: ${b.dog_name || "(no name given)"}. Owner: ${b.client_name}. Stay: ${b.start_date} to ${b.end_date}. Today is ${stamp.at.slice(0, 10)}.\n\nRead the attached record${docs.length > 1 ? "s" : ""} and answer.` }));
      if (!a) return { ok: false, message: "Couldn't read the records just now. Check them by hand, or try Check again in a minute." };
      result = decide(a, b.end_date);
    }
    const { data: saved } = await sb.from("ai_vaccine_checks").insert({ booking_id: bookingId, verdict: result.verdict, missing: result.missing, lines: result.lines, note: result.note || null, files: docs.length, model: writerModel() }).select("id").maybeSingle();
    const ai: VaccineAi = { ...result, ...stamp, checkId: saved?.id };
    // Onto the dog as it is now (a record may have come in, or a person may have decided, while this ran)
    const { data: now } = await sb.from("pretraining_dogs").select("vaccines").eq("booking_id", bookingId).maybeSingle();
    await sb.from("pretraining_dogs").update({ vaccines: { ...((now?.vaccines as VaccineState | null) || v), ai } }).eq("booking_id", bookingId);
    const line = vaccineSummary(ai, b.end_date);
    await sb.from("chat_incidents").update({ detail: `${b.dog_name || "The dog"}'s vaccine records are in (starts ${day(b.start_date)}). ${line}` }).eq("kind", "check_vaccines").eq("ref", `vax:${bookingId}`).neq("status", "resolved");
    await auditSystem("Checked vaccine records", `${b.dog_name || "Dog"} (${b.client_name}): ${line}`, { link: `/a/dogs/${bookingId}?tab=before#vaccines` }).catch(() => null);
    return { ok: true, message: line, ai };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

/** The 10-minute AI job: dogs whose records are waiting for the office and haven't been read since the newest file came in. */
export async function runVaccineChecks(sb: SupabaseClient = serviceClient(), limit = 1, until = Infinity) {
  const out = { checked: 0 };
  if (!aiOn()) return out;
  const { data, error } = await sb.from("pretraining_dogs").select("booking_id, vaccines").eq("vaccines->>status", "review").limit(200);
  if (error) return out;
  const todo = ((data || []) as DogRow[]).filter((d) => {
    const files = (d.vaccines?.files || []).filter((f) => f.source !== "hubspot");
    return files.length && !(d.vaccines?.ai && d.vaccines.ai.at >= files.reduce((a, f) => (f.at > a ? f.at : a), ""));
  }).slice(0, limit);
  for (const d of todo) { if (Date.now() > until) break; const r = await checkVaccines(d.booking_id, sb); if (r.ok) out.checked++; }
  return out;
}

/** What the admin decided (All OK, or which are missing), kept on the app's latest check of this dog. */
export async function noteVaccineOutcome(bookingId: string, ok: boolean, missing: string[], by: string, sb: SupabaseClient = serviceClient()) {
  try {
    const { data } = await sb.from("ai_vaccine_checks").select("id, verdict, missing").eq("booking_id", bookingId).is("outcome", null).order("created_at", { ascending: false }).limit(1);
    const c = (data || [])[0] as { id: string; verdict: string; missing: string[] } | undefined;
    if (!c) return;
    const same = (x: string[], y: string[]) => x.length === y.length && [...x].sort().join() === [...y].sort().join();
    const agreed = c.verdict === "unclear" ? null : c.verdict === "ok" ? ok : !ok && same(c.missing || [], missing);
    await sb.from("ai_vaccine_checks").update({ outcome: ok ? "ok" : "missing", outcome_missing: ok ? [] : missing, agreed, outcome_by: by, outcome_at: new Date().toISOString() }).eq("id", c.id);
  } catch { /* the record never gets in the way of the decision */ }
}

/** For Pulse → Office. */
export async function vaccineCheckStats(sb: SupabaseClient, sinceIso: string) {
  const { data, error } = await sb.from("ai_vaccine_checks").select("verdict, agreed, outcome").gte("created_at", sinceIso).limit(5000);
  if (error) return null;
  const rows = (data || []) as { verdict: string; agreed: boolean | null; outcome: string | null }[];
  const judged = rows.filter((r) => r.agreed !== null && r.outcome);
  return { checked: rows.length, inOrder: rows.filter((r) => r.verdict === "ok").length, missing: rows.filter((r) => r.verdict === "missing").length, byHand: rows.filter((r) => r.verdict === "unclear").length,
    decided: judged.length, agreed: judged.filter((r) => r.agreed).length, agreedPct: judged.length ? Math.round((judged.filter((r) => r.agreed).length / judged.length) * 100) : null };
}
