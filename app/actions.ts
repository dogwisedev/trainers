"use server";
import { auditCall, audited } from "@/lib/audit";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/data";
import { isDemo, serverClient, serviceClient } from "@/lib/supabase";
import { addDays, daysBetween, dropOff, short, todayIso, weekStart, weeksFrom } from "@/lib/dates";
import { notifyBookings, notifySummary } from "@/lib/bookingEmail";
import { sendInvite, sendSignInLink } from "@/lib/authEmail";
import { sendSigninHello } from "@/lib/trainerSignin";
import { cleanDealId } from "@/lib/dealId";
import { validMiles } from "@/lib/trips";
import { pushToAdmins, pushToTrainer } from "@/lib/push";
import { currentRunDate, probationHeld } from "@/lib/payrollData";
import { FOLLOWUP_PROPS, syncMoney } from "@/lib/money";
import { dealContacts, dealDateProps, hsDate, hubspotConfigured, readContacts, readDeals, stageLabel, updateDeal } from "@/lib/hubspot";
import { ensureChatsForBookings } from "@/lib/chat";
import { datesFromHubspot } from "@/lib/hubspot";
import { syncHubspotDates } from "@/lib/hubspotSync";
import { raiseIncident } from "@/lib/incidents";
import { weekUsage } from "@/lib/capacity";
import type { Booking, TimeOff, Trainer } from "@/lib/types";
import { inviteWithBooking } from "@/lib/autoInvite";
import { clearUnbooked } from "@/lib/unbookedDeals";
import { ensureReport } from "@/lib/reportData";

export type Result = { ok: boolean; message: string };
const DEMO: Result = { ok: false, message: "Demo mode: connect Supabase to save changes." };
const str = (f: FormData, k: string) => { const v = f.get(k); return v === null ? null : String(v).trim() || null; };
const num = (f: FormData, k: string) => { const v = str(f, k); return v === null ? null : Number(v); };

async function viewerOrThrow() {
  const v = await getViewer();
  if (!v) throw new Error("Sign in again.");
  return v;
}

// ── Auth ──────────────────────────────────────────────────────────────────
export type SignInResult = Result & { codeFor?: string };
export async function signIn(_: SignInResult | null, f: FormData): Promise<SignInResult> {
  if (isDemo()) {
    cookies().set("demo_as", String(f.get("as") || "admin"), { path: "/", httpOnly: true, sameSite: "lax" });
    redirect("/");
  }
  const sb = serverClient();
  const email = String(f.get("email") || "").trim(), password = String(f.get("password") || "");
  if (!email) return { ok: false, message: "Enter your email." };
  const as = { name: email, role: "sign-in" };
  if (!password) {
    try { await sendSignInLink(email); }
    catch (e) { await auditCall("signInCodeSent", { email }, as, { ok: false, error: (e as Error).message }); return { ok: false, message: `Couldn't send the code: ${(e as Error).message}` }; }
    await auditCall("signInCodeSent", { email }, as);
    return { ok: true, codeFor: email, message: "If that email has an account, a 6-digit code is on its way from info@dogwiseacademy.com." };
  }
  const { error: err0 } = await sb.auth.signInWithPassword({ email, password });
  let error = err0;
  if (error && password !== password.toLowerCase()) ({ error } = await sb.auth.signInWithPassword({ email, password: password.toLowerCase() })); // capitals don't matter for client passwords
  if (error) { await auditCall("signInFailed", { email }, as, { ok: false, error: error.message }); return { ok: false, message: "That email and password don't match. Leave the password empty to get a sign-in code instead." }; }
  await auditCall("signInPassword", { email }, as, { ok: true });
  redirect("/");
}

/** Second step of "email me a code": the 6-digit code typed into the app (works inside the installed iPhone app too). */
export async function signInWithCode(_: SignInResult | null, f: FormData): Promise<SignInResult> {
  if (isDemo()) return DEMO;
  const email = String(f.get("email") || "").trim(), code = String(f.get("code") || "").replace(/\D/g, "");
  const as = { name: email, role: "sign-in" };
  if (!email) return { ok: false, message: "Enter your email first." };
  if (code.length < 6) return { ok: false, codeFor: email, message: "Enter the 6-digit code from the email." };
  const sb = serverClient();
  let { error } = await sb.auth.verifyOtp({ email, token: code, type: "email" });
  if (error) ({ error } = await sb.auth.verifyOtp({ email, token: code, type: "magiclink" })); // older Supabase versions name it "magiclink"
  if (error) {
    await auditCall("signInCodeFailed", { email }, as, { ok: false, error: error.message });
    return { ok: false, codeFor: email, message: /expired/i.test(error.message) ? "That code has expired. Tap \"Send a new code\"." : "That code didn't work. Check it's from the newest email, or send a new code." };
  }
  const { data: { user } } = await sb.auth.getUser();
  await auditCall("signInCode", { email }, { name: email, role: "sign-in", userId: user?.id || null }, { ok: true });
  redirect("/");
}

export async function signOut() {
  if (isDemo()) cookies().delete("demo_as"); else await serverClient().auth.signOut();
  redirect("/login");
}

export async function setPassword(_: Result | null, f: FormData): Promise<Result> {
  return audited("setPassword", { f }, async () => {
  if (isDemo()) return DEMO;
  const p = String(f.get("password") || "");
  if (p.length < 8) return { ok: false, message: "Use at least 8 characters." };
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.auth.updateUser({ password: p });
  if (error) return { ok: false, message: error.message };
  if (user) await serviceClient().from("profiles").update({ password_set: true }).eq("id", user.id);
  revalidatePath("/", "layout");
  return { ok: true, message: "Password saved. Next time, sign in with your email and this password." };
});
}

/** Admins and sales: the name shown next to their email in the activity log (clients still see "Dogwise team"). */
export async function setDisplayNameAction(_: Result | null, f: FormData): Promise<Result> {
  return audited("setDisplayNameAction", { name: String(f.get("name") || "") }, async () => {
    if (isDemo()) return DEMO;
    const v = await viewerOrThrow();
    if (v.role !== "admin" && v.role !== "sales") return { ok: false, message: "Only the Dogwise team can change this here." };
    const name = String(f.get("name") || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (name.length < 2) return { ok: false, message: "Enter your name." };
    if (/^dogwise team$/i.test(name)) return { ok: false, message: "Use your own name, so the activity log shows who did what." };
    const { error } = await serviceClient().from("profiles").update({ display_name: name }).eq("id", v.userId);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved." };
  });
}

// ── Trainers ──────────────────────────────────────────────────────────────
const ADMIN_FIELDS = ["name", "email", "dogwise_email", "city", "state", "zip", "range_text", "programs", "offering", "notes", "poc", "gusto_code"];
const SHARED_FIELDS = ["phone", "work_email", "address", "shirt_size", "second_location", "local_vet", "emergency_vet", "emergency_contact", "bio", "birthday"];

export async function saveTrainer(_: Result | null, f: FormData): Promise<Result> {
  return audited("saveTrainer", { f }, async () => {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  const id = str(f, "id");
  const isAdmin = v.role === "admin";
  if (!isAdmin && id !== v.trainerId) return { ok: false, message: "You can only edit your own profile." };
  const row: Record<string, unknown> = {};
  for (const k of SHARED_FIELDS) if (f.has(k)) row[k] = str(f, k);
  if (isAdmin) {
    for (const k of ADMIN_FIELDS) if (f.has(k)) row[k] = str(f, k);
    for (const k of ["capacity", "monthly_capacity", "range_miles", "lat", "lon"]) if (f.has(k)) row[k] = num(f, k);
    if (!row.name) return { ok: false, message: "Name is required." };
  }
  const sb = serverClient();
  if (!id) {
    const { data, error } = await sb.from("trainers").insert({ ...row, probation: "on" }).select("id").single(); // new trainers start on probation
    if (error) return { ok: false, message: error.message };
    redirect(`/a/trainers/${data.id}`);
  }
  const { data: before } = await sb.from("trainers").select("email").eq("id", id).maybeSingle();
  const { error } = await sb.from("trainers").update(row).eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  // Email changed by an admin: move the trainer's login to the new email too (same password, nothing for them to do)
  const newEmail = String(row.email || "").trim().toLowerCase();
  if (isAdmin && "email" in row && newEmail && newEmail !== String(before?.email || "").trim().toLowerCase()) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) return { ok: false, message: "Profile saved, but that email doesn't look right, so the login wasn't changed." };
    const admin = serviceClient();
    const { data: logins } = await admin.from("profiles").select("id").eq("trainer_id", id);
    if (!logins?.length) return { ok: true, message: "Profile saved. They don't have a login yet: send their login to the new email." };
    for (const l of logins) {
      const { error: e } = await admin.auth.admin.updateUserById(l.id, { email: newEmail, email_confirm: true });
      if (e) return { ok: false, message: `Profile saved, but the login couldn't move to ${newEmail}: ${/already|registered|exists/i.test(e.message) ? "another account already uses that email" : e.message}.` };
    }
    return { ok: true, message: `Profile saved. They now sign in with ${newEmail} (same password).` };
  }
  return { ok: true, message: "Profile saved." };
});
}

export async function setTrainerActive(id: string, active: boolean): Promise<Result> {
  return audited("setTrainerActive", { id, active }, async () => {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const { error } = await serverClient().from("trainers").update({ active }).eq("id", id);
  revalidatePath("/", "layout");
  return error ? { ok: false, message: error.message } : { ok: true, message: active ? "Trainer is active again." : "Trainer moved to inactive. Their history is kept." };
});
}

export async function clearFlag(id: string, flag: string): Promise<Result> {
  return audited("clearFlag", { id, flag }, async () => {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const sb = serverClient();
  const { data } = await sb.from("trainers").select("data_flags").eq("id", id).single();
  const { error } = await sb.from("trainers").update({ data_flags: (data?.data_flags || []).filter((x: string) => x !== flag) }).eq("id", id);
  revalidatePath(`/a/trainers/${id}`);
  return error ? { ok: false, message: error.message } : { ok: true, message: "Marked as checked." };
});
}

/** Sends the trainer an email invite and links their login to their profile. */
export async function inviteTrainer(id: string): Promise<Result> {
  return audited("inviteTrainer", { id }, async () => {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const admin = serviceClient();
  const { data: t } = await admin.from("trainers").select("email, dogwise_email, name").eq("id", id).single();
  const email = t?.email || t?.dogwise_email;
  if (!email) return { ok: false, message: "Add an email to the profile first." };
  let userId: string;
  try { ({ userId } = await sendInvite(email, t?.name || "")); }
  catch (e) { return { ok: false, message: `Login not sent: ${(e as Error).message}` }; }
  // Link the login to this trainer (never downgrades an admin who shares the email)
  const { data: existing } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (existing?.role !== "admin") await admin.from("profiles").upsert({ id: userId, role: "trainer", trainer_id: id, display_name: t?.name });
  return { ok: true, message: `Login sent to ${email}.` };
});
}

// ── Time off ──────────────────────────────────────────────────────────────
export async function addTimeOff(_: Result | null, f: FormData): Promise<Result> {
  return audited("addTimeOff", { f }, async () => {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  const trainer_id = v.role === "admin" ? str(f, "trainer_id") : v.trainerId;
  const start_date = str(f, "start_date"), end_date = str(f, "end_date");
  if (!trainer_id || !start_date || !end_date) return { ok: false, message: "Pick a start and end date." };
  if (end_date < start_date) return { ok: false, message: "The end date is before the start date." };
  const scope = str(f, "scope");
  const slots = scope === "some" ? num(f, "slots_blocked") : null;
  const { error } = await serverClient().from("time_off").insert({
    trainer_id, start_date, end_date, slots_blocked: slots && slots > 0 ? slots : null,
    reason: str(f, "reason") || "Holiday", note: str(f, "note"), created_by: v.userId
  });
  revalidatePath("/", "layout");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Time off blocked." };
});
}

export async function deleteTimeOff(id: string): Promise<Result> {
  return audited("deleteTimeOff", { id }, async () => {
  if (isDemo()) return DEMO;
  await viewerOrThrow();
  const { error } = await serverClient().from("time_off").delete().eq("id", id);
  revalidatePath("/", "layout");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Time off removed." };
});
}

// ── Bookings (admin) ──────────────────────────────────────────────────────
// ── Booking a dog from the app (same rules as the HubSpot extension) ─────
export type DealPrefill = {
  ok: boolean; message: string;
  deal?: { id: string; name: string; client: string; email: string; dogs: string[]; start: string | null; end: string | null; weeks: number | null; extra: number; stage: string; closedWon: boolean;
    booked: { id: string; dog: string; trainer: string; dates: string }[] };
};
const DEAL_DOGS = ["k9___dog_name", "dog_2_name", "dog_3_name", "dog_4_name"];

/** Admin pastes a HubSpot deal link: fills the booking form from the deal (client, email, dogs, dates) and says if it's already booked. */
export async function dealPrefillAction(input: string): Promise<DealPrefill> {
  if (isDemo()) return { ok: false, message: "Demo mode." };
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const id = cleanDealId(input);
  if (!id || !/^\d+$/.test(id)) return { ok: false, message: "Paste the deal's link from HubSpot (or its number)." };
  const sb = serviceClient();
  const { data: existing } = await sb.from("bookings").select("id, dog_name, start_date, end_date, trainers(name)").eq("hubspot_deal_id", id).neq("status", "cancelled");
  const booked = ((existing || []) as unknown as { id: string; dog_name: string | null; start_date: string; end_date: string; trainers: { name: string } | null }[])
    .map((b) => ({ id: b.id, dog: b.dog_name || "Dog", trainer: b.trainers?.name || "no trainer", dates: `${short(b.start_date)} to ${short(b.end_date)}` }));
  if (!hubspotConfigured()) return { ok: true, message: "HubSpot isn't connected, so fill in the rest by hand.", deal: { id, name: `Deal ${id}`, client: "", email: "", dogs: [], start: null, end: null, weeks: null, extra: 0, stage: "", closedWon: true, booked } };
  try {
    const props = await dealDateProps();
    const deals = await readDeals([id], ["dealname", "hs_is_closed_won", "dealstage", props.start.name, ...(props.end ? [props.end.name] : []), ...DEAL_DOGS]);
    const d = deals.get(id);
    if (!d) return { ok: false, message: `HubSpot has no deal ${id}. Check the link.` };
    const contactIds = (await dealContacts([id])).get(id) || [];
    const contacts = [...(await readContacts(contactIds, ["firstname", "lastname", "email"])).values()];
    const c = contacts.find((x) => x.email) || contacts[0] || {};
    const start = hsDate(d[props.start.name]), end = props.end ? hsDate(d[props.end.name]) : null;
    let weeks: number | null = null, extra = 0;
    if (start && end && end > start) { const days = daysBetween(start, end); weeks = Math.min(12, Math.max(1, Math.floor(days / 7))); extra = Math.min(13, Math.max(0, days - weeks * 7)); }
    return { ok: true, message: "", deal: {
      id, name: d.dealname || `Deal ${id}`, client: [c.firstname, c.lastname].filter(Boolean).join(" ").trim(), email: String(c.email || "").trim().toLowerCase(),
      dogs: DEAL_DOGS.map((k) => String(d[k] || "").trim()).filter(Boolean), start, end, weeks, extra,
      stage: await stageLabel(d.dealstage), closedWon: d.hs_is_closed_won === "true", booked
    } };
  } catch (e) { return { ok: false, message: `Couldn't read the deal from HubSpot: ${(e as Error).message}` }; }
}

/** Book one or more dogs from one HubSpot deal. The deal is required (bookings without one miss date sync, alerts, Sales and balance links).
 *  Same checks as the extension: no dog booked twice on a deal, and a free kennel every week (unless "Book anyway" is ticked). */
export async function saveBooking(_: Result | null, f: FormData): Promise<Result> {
  return audited("saveBooking", { f }, async () => {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const dealId = cleanDealId(str(f, "hubspot_deal_id"));
  if (!dealId || !/^\d+$/.test(dealId)) return { ok: false, message: "Add the HubSpot deal first: every booking needs one." };
  const trainerId = str(f, "trainer_id"), client = str(f, "client_name"), start = str(f, "start_date");
  if (!trainerId || !client || !start) return { ok: false, message: "Trainer, client and pickup date are required." };
  const weeks = Math.min(12, Math.max(1, num(f, "weeks") || 3)), extra = Math.min(13, Math.max(0, num(f, "extra_days") || 0));
  const dogs = [...new Set([...f.getAll("dog").map((x) => String(x).trim()), str(f, "dog_name") || ""].filter(Boolean))].slice(0, 6);
  if (!dogs.length) return { ok: false, message: "Choose or type the dog's name." };
  const sb = serverClient();

  // Already booked? (one live booking per dog per deal)
  const { data: live } = await sb.from("bookings").select("id, dog_name, trainer_id, trainers(name)").eq("hubspot_deal_id", dealId).neq("status", "cancelled");
  const liveRows = (live || []) as unknown as { id: string; dog_name: string | null; trainer_id: string; trainers: { name: string } | null }[];
  const twice = dogs.filter((d) => liveRows.some((b) => sameDog(b.dog_name, d)));
  if (twice.length) return { ok: false, message: `${twice.join(" & ")} ${twice.length > 1 ? "are" : "is"} already booked on this deal (with ${liveRows[0]?.trainers?.name || "a trainer"}). Change that booking instead.` };

  const { data: t } = await sb.from("trainers").select("*").eq("id", trainerId).maybeSingle();
  if (!t || !t.active) return { ok: false, message: "That trainer isn't active in the app." };
  const rows = dogs.map((dog) => ({
    trainer_id: trainerId, client_name: client.slice(0, 120), dog_name: dog.slice(0, 80), ...(str(f, "client_email") ? { client_email: str(f, "client_email")!.toLowerCase() } : {}),
    program: str(f, "program") || `${weeks}-week`, start_date: start, end_date: dropOff(start, weeks, extra), weeks, extra_days: extra,
    status: str(f, "status") || "confirmed", notes: str(f, "notes"), hubspot_deal_id: dealId, created_by: v.userId, source: "app",
    rehab: f.get("rehab") === "on" || /rehab|\bRR\b/i.test(str(f, "program") || "")
  }));

  // A free kennel every week (counting the dogs in this booking too)
  if (f.get("force") !== "on") {
    const to = rows[0].end_date;
    const [bk, off] = await Promise.all([
      sb.from("bookings").select("*").eq("trainer_id", trainerId).neq("status", "cancelled").lte("start_date", to).gte("end_date", start),
      sb.from("time_off").select("*").eq("trainer_id", trainerId).lte("start_date", to).gte("end_date", start)
    ]);
    const taken = [...((bk.data || []) as Booking[])];
    for (const [k, r] of rows.entries()) {
      const use = weekUsage(t as Trainer, taken, (off.data || []) as TimeOff[], weeksFrom(r.start_date, Math.ceil((daysBetween(weekStart(r.start_date), r.end_date) + 1) / 7)));
      const full = use.find((w) => w.free < 1);
      if (full) return { ok: false, message: `${String(t.name).split(" ")[0]} has no free kennel for ${r.dog_name} the week of ${short(full.week)}${full.blocked >= full.cap ? " (time off)" : ""}. Pick another trainer, or tick "Book anyway".` };
      taken.push({ ...(r as unknown as Booking), id: `new-${k}` });
    }
  }

  const { data: saved, error } = await sb.from("bookings").insert(rows).select("id, trainer_id, client_name, client_email, dog_name, hubspot_deal_id, start_date, end_date");
  if (error || !saved?.length) return { ok: false, message: error?.message || "Couldn't save the booking." };
  if (datesFromHubspot()) await syncHubspotDates({ mode: "quiet", dealIds: [dealId] }).catch(() => null); // the deal's real dates, before emailing
  const ids = saved.map((x) => x.id);
  const fresh = ((await sb.from("bookings").select("id, trainer_id, client_name, client_email, dog_name, hubspot_deal_id, start_date, end_date").in("id", ids)).data || saved) as { id: string; trainer_id: string; client_name: string; client_email: string | null; dog_name: string | null; hubspot_deal_id: string | null; start_date: string; end_date: string }[];
  const n = await notifyBookings(sb, ids, "new");
  await ensureChatsForBookings(fresh, { invite: inviteWithBooking(fresh) }).catch(() => []);
  await clearUnbooked(dealId);
  revalidatePath("/", "layout");
  redirect(`/a/trainers/${trainerId}?saved=booking${n.sent ? "&emailed=1" : n.skipped ? "&emailed=off" : n.errors.length ? "&emailed=failed" : ""}`);
  });
}

/** Same dog? Names compared without case or extra spaces ("Storm " = "storm"). */
const sameDog = (a: string | null | undefined, b: string | null | undefined) => {
  const n = (x: string | null | undefined) => String(x || "").replace(/\s+/g, " ").trim().toLowerCase();
  return !!n(a) && n(a) === n(b);
};

// ── Change a dog's trainer ────────────────────────────────────────────────
/** Admin: move a booking to another trainer.
 *  Before pickup (or from the pickup date): the whole booking moves: same deal, chat, dates and forms.
 *  From a later date (rare, mid-training): the booking is split. The first trainer keeps the days before that date, the new
 *  trainer gets a booking from that date to drop-off. Each is paid for their own days at the program's day rate
 *  (e.g. 7 days and 14 days of a 3-week program). The first trainer's handover and the new trainer's pickup form are marked not needed. */
export async function changeTrainerAction(_: Result | null, f: FormData): Promise<Result> {
  const bookingId = String(f.get("booking_id") || ""), toId = String(f.get("trainer_id") || "");
  const { data: names } = isDemo() ? { data: [] } : await serviceClient().from("trainers").select("id, name").in("id", [toId]);
  const toName = ((names || []) as { id: string; name: string }[])[0]?.name || "";
  return audited("changeTrainerAction", { bookingId, to: toName, from: String(f.get("from") || ""), anyway: f.get("force") === "on" ? "yes" : "" }, async () => {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const sb = serverClient();
  const id = str(f, "booking_id"), to = str(f, "trainer_id");
  const { data: b0 } = await sb.from("bookings").select("*, trainers(name)").eq("id", id || "").maybeSingle();
  const b = b0 as (Booking & { trainers: { name: string } | null }) | null;
  if (!b || b.status === "cancelled") return { ok: false, message: "Booking not found, or it's cancelled." };
  if (!to || to === b.trainer_id) return { ok: false, message: "Pick a different trainer." };
  const { data: t } = await sb.from("trainers").select("*").eq("id", to).maybeSingle();
  if (!t || !t.active) return { ok: false, message: "That trainer isn't active in the app." };
  const from = (str(f, "from") || b.start_date) > b.start_date ? str(f, "from")! : b.start_date;
  if (from >= b.end_date) return { ok: false, message: `That's on or after drop-off (${short(b.end_date)}).` };
  const split = from > b.start_date;
  const oldName = b.trainers?.name || "the first trainer", newName = String(t.name);

  // A free kennel with the new trainer for every week they'll have the dog
  if (f.get("force") !== "on") {
    const [bk, off] = await Promise.all([
      sb.from("bookings").select("*").eq("trainer_id", to).neq("status", "cancelled").lte("start_date", b.end_date).gte("end_date", from),
      sb.from("time_off").select("*").eq("trainer_id", to).lte("start_date", b.end_date).gte("end_date", from)
    ]);
    const use = weekUsage(t as Trainer, (bk.data || []) as Booking[], (off.data || []) as TimeOff[], weeksFrom(from, Math.ceil((daysBetween(weekStart(from), b.end_date) + 1) / 7)));
    const full = use.find((w) => w.free < 1);
    if (full) return { ok: false, message: `${newName.split(" ")[0]} has no free kennel the week of ${short(full.week)}${full.blocked >= full.cap ? " (time off)" : ""}. Pick someone else, or tick "Book anyway".` };
  }

  const chatKey = b.hubspot_deal_id || b.id;
  const today = todayIso();
  if (!split) {
    await notifyBookings(sb, [b.id], "cancelled"); // tells the first trainer it's off their calendar (sent before the switch)
    const { error } = await sb.from("bookings").update({ trainer_id: to }).eq("id", b.id);
    if (error) return { ok: false, message: error.message };
    await sb.from("reports").update({ trainer_id: to }).eq("booking_id", b.id).in("status", ["draft", "changes_requested"]);
    await sb.from("chats").update({ trainer_id: to, trainer_name: newName }).eq("deal_key", chatKey).eq("status", "open");
    const n = await notifyBookings(sb, [b.id], "new");
    revalidatePath("/", "layout");
    return { ok: true, message: `${b.dog_name || "The dog"} moved from ${oldName} to ${newName}: same dates, deal, chat and forms.${n.sent ? ` ${newName.split(" ")[0]} was emailed.` : ""}` };
  }

  // Split: first trainer keeps pickup → `from`; the new trainer has `from` → drop-off. Same program (same day rate).
  // Shorten the first booking before adding the second, so the two never overlap (the database refuses a doubled dog).
  const { error: e2 } = await sb.from("bookings").update({ end_date: from, extra_days: 0 }).eq("id", b.id);
  if (e2) return { ok: false, message: e2.message };
  const { data: added, error: e1 } = await sb.from("bookings").insert({
    trainer_id: to, client_name: b.client_name, client_email: b.client_email, dog_name: b.dog_name, program: b.program, rehab: b.rehab,
    start_date: from, end_date: b.end_date, weeks: b.weeks, extra_days: b.extra_days ?? 0, status: b.status, notes: b.notes,
    hubspot_deal_id: b.hubspot_deal_id, reports_enabled: b.reports_enabled, created_by: v.userId, source: "app"
  }).select("*").single();
  if (e1 || !added) {
    await sb.from("bookings").update({ end_date: b.end_date, extra_days: b.extra_days ?? 0 }).eq("id", b.id); // put it back as it was
    return { ok: false, message: e1?.message || "Couldn't make the new trainer's booking." };
  }
  // Forms: no client handover from the first trainer, no client pickup for the second
  for (const [bk, tName, kind] of [[{ ...b, end_date: from } as Booking, oldName, "handover"], [added as Booking, newName, "intake"]] as [Booking, string, "handover" | "intake"][]) {
    try {
      const rid = await ensureReport(sb, bk, tName, kind, 0, true);
      await sb.from("reports").update({ status: "waived", waived_by: "Trainer changed mid-training", waived_at: new Date().toISOString() }).eq("id", rid).in("status", ["draft", "changes_requested"]);
    } catch { /* the admin can mark it not needed by hand */ }
  }
  if (from <= today) await sb.from("chats").update({ trainer_id: to, trainer_name: newName }).eq("deal_key", chatKey).eq("status", "open");
  await notifyBookings(sb, [b.id], "changed");
  await notifyBookings(sb, [added.id], "new");
  revalidatePath("/", "layout");
  return { ok: true, message: `${oldName} has ${b.dog_name || "the dog"} until ${short(from)} (${daysBetween(b.start_date, from)} days), then ${newName} to ${short(b.end_date)} (${daysBetween(from, b.end_date)} days). Each is paid for their own days.${from > today ? ` The chat moves to ${newName.split(" ")[0]} on ${short(from)}.` : ""}` };
  });
}

export async function setExtraDays(id: string, extra: number): Promise<Result> {
  return audited("setExtraDays", { id, extra }, async () => {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const sb = serverClient();
  const { data: b } = await sb.from("bookings").select("start_date, weeks, hubspot_deal_id").eq("id", id).single();
  if (!b) return { ok: false, message: "Booking not found." };
  if (b.hubspot_deal_id && datesFromHubspot()) return { ok: false, message: "This booking's dates come from HubSpot: change them on the deal." };
  const n = Math.min(13, Math.max(0, Math.round(extra)));
  const { error } = await sb.from("bookings").update({ extra_days: n, end_date: dropOff(b.start_date, b.weeks || 1, n) }).eq("id", id);
  revalidatePath("/", "layout");
  if (error) return { ok: false, message: error.message };
  const sentNote = notifySummary(await notifyBookings(sb, [id], "changed"));
  return { ok: true, message: `Updated.${sentNote}` };
});
}

export async function setBookingStatus(id: string, status: string): Promise<Result> {
  return audited("setBookingStatus", { id, status }, async () => {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const sb = serverClient();
  const { data: before } = await sb.from("bookings").select("status, dog_name, client_name, start_date, end_date, trainer_id, hubspot_deal_id, trainers(name)").eq("id", id).maybeSingle();
  const { error } = await sb.from("bookings").update({ status }).eq("id", id);
  revalidatePath("/", "layout");
  if (error) return { ok: false, message: error.message };
  if (status === "cancelled" && before && before.status !== "cancelled") {
    const b = before as unknown as { dog_name: string | null; client_name: string; start_date: string; end_date: string; trainer_id: string; hubspot_deal_id: string | null; trainers: { name: string } | null };
    const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
    await raiseIncident({
      kind: "booking_cancelled", office: true, ref: `booking:${id}`, bookingId: id,
      title: `${b.dog_name || "Dog"} (${b.client_name}), ${b.trainers?.name || "trainer"}`,
      detail: `${v.name} cancelled ${b.dog_name || "the dog"}'s booking in the app (${short(b.start_date)} to ${short(b.end_date)}).${b.hubspot_deal_id ? " Update the HubSpot deal too." : ""}`,
      link: b.hubspot_deal_id ? `https://app.hubspot.com/contacts/21869370/record/0-3/${b.hubspot_deal_id}` : `${site}/a/trainers/${b.trainer_id}`
    });
  }
  const sentNote = notifySummary(await notifyBookings(sb, [id], status === "cancelled" ? "cancelled" : "changed"));
  return { ok: true, message: `${status === "cancelled" ? "Booking cancelled." : "Booking updated."}${sentNote}` };
});
}

// ── Messages ──────────────────────────────────────────────────────────────
export async function sendMessage(trainerId: string, body: string): Promise<Result> {
  return audited("sendMessage", { trainerId, body }, async () => {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  const text = body.trim();
  if (!text) return { ok: false, message: "Write a message first." };
  if (v.role === "client") return { ok: false, message: "Use your chat instead." };
  if (v.role === "trainer" && v.trainerId !== trainerId) return { ok: false, message: "You can only message the Dogwise team." };
  const { error } = await serverClient().from("messages").insert({
    trainer_id: trainerId, sender_id: v.userId, sender_role: v.role, sender_name: v.role === "admin" ? "Dogwise team" : v.name, body: text.slice(0, 4000)
  });
  if (error) return { ok: false, message: error.message };
  // Phone notification to the other side (one per conversation on the lock screen)
  if (v.role === "admin") await pushToTrainer(trainerId, { title: "Message from the Dogwise team", body: text, url: "/t/messages", tag: "team" });
  else await pushToAdmins({ title: `${v.name} sent you a message`, body: text, url: `/a/messages/${trainerId}`, tag: `team-${trainerId}` });
  return { ok: true, message: "Sent" };
});
}

export async function markRead(trainerId: string): Promise<void> {
  if (isDemo()) return;
  const v = await getViewer();
  if (!v) return;
  const other = v.role === "admin" ? "trainer" : "admin";
  await serverClient().from("messages").update({ read_at: new Date().toISOString() }).eq("trainer_id", trainerId).eq("sender_role", other).is("read_at", null);
}

/** Admin: email the trainer about this booking now (the "New booking" email, with the calendar invite). Shows the exact error if it fails. */
export async function emailTrainerAboutBooking(id: string): Promise<Result> {
  return audited("emailTrainerAboutBooking", { id }, async () => {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const n = await notifyBookings(serviceClient(), [id], "new");
  revalidatePath("/", "layout");
  if (n.skipped) return { ok: false, message: n.skipped };
  if (n.errors.length) return { ok: false, message: n.errors[0] };
  return n.sent ? { ok: true, message: "Emailed." } : { ok: false, message: "Nothing sent: booking not found." };
});
}

/** Admin: the friendly "your app is ready, here's how to get in" email, to one trainer or to everyone who hasn't signed in. */
export async function sendSigninHellos(ids: string[]): Promise<Result> {
  return audited("sendSigninHellos", { ids }, async () => {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const results = [];
  for (const id of ids.slice(0, 60)) results.push(await sendSigninHello(id));
  revalidatePath("/a/trainers");
  const bad = results.filter((r) => !r.ok);
  const sent = results.length - bad.length;
  return bad.length ? { ok: sent > 0, message: `Sent ${sent}. Not sent: ${bad.map((r) => r.message).join("; ")}` } : { ok: true, message: `Sent to ${sent} trainer${sent === 1 ? "" : "s"}.` };
});
}

/** Trainer: a follow-up session (date, miles driven, what was done). Becomes a trip for mileage pay, and shows on the dog's page for admins. */
export async function logFollowupAction(_: Result | null, f: FormData): Promise<Result> {
  return audited("logFollowupAction", { f }, async () => {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "trainer" || !v.trainerId) return { ok: false, message: "Only trainers can log follow-up sessions." };
  const bookingId = String(f.get("booking_id") || ""), date = String(f.get("date") || ""), notes = String(f.get("notes") || "").trim();
  const miles = validMiles(f.get("miles"));
  if (!bookingId) return { ok: false, message: "Pick the dog." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayIso()) return { ok: false, message: "Pick the date of the session (today or earlier)." };
  if (miles === null) return { ok: false, message: "Enter the miles you drove (0 if none)." };
  if (notes.length < 5) return { ok: false, message: "Say briefly what you worked on." };
  const sb = serviceClient();
  const { data: b } = await sb.from("bookings").select("id, trainer_id").eq("id", bookingId).maybeSingle();
  if (!b || b.trainer_id !== v.trainerId) return { ok: false, message: "That dog isn't one of yours." };
  const { error } = await sb.from("trips").insert({ trainer_id: v.trainerId, booking_id: bookingId, kind: "followup", trip_date: date, miles, notes: notes.slice(0, 2000), created_by: v.name });
  revalidatePath("/", "layout");
  return error ? { ok: false, message: error.message } : { ok: true, message: `Saved: ${miles} miles on ${date}. It's added to your next payslip.` };
});
}

/** Admin: approve or decline a trainer's probation. Approve: everything held so far (25% of program pay) is paid in the NEXT pay run. */
export async function decideProbationAction(trainerId: string, approve: boolean): Promise<Result> {
  return audited("decideProbationAction", { trainerId, approve }, async () => {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const sb = serviceClient();
  if (!approve) {
    const { error } = await sb.from("trainers").update({ probation: "declined", probation_decided_by: v.name, probation_decided_at: new Date().toISOString() }).eq("id", trainerId);
    revalidatePath("/", "layout");
    return error ? { ok: false, message: error.message } : { ok: true, message: "Declined. Their 25% stays held, and you can approve later." };
  }
  const held = await probationHeld(trainerId);
  const run = addDays(await currentRunDate(), 14); // the next pay run, not the current one
  const { error } = await sb.from("trainers").update({ probation: "approved", probation_decided_by: v.name, probation_decided_at: new Date().toISOString(), probation_release_run: run, probation_release_amount: held }).eq("id", trainerId);
  revalidatePath("/", "layout");
  return error ? { ok: false, message: error.message } : { ok: true, message: `Approved. $${held.toFixed(2)} held so far is paid in the pay run of ${run}. Pay is 100% from now on.` };
});
}

/** Admin, or the dog's trainer: follow-up session dates, saved on the HubSpot deal (follow_up_session__1..3). Each date is paid in that pay period. */
export async function setFollowupsAction(bookingId: string, dates: string[]): Promise<Result> {
  return audited("setFollowupsAction", { bookingId, dates }, async () => {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  const sb = serviceClient();
  const { data: b } = await sb.from("bookings").select("trainer_id, hubspot_deal_id").eq("id", bookingId).maybeSingle();
  if (!b || !(v.role === "admin" || (v.role === "trainer" && v.trainerId === b.trainer_id))) return { ok: false, message: "You can't change this." };
  if (!b.hubspot_deal_id) return { ok: false, message: "This booking has no HubSpot deal to save the dates on." };
  const clean = dates.slice(0, 3).map((d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ""));
  const props = Object.fromEntries(FOLLOWUP_PROPS.map((k, i) => [k, clean[i] ? String(Date.UTC(+clean[i].slice(0, 4), +clean[i].slice(5, 7) - 1, +clean[i].slice(8, 10))) : ""]));
  try { await updateDeal(b.hubspot_deal_id, props); } catch (e) { return { ok: false, message: (e as Error).message }; }
  await syncMoney({ dealIds: [b.hubspot_deal_id], sb }).catch(() => null);
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved on the deal. Each session is paid in the pay period of its date." };
});
}

/**
 * Admin: link a booking to a HubSpot deal by pasting the deal's URL (or number). Also links the client's other dogs booked by hand
 * with the same trainer around the same dates, and merges their chats into the deal's chat (every message kept).
 */
export async function linkDealAction(bookingId: string, input: string): Promise<Result> {
  return audited("linkDealAction", { bookingId, input }, async () => {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const deal = cleanDealId(input);
  if (!deal || !/^\d+$/.test(deal)) return { ok: false, message: "Paste the deal's HubSpot link (or its number)." };
  const sb = serviceClient();
  const { data: b } = await sb.from("bookings").select("id, client_name, trainer_id, start_date, end_date, hubspot_deal_id, dog_name").eq("id", bookingId).maybeSingle();
  if (!b) return { ok: false, message: "Booking not found." };
  if (b.hubspot_deal_id === deal) return { ok: true, message: "Already linked to that deal." };
  let dealName = "";
  try { const d = (await readDeals([deal], ["dealname", "hs_is_closed_won"])).get(deal); if (!d) return { ok: false, message: `HubSpot has no deal ${deal}. Check the link.` }; dealName = d.dealname || ""; }
  catch { /* HubSpot unreachable: link anyway, the sync checks it later */ }
  // This booking, plus the same client's other hand-made bookings (no deal) with this trainer, starting within a week of it
  const { data: sibs } = await sb.from("bookings").select("id, start_date, end_date, dog_name, hubspot_deal_id").eq("trainer_id", b.trainer_id).ilike("client_name", b.client_name).is("hubspot_deal_id", null).neq("status", "cancelled");
  const near = (x: string) => Math.abs(new Date(x).getTime() - new Date(b.start_date).getTime()) <= 7 * 86400e3;
  // Never two live bookings for the same dog on one deal (that's two kennels and double pay): refuse, or leave that sibling out
  const { data: onDeal } = await sb.from("bookings").select("id, dog_name, start_date, end_date, trainers(name)").eq("hubspot_deal_id", deal).neq("status", "cancelled");
  const already = (onDeal || []) as unknown as { id: string; dog_name: string | null; start_date: string; end_date: string; trainers: { name: string } | null }[];
  const twinOf = (x: { dog_name: string | null; start_date: string; end_date?: string }) => already.find((o) => sameDog(o.dog_name, x.dog_name) && o.start_date < (x.end_date || "9999") && x.start_date < o.end_date);
  const twin = twinOf(b);
  if (twin) return { ok: false, message: `${twin.dog_name || "This dog"} is already booked on that deal (with ${twin.trainers?.name || "a trainer"}, ${short(twin.start_date)} to ${short(twin.end_date)}). This booking is a duplicate: cancel it instead of linking it.` };
  const sibRows = (sibs || []) as { id: string; start_date: string; end_date?: string; dog_name: string | null; hubspot_deal_id: string | null }[];
  const moving = [b, ...sibRows.filter((x) => x.id !== b.id && near(x.start_date) && !twinOf(x))];
  const oldKeys = [...new Set(moving.map((x) => x.hubspot_deal_id || x.id))];
  const { error } = await sb.from("bookings").update({ hubspot_deal_id: deal }).in("id", moving.map((x) => x.id));
  if (error) return { ok: false, message: error.message };
  // Chats: keep the deal's chat if it has one (else the first old one), move everything else into it
  const { data: chats } = await sb.from("chats").select("id, deal_key, created_at").in("deal_key", [deal, ...oldKeys]).eq("status", "open").order("created_at");
  const list = (chats || []) as { id: string; deal_key: string }[];
  const keep = list.find((c) => c.deal_key === deal) || list[0];
  let merged = 0;
  if (keep) {
    for (const c of list.filter((x) => x.id !== keep.id)) {
      await sb.from("chat_messages").update({ chat_id: keep.id }).eq("chat_id", c.id);
      await sb.from("chat_incidents").update({ chat_id: keep.id }).eq("chat_id", c.id);
      await sb.from("chat_reads").delete().eq("chat_id", c.id);
      await sb.from("chats").delete().eq("id", c.id);
      merged++;
    }
    const { data: dogs } = await sb.from("bookings").select("dog_name").eq("hubspot_deal_id", deal).neq("status", "cancelled");
    const title = [...new Set(((dogs || []) as { dog_name: string | null }[]).map((d) => (d.dog_name || "").trim()).filter(Boolean))].join(" & ");
    await sb.from("chats").update({ deal_key: deal, ...(title ? { title } : {}) }).eq("id", keep.id);
  }
  revalidatePath("/", "layout");
  const names = moving.map((x) => x.dog_name || "dog").join(" & ");
  return { ok: true, message: `Linked ${names} to ${dealName || `deal ${deal}`}.${merged ? ` Merged ${merged} chat${merged > 1 ? "s" : ""} into one, every message kept.` : ""} HubSpot keeps the dates, checklist and payments in sync from now on.` };
});
}
