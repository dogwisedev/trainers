"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/data";
import { isDemo, serverClient, serviceClient } from "@/lib/supabase";
import { addDays, weekStart } from "@/lib/dates";

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
  if (!password) {
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback` } });
    return error ? { ok: false, message: error.message } : { ok: true, message: "Check your email for a sign-in link." };
  }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: "That email and password don't match. Leave the password empty to get a sign-in link instead." };
  redirect("/");
}

export async function signOut() {
  if (isDemo()) cookies().delete("demo_as"); else await serverClient().auth.signOut();
  redirect("/login");
}

export async function setPassword(_: Result | null, f: FormData): Promise<Result> {
  if (isDemo()) return DEMO;
  const p = String(f.get("password") || "");
  if (p.length < 8) return { ok: false, message: "Use at least 8 characters." };
  const { error } = await serverClient().auth.updateUser({ password: p });
  return error ? { ok: false, message: error.message } : { ok: true, message: "Password saved." };
}

// ── Trainers ──────────────────────────────────────────────────────────────
const ADMIN_FIELDS = ["name", "email", "dogwise_email", "city", "state", "zip", "range_text", "programs", "offering", "notes", "poc"];
const SHARED_FIELDS = ["phone", "work_email", "address", "shirt_size", "second_location", "local_vet", "emergency_vet", "emergency_contact", "bio", "birthday"];

export async function saveTrainer(_: Result | null, f: FormData): Promise<Result> {
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
    const { data, error } = await sb.from("trainers").insert(row).select("id").single();
    if (error) return { ok: false, message: error.message };
    redirect(`/a/trainers/${data.id}`);
  }
  const { error } = await sb.from("trainers").update(row).eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile saved." };
}

export async function setTrainerActive(id: string, active: boolean): Promise<Result> {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const { error } = await serverClient().from("trainers").update({ active }).eq("id", id);
  revalidatePath("/", "layout");
  return error ? { ok: false, message: error.message } : { ok: true, message: active ? "Trainer is active again." : "Trainer moved to inactive. Their history is kept." };
}

export async function clearFlag(id: string, flag: string): Promise<Result> {
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
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const admin = serviceClient();
  const { data: t } = await admin.from("trainers").select("email, dogwise_email, name").eq("id", id).single();
  const email = t?.email || t?.dogwise_email;
  if (!email) return { ok: false, message: "Add an email to the profile first." };
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/t/profile` });
  let userId = data?.user?.id;
  if (error) {
    // Already invited or signed up: send a sign-in link instead and find their user id.
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    userId = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
    if (!userId) return { ok: false, message: error.message };
    await admin.auth.signInWithOtp({ email, options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback` } });
  }
  await admin.from("profiles").upsert({ id: userId, role: "trainer", trainer_id: id, display_name: t?.name });
  return { ok: true, message: `Login sent to ${email}.` };
}

// ── Time off ──────────────────────────────────────────────────────────────
export async function addTimeOff(_: Result | null, f: FormData): Promise<Result> {
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
  if (isDemo()) return DEMO;
  await viewerOrThrow();
  const { error } = await serverClient().from("time_off").delete().eq("id", id);
  revalidatePath("/", "layout");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Time off removed." };
}

// ── Bookings (admin) ──────────────────────────────────────────────────────
export async function saveBooking(_: Result | null, f: FormData): Promise<Result> {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const start = str(f, "start_date"), weeks = num(f, "weeks") || 3, extra = Math.min(13, Math.max(0, num(f, "extra_days") || 0));
  if (!start || !str(f, "trainer_id") || !str(f, "client_name")) return { ok: false, message: "Trainer, client and start date are required." };
  const s = weekStart(start);
  const row = {
    trainer_id: str(f, "trainer_id"), client_name: str(f, "client_name"), dog_name: str(f, "dog_name"),
    program: str(f, "program") || `${weeks}-week`, start_date: s, end_date: addDays(s, weeks * 7 - 1 + extra), weeks, extra_days: extra,
    status: str(f, "status") || "confirmed", notes: str(f, "notes"), hubspot_deal_id: str(f, "hubspot_deal_id"), created_by: v.userId,
    rehab: f.get("rehab") === "on" || /rehab|\bRR\b/i.test(str(f, "program") || "")
  };
  const id = str(f, "id");
  const sb = serverClient();
  const { error } = id ? await sb.from("bookings").update(row).eq("id", id) : await sb.from("bookings").insert(row);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  redirect(`/a/trainers/${row.trainer_id}?saved=booking`);
}

export async function setExtraDays(id: string, extra: number): Promise<Result> {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const sb = serverClient();
  const { data: b } = await sb.from("bookings").select("start_date, weeks").eq("id", id).single();
  if (!b) return { ok: false, message: "Booking not found." };
  const n = Math.min(13, Math.max(0, Math.round(extra)));
  const { error } = await sb.from("bookings").update({ extra_days: n, end_date: addDays(b.start_date, (b.weeks || 1) * 7 - 1 + n) }).eq("id", id);
  revalidatePath("/", "layout");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Updated." };
}

export async function setBookingStatus(id: string, status: string): Promise<Result> {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  if (v.role !== "admin") return { ok: false, message: "Admins only." };
  const { error } = await serverClient().from("bookings").update({ status }).eq("id", id);
  revalidatePath("/", "layout");
  return error ? { ok: false, message: error.message } : { ok: true, message: status === "cancelled" ? "Booking cancelled." : "Booking updated." };
}

// ── Messages ──────────────────────────────────────────────────────────────
export async function sendMessage(trainerId: string, body: string): Promise<Result> {
  if (isDemo()) return DEMO;
  const v = await viewerOrThrow();
  const text = body.trim();
  if (!text) return { ok: false, message: "Write a message first." };
  if (v.role === "trainer" && v.trainerId !== trainerId) return { ok: false, message: "You can only message the Dogwise team." };
  const { error } = await serverClient().from("messages").insert({
    trainer_id: trainerId, sender_id: v.userId, sender_role: v.role, sender_name: v.role === "admin" ? "Dogwise team" : v.name, body: text.slice(0, 4000)
  });
  return error ? { ok: false, message: error.message } : { ok: true, message: "Sent" };
}

export async function markRead(trainerId: string): Promise<void> {
  if (isDemo()) return;
  const v = await getViewer();
  if (!v) return;
  const other = v.role === "admin" ? "trainer" : "admin";
  await serverClient().from("messages").update({ read_at: new Date().toISOString() }).eq("trainer_id", trainerId).eq("sender_role", other).is("read_at", null);
}
