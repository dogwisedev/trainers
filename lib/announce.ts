import "server-only";
import { serviceClient } from "./supabase";

// Once-only announcements in Buzz (new sales, new Bark leads), shared by the HubSpot webhook and the 30-minute safety net.
// Each item is claimed in app_state before posting (the key is the primary key, so only one caller can win), and released
// if the post fails so the safety net tries again. Items from before a kind of announcement went live are never posted.

/** When this kind of announcement started (set on first use). */
export async function startedAt(kind: string): Promise<number> {
  const sb = serviceClient(), key = `${kind}_buzz_start`;
  const { data } = await sb.from("app_state").select("value").eq("key", key).maybeSingle();
  if (data?.value) return Date.parse(data.value);
  const now = new Date().toISOString();
  await sb.from("app_state").insert({ key, value: now }); // a race just means the other caller set the same moment
  return Date.parse(now);
}

/** true = this caller owns the announcement; false = already claimed. Throws on a database problem. */
export async function claim(key: string): Promise<boolean> {
  const { error } = await serviceClient().from("app_state").insert({ key, value: new Date().toISOString() });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`couldn't claim ${key}: ${error.message}`);
}

export async function release(key: string) { await serviceClient().from("app_state").delete().eq("key", key); }

/** Which of these keys are already claimed. */
export async function claimed(keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const { data } = await serviceClient().from("app_state").select("key").in("key", keys);
  return new Set((data || []).map((r: { key: string }) => r.key));
}
