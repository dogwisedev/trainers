import "server-only";
import { getViewer } from "./data";
import { isDemo, serviceClient } from "./supabase";

// Activity log. Every server action calls auditCall() first: who did what, when, on which dog / chat / trainer.
// Never stores passwords. Never throws (a log failure must never stop the action).
export const LOG_VIEWERS = () => (process.env.LOG_VIEWERS || "alma@dogwiseacademy.com").toLowerCase().split(",").map((s) => s.trim());

const LABEL: Record<string, string> = {
  claudeTool: "Looked up app data through Claude",
  signOut: "Signed out", setPassword: "Changed their password", saveTrainer: "Saved a trainer profile", setTrainerActive: "Changed a trainer's active status",
  clearFlag: "Cleared a trainer profile flag", inviteTrainer: "Sent a trainer their login", addTimeOff: "Added time off", deleteTimeOff: "Removed time off",
  saveBooking: "Saved a booking", setExtraDays: "Changed extra days", setBookingStatus: "Changed a booking's status", sendMessage: "Sent a Trainer message",
  emailTrainerAboutBooking: "Emailed a trainer about a booking", sendSigninHellos: "Sent 'your app is ready' emails", logFollowupAction: "Logged a follow-up session",
  decideProbationAction: "Decided a probation", setFollowupsAction: "Set follow-up session dates", startChatAction: "Started a chat", inviteClientAction: "Invited a client to a chat",
  takeIncidentAction: "Took a to-do", resolveIncidentAction: "Marked a to-do Done", closeChatAction: "Closed a chat", reopenChatAction: "Reopened a chat",
  sendSummaryAgainAction: "Re-sent a chat summary", setClientEmailsAction: "Changed client chat emails", savePayslipAction: "Edited a payslip",
  approveAndSendAction: "Approved and sent a payslip", approveAction: "Approved a payslip", approveManyAction: "Approved several payslips",
  correctAndResendAction: "Corrected and re-sent a payslip", resendAction: "Re-sent a payslip", reopenAction: "Reopened a payslip", saveRatesAction: "Saved pay rates",
  submitReportAction: "Submitted a form", approveReportAction: "Approved a form", sendBackAction: "Sent a form back", resendReportAction: "Re-sent a form to the client",
  setReportsEnabledAction: "Turned forms on/off for a dog", waiveReportAction: "Marked a form not needed", unwaiveReportAction: "Brought back a form",
  saveProfileAction: "Edited before-training answers", reviewVaccinesAction: "Checked vaccines", setClearedAction: "Changed 'OK to start'", setSlotAction: "Changed which dog is which on a deal",
  signInPassword: "Signed in with their password", signInFailed: "Tried to sign in: wrong email or password", signInLinkSent: "Asked for a sign-in link by email",
  signInLinkUsed: "Signed in with an email link", pushOn: "Turned notifications on", pushOff: "Turned notifications off", pushTest: "Sent themselves a test notification",
  bookingApi: "Booked a dog from the HubSpot extension", signInCodeSent: "Asked for a sign-in code by email", signInCode: "Signed in with an email code",
  signInCodeFailed: "Tried a sign-in code: wrong or expired", uploadFailed: "Upload failed", uploadWarning: "Upload warning", setDisplayNameAction: "Changed their name",
  dismissDealAction: "Dismissed a 'Closed Won, not booked' deal", dealPrefillAction: "Looked up a HubSpot deal to book", payslipDraftsRefreshed: "Opened Payslips: drafts updated from bookings", screenError: "Saw an error screen", refreshSalesAction: "Refreshed Sales from HubSpot",
  addVaccineFileAction: "Uploaded a vaccine record", linkDealAction: "Linked a booking to a HubSpot deal", saveGustoPayeesAction: "Updated the Gusto people list", setGustoCodeAction: "Linked a trainer to Gusto", markGustoPaidAction: "Marked a pay run paid in Gusto", saveGustoCodesAction: "Saved Gusto payroll numbers", inviteSalesAction: "Sent a sales login", importSalesAction: "Imported sales from the Monies sheet", reportIncidentAction: "Reported an incident"
};

const short = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").slice(0, 120);
function describe(args: Record<string, unknown>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (v instanceof FormData) {
      for (const [fk, fv] of v.entries()) if (!/pass|token|secret/i.test(fk) && typeof fv === "string" && fv.trim()) out.push(`${fk}: ${short(fv)}`);
    } else if (/pass|token|secret/i.test(k)) continue;
    else if (Array.isArray(v)) out.push(`${k}: ${v.length > 6 ? `${v.length} items` : v.map(short).join(", ")}`);
    else if (v && typeof v === "object") continue;                                   // big objects are summarised separately
    else if (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)) continue;            // ids are turned into names above
    else if (v !== undefined && v !== null && v !== "") out.push(`${k}: ${short(v)}`);
  }
  return out.join(" · ").slice(0, 900);
}

/** Names instead of ids, where it's cheap: the dog for a booking, the chat's dog, the trainer. */
async function context(args: Record<string, unknown>): Promise<{ about: string; link: string | null }> {
  const sb = serviceClient(), s = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  try {
    const bookingId = s("bookingId") || (/^[0-9a-f-]{36}$/.test(s("id")) ? s("id") : "");
    if (s("chatId")) { const { data } = await sb.from("chats").select("title, client_name").eq("id", s("chatId")).maybeSingle(); if (data) return { about: `${data.title || "Dog"} (${data.client_name || "client"})`, link: `/a/chats/${s("chatId")}` }; }
    if (bookingId) { const { data } = await sb.from("bookings").select("dog_name, client_name").eq("id", bookingId).maybeSingle(); if (data) return { about: `${data.dog_name || "Dog"} (${data.client_name})`, link: `/a/dogs/${bookingId}` }; }
    if (s("trainerId")) { const { data } = await sb.from("trainers").select("name").eq("id", s("trainerId")).maybeSingle(); if (data) return { about: data.name, link: `/a/trainers/${s("trainerId")}` }; }
  } catch { /* ignore */ }
  return { about: "", link: null };
}

type Who = { name: string; role: string; userId?: string | null };
type Prepared = { user_id: string | null; who: string; role: string | null; action: string; detail: string | null; link: string | null };

/** Works out who, what and "before" (runs before the action, so summaries compare with how things were). */
async function prepare(action: string, args: Record<string, unknown>, who?: Who): Promise<Prepared> {
  const v = who ? null : await getViewer();
  const person = who || (v ? { name: v.name, role: v.role, userId: v.userId } : null);
  const c = await context(args);
  const email = v?.email || "";
  const whoText = person?.name ? (email && !person.name.includes("@") && person.name.toLowerCase() !== email ? `${person.name} (${email})` : person.name) : "";
  const special = await summarize(action, args).catch(() => null);
  return {
    user_id: person?.userId || null, who: whoText || "Someone (not signed in)", role: person?.role || null,
    action: LABEL[action] || action, detail: (special || [c.about, describe(args)].filter(Boolean).join(" · ")).slice(0, 1000) || null, link: special ? null : c.link
  };
}

/** Saves one log line. Works before and after migration 032 (the ok/error columns). */
async function write(row: Prepared, ok: boolean | null, error: string | null = null) {
  const sb = serviceClient();
  const { error: e } = await sb.from("audit_log").insert({ ...row, ok, error: error ? error.slice(0, 500) : null });
  if (e && /column|schema cache/i.test(e.message)) await sb.from("audit_log").insert({ ...row, detail: [row.detail, ok === false ? `FAILED: ${error || ""}` : ""].filter(Boolean).join(" · ") || null });
}

/** A note in the log (sign-ins, notifications). Never throws. */
export async function auditCall(action: string, args: Record<string, unknown> = {}, who?: Who, outcome?: { ok: boolean; error?: string | null }) {
  if (isDemo()) return;
  try { await write(await prepare(action, args, who), outcome ? outcome.ok : null, outcome?.error || null); }
  catch { /* the log must never stop the action */ }
}

const isNav = (e: unknown, kind: string) => typeof (e as { digest?: unknown })?.digest === "string" && ((e as { digest: string }).digest).startsWith(kind);
/** What an action's result says: { ok: false, message } = failed or refused. Anything else = done. */
function outcomeOf(r: unknown): { ok: boolean; error: string | null } {
  if (r && typeof r === "object" && "ok" in r && typeof (r as { ok: unknown }).ok === "boolean") {
    const x = r as { ok: boolean; message?: unknown };
    return { ok: x.ok, error: x.ok ? null : String(x.message || "Refused") };
  }
  return { ok: true, error: null };
}

/** Runs a server action and logs it AFTER it finishes: who, what, and whether it worked (with the reason if it didn't). */
export async function audited<T>(action: string, args: Record<string, unknown>, run: () => Promise<T>, who?: Who): Promise<T> {
  if (isDemo()) return run();
  let row: Prepared | null = null;
  try { row = await prepare(action, args, who); } catch { /* still run the action */ }
  try {
    const r = await run();
    if (row) { const o = outcomeOf(r); await write(row, o.ok, o.error).catch(() => {}); }
    return r;
  } catch (e) {
    if (row) {
      if (isNav(e, "NEXT_REDIRECT")) await write(row, true).catch(() => {});                 // redirect() = it worked and moved on
      else await write(row, false, isNav(e, "NEXT_NOT_FOUND") ? "Not found" : (e as Error)?.message || "Error").catch(() => {});
    }
    throw e;
  }
}

/** Something the app did by itself (HubSpot sync, crons, auto-invites). Never throws. */
export async function auditSystem(action: string, detail: string, opts: { link?: string | null; ok?: boolean; error?: string | null } = {}) {
  if (isDemo()) return;
  try {
    await write({ user_id: null, who: "System", role: "system", action, detail: detail.slice(0, 1000) || null, link: opts.link || null }, opts.ok ?? true, opts.error || null);
  } catch { /* never stop the job */ }
}

// ── Plain-words summaries for the actions people most need to check ──
const usd = (n: unknown) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
type PLine = { kind: string; booking_id?: string | null; program?: string | null; description?: string | null; client?: string | null; dog?: string | null; amount: number | string; days?: number | null };
const lineName = (l: PLine) => [l.dog || l.client || "", l.kind === "training" ? l.program || "" : l.description || l.program || l.kind].filter(Boolean).join(" ").trim() || l.kind;
const lineId = (l: PLine) => `${l.kind}|${l.booking_id || ""}|${l.kind === "training" ? "" : (l.description || l.program || "")}`;

async function payslipTitle(id: string) {
  const { data } = await serviceClient().from("payslips").select("trainer_name, total, adjustments, notes, trainers(name), pay_runs(period_start, period_end), payslip_lines(kind, booking_id, program, description, client, dog, amount, days)").eq("id", id).maybeSingle();
  if (!data) return null;
  const run = data.pay_runs as unknown as { period_start: string; period_end: string } | null;
  const d = (x: string) => new Date(`${x}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return { title: `Payslip for ${(data.trainers as unknown as { name?: string } | null)?.name || data.trainer_name || "?"}${run ? `, ${d(run.period_start)} to ${d(run.period_end)}` : ""}`, data };
}

/** What actually changed, in words. Runs before the action, so it compares with how things were. */
async function summarize(action: string, a: Record<string, unknown>): Promise<string | null> {
  const sb = serviceClient();
  if (/payslip|approve|resend|reopen|correct/i.test(action) && typeof a.id === "string") {
    const p = await payslipTitle(a.id);
    if (!p) return null;
    const edit = a.edit as { lines: PLine[]; adjustments: number; notes: string } | undefined;
    if (!edit) return p.title;
    const before = (p.data.payslip_lines || []) as PLine[], after = edit.lines || [];
    const changes: string[] = [];
    for (const b of before) {
      const n = after.find((x) => lineId(x) === lineId(b));
      if (!n) changes.push(`removed ${lineName(b)} (${usd(b.amount)})`);
      else if (Number(n.amount) !== Number(b.amount) || (n.days ?? null) !== (b.days ?? null)) changes.push(`${lineName(b)}: ${usd(b.amount)} → ${usd(n.amount)}${n.days !== b.days && n.days != null ? ` (${n.days} days)` : ""}`);
    }
    for (const n of after) if (!before.some((b) => lineId(b) === lineId(n))) changes.push(`added ${lineName(n)} (${usd(n.amount)})`);
    if (Number(edit.adjustments || 0) !== Number(p.data.adjustments || 0)) changes.push(`adjustments ${usd(p.data.adjustments)} → ${usd(edit.adjustments)}`);
    if ((edit.notes || "").trim() !== (p.data.notes || "").trim()) changes.push(`notes: "${(edit.notes || "").trim().slice(0, 120)}"`);
    const newTotal = after.reduce((n, l) => n + Number(l.amount || 0), 0) + Number(edit.adjustments || 0);
    return `${p.title}: ${changes.length ? changes.join("; ") : "no changes (just saved)"}${changes.length ? `. Total ${usd(p.data.total)} → ${usd(newTotal)}` : ""}`;
  }
  if (action === "resolveIncidentAction" && typeof a.id === "string") {
    const { data } = await sb.from("chat_incidents").select("kind, detail, chats(title), bookings!booking_id(dog_name)").eq("id", a.id).maybeSingle();
    if (!data) return null;
    const dog = (data.chats as unknown as { title?: string } | null)?.title || (data.bookings as unknown as { dog_name?: string } | null)?.dog_name || "";
    return `${dog ? `${dog}: ` : ""}${String(data.kind).replace(/_/g, " ")}${data.detail ? `: ${String(data.detail).slice(0, 160)}` : ""}`;
  }
  if ((action === "setBookingStatus" || action === "setExtraDays" || action === "emailTrainerAboutBooking") && typeof a.id === "string") {
    const { data } = await sb.from("bookings").select("dog_name, client_name, status, extra_days, trainers(name)").eq("id", a.id).maybeSingle();
    if (!data) return null;
    const who = `${data.dog_name || "Dog"} (${data.client_name}, ${(data.trainers as unknown as { name?: string } | null)?.name || "no trainer"})`;
    if (action === "setBookingStatus") return `${who}: status ${data.status} → ${String(a.status)}`;
    if (action === "setExtraDays") return `${who}: extra days ${data.extra_days ?? 0} → ${String(a.days ?? a.n ?? Object.values(a)[1] ?? "?")}`;
    return who;
  }
  if (action === "saveProfileAction" && a.values && typeof a.values === "object") {
    const { QUESTIONS } = await import("./pretrainingFields");
    const keys = Object.keys(a.values as object);
    const names = keys.map((k) => QUESTIONS.find((q) => q.key === k)?.label || k).slice(0, 8);
    return `changed ${keys.length} answer${keys.length === 1 ? "" : "s"}: ${names.join("; ")}${keys.length > 8 ? "…" : ""}`;
  }
  return null;
}
