"use server";
import { revalidatePath } from "next/cache";
import { audited } from "@/lib/audit";
import { getViewer } from "@/lib/data";
import { isDemo, serviceClient } from "@/lib/supabase";
import { MAX_PARKS } from "@/lib/todoParks";

type R = { ok: boolean; message: string };
const who = (v: { name: string; email?: string }) => (v.name === "Dogwise Admin" || v.name === "Dogwise team" ? (v.email || v.name).split("@")[0] : v.name);
export type ParkWhen = "4h" | "tomorrow" | "2d";

/** When a parked item comes back: in 4 hours, tomorrow at 9 AM Eastern, or in 2 days at 9 AM Eastern. */
function until(when: ParkWhen, now = new Date()): string {
  if (when === "4h") return new Date(now.getTime() + 4 * 3600e3).toISOString();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offset = now.getTime() - et.getTime();                    // Eastern wall clock → real time
  const d = new Date(et); d.setDate(d.getDate() + (when === "2d" ? 2 : 1)); d.setHours(9, 0, 0, 0);
  return new Date(d.getTime() + offset).toISOString();
}

/** Park one item, or several about the same trainer: what was done, and when to check back. */
export async function parkAction(keys: string[], did: string, when: ParkWhen, trainerId?: string): Promise<R> {
  return audited("parkTodo", { keys: keys.length, did, when }, async () => {
    if (isDemo()) return { ok: false, message: "Demo mode." };
    const v = await getViewer();
    if (!v || v.role !== "admin") return { ok: false, message: "Admins only." };
    const list = [...new Set(keys)].filter((k) => /^(inc|pattern):[\w-]+$/.test(k)).slice(0, 20);
    if (!list.length || !did.trim()) return { ok: false, message: "Say what you did first." };
    const sb = serviceClient();
    const { data: had, error } = await sb.from("todo_parks").select("item_key, passed").in("item_key", list);
    if (error) return { ok: false, message: /todo_parks|schema cache/i.test(error.message) ? "Run migration 068 in Supabase first." : error.message };
    const n = new Map<string, number>(); let stop = false;
    for (const r of (had || []) as { item_key: string; passed: boolean }[]) { if (r.passed) stop = true; else n.set(r.item_key, (n.get(r.item_key) || 0) + 1); }
    const ok = list.filter((k) => (n.get(k) || 0) < MAX_PARKS);
    if (stop || !ok.length) return { ok: false, message: "This one has had its last park. It needs dealing with now." };
    const at = until(when);
    const { error: e } = await sb.from("todo_parks").insert(ok.map((k) => ({ item_key: k, did: did.trim().slice(0, 120), until: at, by: who(v), trainer_id: trainerId && /^[0-9a-f-]{36}$/i.test(trainerId) ? trainerId : null })));
    revalidatePath("/a");
    return e ? { ok: false, message: e.message } : { ok: true, message: `Parked. Back ${when === "4h" ? "in 4 hours" : when === "tomorrow" ? "tomorrow at 9 AM Eastern" : "in 2 days"} unless it sorts itself first.` };
  });
}

/** Bring a parked item back to "Needs you" now. */
export async function unparkAction(key: string): Promise<R> {
  if (isDemo()) return { ok: false, message: "Demo mode." };
  const v = await getViewer();
  if (!v || v.role !== "admin") return { ok: false, message: "Admins only." };
  const now = new Date().toISOString();
  const { error } = await serviceClient().from("todo_parks").update({ until: now }).eq("item_key", key).gt("until", now);
  revalidatePath("/a");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Back on your list." };
}
