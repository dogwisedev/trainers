import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import seed from "./demo-seed.json";
import { isDemo, serverClient } from "./supabase";
import { Booking, Message, TimeOff, Trainer, Viewer } from "./types";

const demo = seed as unknown as { trainers: Trainer[]; bookings: Booking[]; time_off: TimeOff[] };
const DEMO_MESSAGES: Message[] = [
  { id: "m1", trainer_id: demo.trainers[27].id, sender_role: "trainer", sender_name: demo.trainers[27].name, body: "Hi team, I can take one more for the 3-week program starting Nov 1 if you have someone in Dallas.", created_at: new Date(Date.now() - 3 * 3600e3).toISOString(), read_at: null },
  { id: "m2", trainer_id: demo.trainers[27].id, sender_role: "admin", sender_name: "Dogwise team", body: "Perfect, we have a lead in Euless. Will confirm by tonight.", created_at: new Date(Date.now() - 2 * 3600e3).toISOString(), read_at: null },
  { id: "m3", trainer_id: demo.trainers[3].id, sender_role: "trainer", sender_name: demo.trainers[3].name, body: "Heads up: pickup for Moose moved to Saturday morning.", created_at: new Date(Date.now() - 26 * 3600e3).toISOString(), read_at: null }
];

/** Who is looking. Demo mode: pick a role with ?as=admin or ?as=<trainerId> on /login. */
export async function getViewer(): Promise<Viewer | null> {
  if (isDemo()) {
    const as = cookies().get("demo_as")?.value;
    if (!as) return null;
    if (as === "admin") return { userId: "demo-admin", role: "admin", trainerId: null, name: "Dogwise team", demo: true };
    const t = demo.trainers.find((x) => x.id === as);
    return t ? { userId: "demo-" + t.id, role: "trainer", trainerId: t.id, name: t.name, demo: true } : null;
  }
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: p } = await sb.from("profiles").select("role, trainer_id, display_name").eq("id", user.id).maybeSingle();
  if (!p) return null;
  let name = p.display_name || user.email || "";
  if (p.role === "trainer" && p.trainer_id) {
    const { data: t } = await sb.from("trainers").select("name").eq("id", p.trainer_id).maybeSingle();
    name = t?.name || name;
  }
  return { userId: user.id, role: p.role, trainerId: p.trainer_id, name, demo: false };
}

export async function requireRole(role: "admin" | "trainer"): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect("/login");
  if (v.role !== role) redirect(v.role === "admin" ? "/a" : "/t");
  return v;
}

export async function listTrainers(opts: { includeInactive?: boolean } = {}): Promise<Trainer[]> {
  if (isDemo()) return demo.trainers.filter((t) => opts.includeInactive || t.active).sort((a, b) => a.name.localeCompare(b.name));
  let q = serverClient().from("trainers").select("*").order("name");
  if (!opts.includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as Trainer[];
}

export async function getTrainer(id: string): Promise<Trainer | null> {
  if (isDemo()) return demo.trainers.find((t) => t.id === id) || null;
  const { data } = await serverClient().from("trainers").select("*").eq("id", id).maybeSingle();
  return data as Trainer | null;
}

export async function listBookings(opts: { trainerId?: string; from?: string } = {}): Promise<Booking[]> {
  if (isDemo()) return demo.bookings.filter((b) => (!opts.trainerId || b.trainer_id === opts.trainerId) && (!opts.from || b.end_date >= opts.from)).map((b) => ({ ...b, program: b.program || `${b.weeks}-week`, notes: null, hubspot_deal_id: null }));
  let q = serverClient().from("bookings").select("*").order("start_date");
  if (opts.trainerId) q = q.eq("trainer_id", opts.trainerId);
  if (opts.from) q = q.gte("end_date", opts.from);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as Booking[];
}

export async function listTimeOff(opts: { trainerId?: string; from?: string } = {}): Promise<TimeOff[]> {
  if (isDemo()) return demo.time_off.filter((o) => (!opts.trainerId || o.trainer_id === opts.trainerId) && (!opts.from || o.end_date >= opts.from));
  let q = serverClient().from("time_off").select("*").order("start_date");
  if (opts.trainerId) q = q.eq("trainer_id", opts.trainerId);
  if (opts.from) q = q.gte("end_date", opts.from);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as TimeOff[];
}

export async function listMessages(trainerId: string): Promise<Message[]> {
  if (isDemo()) return DEMO_MESSAGES.filter((m) => m.trainer_id === trainerId);
  const { data } = await serverClient().from("messages").select("*").eq("trainer_id", trainerId).order("created_at").limit(300);
  return (data || []) as Message[];
}

export type Thread = { trainer: Trainer; last: Message; unread: number };
export async function listThreads(): Promise<Thread[]> {
  const trainers = await listTrainers({ includeInactive: true });
  const msgs: Message[] = isDemo()
    ? DEMO_MESSAGES
    : (((await serverClient().from("messages").select("*").order("created_at", { ascending: false }).limit(1000)).data) || []) as Message[];
  const by = new Map<string, Thread>();
  for (const m of [...msgs].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const t = trainers.find((x) => x.id === m.trainer_id);
    if (!t) continue;
    const th = by.get(t.id) || { trainer: t, last: m, unread: 0 };
    if (m.sender_role === "trainer" && !m.read_at) th.unread++;
    by.set(t.id, th);
  }
  return [...by.values()].sort((a, b) => b.last.created_at.localeCompare(a.last.created_at));
}

export async function unreadForTrainer(trainerId: string): Promise<number> {
  return (await listMessages(trainerId)).filter((m) => m.sender_role === "admin" && !m.read_at).length;
}
