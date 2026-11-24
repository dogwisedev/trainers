import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TodoItem } from "./todo";

// Parking (migration 068). An item is in one of three places:
//   you      needs the office now
//   waiting  the office has acted and is waiting on someone; it comes back by itself at `until`, with what was done
//   app      the app is still on it (a dog not ready more than 3 days before its start): not the office's yet
// Rules that keep it honest: three parks at most (the third is the last); a client who has waited over 24 hours can't be
// parked, only answered; a form to review can't be parked; after the last park it can't be parked again: it stays in Needs you until it's dealt with.

export const MAX_PARKS = 3;
type Row = { item_key: string; did: string; until: string | null; passed: boolean; by: string | null; at: string };
const CANT = new Set(["trainer_report"]);

export async function applyParks(items: TodoItem[], sb: SupabaseClient, now = new Date()): Promise<void> {
  const keys = items.map((i) => i.key);
  const rows: Row[] = [];
  for (let i = 0; i < keys.length; i += 150) {
    const { data, error } = await sb.from("todo_parks").select("item_key, did, until, passed, by, at").in("item_key", keys.slice(i, i + 150)).order("at");
    if (error) break; // before migration 068: nothing is parked
    rows.push(...((data || []) as Row[]));
  }
  const by = new Map<string, Row[]>();
  for (const r of rows) by.set(r.item_key, [...(by.get(r.item_key) || []), r]);
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" }), t = now.toISOString();
  for (const i of items) {
    const mine = by.get(i.key) || [], parks = mine.filter((r) => !r.passed), last = parks[parks.length - 1], pass = mine.find((r) => r.passed);
    i.parks = parks.length;
    if (last?.until && last.until > t && !pass) i.park = { until: last.until, did: last.did, by: last.by || "?" };
    else if (last) i.back = { did: last.did, by: last.by || "?", at: last.at };
    const waitedH = i.since ? (now.getTime() - Date.parse(i.since)) / 3600e3 : 0;
    const clientWait = i.kind === "client_waiting" || i.kind === "client_pileup";
    i.parkable = !pass && parks.length < MAX_PARKS && (i.key.startsWith("inc:") || i.key.startsWith("pattern:")) && !CANT.has(i.kind || "") && !(clientWait && waitedH >= 24) && !i.park;
    i.shelf = i.park ? "waiting" : i.appUntil && i.appUntil > today && !i.back ? "app" : "you";
  }
}
