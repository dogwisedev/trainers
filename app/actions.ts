"use server";
import { auditCall } from "@/lib/audit";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/data";
import { isDemo, serverClient, serviceClient } from "@/lib/supabase";
import { addDays, dropOff, short, todayIso } from "@/lib/dates";
import { notifyBookings, notifySummary } from "@/lib/bookingEmail";
import { sendInvite, sendSignInLink } from "@/lib/authEmail";
import { sendSigninHello } from "@/lib/trainerSignin";
import { cleanDealId } from "@/lib/dealId";
import { validMiles } from "@/lib/trips";
import { pushToAdmins, pushToTrainer } from "@/lib/push";
import { currentRunDate, probationHeld } from "@/lib/payrollData";
import { FOLLOWUP_PROPS, syncMoney } from "@/lib/money";
import { updateDeal } from "@/lib/hubspot";
import { ensureChatsForBookings } from "@/lib/chat";
import { datesFromHubspot } from "@/lib/hubspot";
import { syncHubspotDates } from "@/lib/hubspotSync";
import { raiseIncident } from "@/lib/incidents";

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
export async function signIn(_: Result | null, f: FormData): Promise<Result> {
  if (isDemo()) {
    cookies().set("demo_as", String(f.get("as") || "admin"), { path: "/", httpOnly: true, sameSite: "lax" });
    redirect("/");
  }
  const sb = serverClient();
  const email = String(f.get("email") || "").trim(), password = String(f.get("password") || "");
  if (!email) return { ok: false, message: "Enter your email." };
  const as = { name: email, role: "sign-in" };
  if (!password) {
    await auditCall("signInLinkSent", { email }, as);
    try { await sendSignInLink(email); }
    catch (e) { return { ok: false, message: `Couldn't send the link: ${(e as Error).message}` }; }
    return { ok: true, message: "If that email has an account, a sign-in link is on its way from info@dogwiseacademy.com. It works in any browser." };
  }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { await auditCall("signInFailed", { email }, as); return { ok: false, message: "That email and password don't match. Leave the password empty to get a sign-in link instead." }; }
  await auditCall("signInPassword", { email }, as);
  redirect("/");
}

export async function signOut() {
  if (isDemo()) cookies().delete("demo_as"); else await serverClient().auth.signOut();
  redirect("/login");
}

export async function setPassword(_: Result | null, f: FormData): Promise<Result> {
  await auditCall("setPassword", { f });
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
}

// ── Trainers ──────────────────────────────────────────────────────────────
const ADMIN_FIELDS = ["name", "email", "dogwise_email", "city", "state", "zip", "range_text", "programs", "offering", "notes", "poc"];
const SHARED_FIELDS = ["phone", "work_email", "address", "shirt_size", "second_location", "local_vet", "emergency_vet", "emergency_contact", "bio", "birthday"];

export async function saveTrainer(_: Result | null, f: FormData): Promise<Result> {
  await auditCall("saveTrainer", { f });
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
  const { error } = await sb.from("trainers").update(row).eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile saved." };
}

export async function setTrainerActive(id: string, active: boolean): Promise<Result> {
  await auditCall("setTrainerActive", { id, active });
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const { error } = await serverClient().from("trainers").update({ active }).eq("id", id);
  revalidatePath("/", "layout");
  return error ? { ok: false, message: error.message } : { ok: true, message: active ? "Trainer is active again." : "Trainer moved to inactive. Their history is kept." };
}

export async function clearFlag(id: string, flag: string): Promise<Result> {
  await auditCall("clearFlag", { id, flag });
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const sb = serverClient();
  const { data } = await sb.from("trainers").select("data_flags").eq("id", id).single();
  const { error } = await sb.from("trainers").update({ data_flags: (data?.data_flags || []).filter((x: string) => x !== flag) }).eq("id", id);
  revalidatePath(`/a/trainers/${id}`);
  return error ? { ok: false, message: error.message } : { ok: true, message: "Marked as checked." };
}

/** Sends the trainer an email invite and links their login to their profile. */
export async function inviteTrainer(id: string): Promise<Result> {
  await auditCall("inviteTrainer", { id });
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
}

// ── Time off ──────────────────────────────────────────────────────────────
export async function addTimeOff(_: Result | null, f: FormData): Promise<Result> {
  await auditCall("addTimeOff", { f });
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
}

export async function deleteTimeOff(id: string): Promise<Result> {
  await auditCall("deleteTimeOff", { id });
  if (isDemo()) return DEMO;
  await viewerOrThrow();
  const { error } = await serverClient().from("time_off").delete().eq("id", id);
  revalidatePath("/", "layout");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Time off removed." };
}

// ── Bookings (admin) ──────────────────────────────────────────────────────
export async function saveBooking(_: Result | null, f: FormData): Promise<Result> {
  await auditCall("saveBooking", { f });
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const start = str(f, "start_date"), weeks = num(f, "weeks") || 3, extra = Math.min(13, Math.max(0, num(f, "extra_days") || 0));
  if (!start || !str(f, "trainer_id") || !str(f, "client_name")) return { ok: false, message: "Trainer, client and start date are required." };
  const s = start; // exactly as entered: no rounding to Sunday
  const row = {
    trainer_id: str(f, "trainer_id"), client_name: str(f, "client_name"), dog_name: str(f, "dog_name"), ...(str(f, "client_email") ? { client_email: str(f, "client_email") } : {}),
    program: str(f, "program") || `${weeks}-week`, start_date: s, end_date: dropOff(s, weeks, extra), weeks, extra_days: extra,
    status: str(f, "status") || "confirmed", notes: str(f, "notes"), hubspot_deal_id: cleanDealId(str(f, "hubspot_deal_id")), created_by: v.userId,
    rehab: f.get("rehab") === "on" || /rehab|\bRR\b/i.test(str(f, "program") || "")
  };
  const id = str(f, "id");
  const sb = serverClient();
  const { data: saved, error } = id
    ? await sb.from("bookings").update(row).eq("id", id).select("id").single()
    : await sb.from("bookings").insert(row).select("id").single();
  if (error) return { ok: false, message: error.message };
  if (!id && row.hubspot_deal_id && datesFromHubspot()) await syncHubspotDates({ mode: "quiet", dealIds: [row.hubspot_deal_id as string] }).catch(() => null); // the deal's real dates, before emailing
  const n = await notifyBookings(sb, [saved.id], id ? "changed" : "new");
  if (!id) await ensureChatsForBookings([{ id: saved.id, trainer_id: row.trainer_id as string, client_name: row.client_name as string, dog_name: row.dog_name, hubspot_deal_id: row.hubspot_deal_id, client_email: (row as { client_email?: string }).client_email }], { invite: process.env.CHAT_INVITE_CLIENTS === "1" }).catch(() => []);
  revalidatePath("/", "layout");
  redirect(`/a/trainers/${row.trainer_id}?saved=booking${n.sent ? "&emailed=1" : n.skipped ? "&emailed=off" : n.errors.length ? "&emailed=failed" : ""}`);
}

export async function setExtraDays(id: string, extra: number): Promise<Result> {
  await auditCall("setExtraDays", { id, extra });
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
}

export async function setBookingStatus(id: string, status: string): Promise<Result> {
  await auditCall("setBookingStatus", { id, status });
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
}

// ── Messages ──────────────────────────────────────────────────────────────
export async function sendMessage(trainerId: string, body: string): Promise<Result> {
  await auditCall("sendMessage", { trainerId, body });
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
  await auditCall("emailTrainerAboutBooking", { id });
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const n = await notifyBookings(serviceClient(), [id], "new");
  revalidatePath("/", "layout");
  if (n.skipped) return { ok: false, message: n.skipped };
  if (n.errors.length) return { ok: false, message: n.errors[0] };
  return n.sent ? { ok: true, message: "Emailed." } : { ok: false, message: "Nothing sent: booking not found." };
}

/** Admin: the friendly "your app is ready, here's how to get in" email, to one trainer or to everyone who hasn't signed in. */
export async function sendSigninHellos(ids: string[]): Promise<Result> {
  await auditCall("sendSigninHellos", { ids });
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const results = [];
  for (const id of ids.slice(0, 60)) results.push(await sendSigninHello(id));
  revalidatePath("/a/trainers");
  const bad = results.filter((r) => !r.ok);
  const sent = results.length - bad.length;
  return bad.length ? { ok: sent > 0, message: `Sent ${sent}. Not sent: ${bad.map((r) => r.message).join("; ")}` } : { ok: true, message: `Sent to ${sent} trainer${sent === 1 ? "" : "s"}.` };
}

/** Trainer: a follow-up session (date, miles driven, what was done). Becomes a trip for mileage pay, and shows on the dog's page for admins. */
export async function logFollowupAction(_: Result | null, f: FormData): Promise<Result> {
  await auditCall("logFollowupAction", { f });
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
}

/** Admin: approve or decline a trainer's probation. Approve: everything held so far (25% of program pay) is paid in the NEXT pay run. */
export async function decideProbationAction(trainerId: string, approve: boolean): Promise<Result> {
  await auditCall("decideProbationAction", { trainerId, approve });
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
}

/** Admin, or the dog's trainer: follow-up session dates, saved on the HubSpot deal (follow_up_session__1..3). Each date is paid in that pay period. */
export async function setFollowupsAction(bookingId: string, dates: string[]): Promise<Result> {
  await auditCall("setFollowupsAction", { bookingId, dates });
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
}
