import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyBookings } from "./bookingEmail";
import { ensureChatsForBookings } from "./chat";

// Safety net, run by the 10-minute chat check: a booking saved in the last 3 days whose trainer was never emailed
// (or that has no chat yet) gets its "New booking" email and its chat now.
export async function catchUpBookings(sb: SupabaseClient) {
  const since = new Date(Date.now() - 3 * 86400e3).toISOString(), settle = new Date(Date.now() - 3 * 60e3).toISOString();
  const { data } = await sb.from("bookings").select("id, trainer_id, client_name, client_email, dog_name, hubspot_deal_id")
    .is("notified_at", null).neq("status", "cancelled").gte("created_at", since).lte("created_at", settle).limit(30); // 3 minutes' grace for the booking's own email
  const rows = (data || []) as { id: string; trainer_id: string; client_name: string; client_email: string | null; dog_name: string | null; hubspot_deal_id: string | null }[];
  if (!rows.length) return { emailed: 0, errors: [] as string[] };
  const n = await notifyBookings(sb, rows.map((r) => r.id), "new");
  await ensureChatsForBookings(rows, { invite: process.env.CHAT_INVITE_CLIENTS === "1" }).catch(() => []);
  return { emailed: n.sent, errors: n.skipped ? [n.skipped] : n.errors };
}
