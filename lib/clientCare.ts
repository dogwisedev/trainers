import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { addDays, todayIso } from "./dates";

// Watch list, client notes and wins (migration 060): what the Tower's prompt used to carry, now in the app for everyone.

export type Watch = { booking_id: string; reason: string; note: string | null; by: string | null; at: string };
export type ClientNote = { id: string; deal_key: string; text: string; office_only: boolean; by: string | null; role: string | null; at: string };
export const WATCH_REASONS = ["Behavior concern", "Health", "Client unhappy", "New or struggling trainer", "Money or dates", "Other"];

export async function watchOf(bookingId: string, sb: SupabaseClient = serviceClient()): Promise<Watch | null> {
  const { data, error } = await sb.from("watch_list").select("*").eq("booking_id", bookingId).maybeSingle();
  return error ? null : (data as Watch | null);
}
export async function notesOf(dealKey: string, officeToo: boolean, sb: SupabaseClient = serviceClient()): Promise<ClientNote[]> {
  let q = sb.from("client_notes").select("*").eq("deal_key", dealKey).order("at", { ascending: false }).limit(50);
  if (!officeToo) q = q.eq("office_only", false);
  const { data, error } = await q;
  return error ? [] : ((data || []) as ClientNote[]);
}

const clip = (s: string | null | undefined, n: number) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** For the office brief: each watched dog with what happened since `since` (messages, labels). Ends 7 days after drop-off. */
export async function watching(since: string, site: string, sb: SupabaseClient = serviceClient()) {
  const { data, error } = await sb.from("watch_list").select("booking_id, reason, note, by, at").limit(200);
  if (error || !data?.length) return [];
  const rows = data as Watch[];
  const { data: bks } = await sb.from("bookings").select("id, dog_name, client_name, end_date, hubspot_deal_id, trainers(name)").in("id", rows.map((r) => r.booking_id));
  const out: { dog: string; client: string; trainer: string; reason: string; note?: string; days: number; since: string; latest?: string; urgent: number; link: string }[] = [];
  for (const b of (bks || []) as unknown as { id: string; dog_name: string | null; client_name: string; end_date: string; hubspot_deal_id: string | null; trainers: { name: string } | null }[]) {
    if (b.end_date < addDays(todayIso(), -7)) continue;
    const w = rows.find((r) => r.booking_id === b.id)!;
    const { data: chat } = await sb.from("chats").select("id").eq("deal_key", b.hubspot_deal_id || b.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    let latest: string | undefined, urgent = 0, n = 0;
    if (chat) {
      const { data: msgs } = await sb.from("chat_messages").select("id, sender_role, body, created_at").eq("chat_id", chat.id).in("sender_role", ["client", "trainer"]).gt("created_at", since).order("created_at", { ascending: false }).limit(30);
      const m = (msgs || []) as { id: string; sender_role: string; body: string | null }[];
      n = m.length;
      const c = m.find((x) => x.sender_role === "client" && x.body);
      if (c) latest = `“${clip(c.body, 140)}”`;
      if (m.length) { const { data: lab } = await sb.from("message_needs").select("needs").in("message_id", m.map((x) => x.id)).eq("needs", "urgent"); urgent = (lab || []).length; }
    }
    out.push({ dog: b.dog_name || "Dog", client: b.client_name, trainer: b.trainers?.name || "?", reason: w.reason, note: w.note || undefined, days: Math.max(1, Math.floor((Date.now() - Date.parse(w.at)) / 864e5)),
      since: n ? `${n} new message${n === 1 ? "" : "s"}` : "nothing new", latest, urgent, link: `${site}/a/dogs/${b.id}` });
  }
  return out;
}

/** Client messages praising the trainer or the progress, since `since`, newest first: quoted, with the trainer. */
export async function wins(since: string, site: string, sb: SupabaseClient = serviceClient(), limit = 20) {
  const { data, error } = await sb.from("message_needs").select("message_id, chat_id, sent_at").eq("praise", true).gte("sent_at", since).order("sent_at", { ascending: false }).limit(limit);
  if (error || !data?.length) return [];
  const rows = data as { message_id: string; chat_id: string; sent_at: string }[];
  const [{ data: msgs }, { data: chats }] = await Promise.all([
    sb.from("chat_messages").select("id, body").in("id", rows.map((r) => r.message_id)),
    sb.from("chats").select("id, title, client_name, trainer_name").in("id", [...new Set(rows.map((r) => r.chat_id))])
  ]);
  const body = new Map(((msgs || []) as { id: string; body: string | null }[]).map((m) => [m.id, m.body || ""]));
  const chat = new Map(((chats || []) as { id: string; title: string | null; client_name: string | null; trainer_name: string | null }[]).map((c) => [c.id, c]));
  return rows.map((r) => { const c = chat.get(r.chat_id); return { dog: c?.title || "Dog", client: c?.client_name || "Client", trainer: c?.trainer_name || "?", quote: `“${clip(body.get(r.message_id), 180)}”`, at: r.sent_at, link: `${site}/a/chats/${r.chat_id}` }; });
}
