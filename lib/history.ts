import "server-only";
import { isDemo, serverClient } from "./supabase";
import { etParts } from "./chatRules";
import { dealKey } from "./chatTypes";
import type { Kind, Status } from "./reports";

// Bookings past and present, for the admin Bookings page, the trainer's page and the trainer's "Past dogs".
// Row level security keeps trainers to their own bookings.

export type Tab = "upcoming" | "now" | "finished" | "cancelled";
export const TABS: { key: Tab; label: string }[] = [
  { key: "now", label: "In care" }, { key: "upcoming", label: "Upcoming" }, { key: "finished", label: "Finished" }, { key: "cancelled", label: "Cancelled" }
];
export type HistoryRow = {
  id: string; dog_name: string | null; client_name: string; client_email: string | null; start_date: string; end_date: string; status: string;
  program: string | null; weeks: number; extra_days: number | null; rehab: boolean | null; trainer_id: string; hubspot_deal_id: string | null;
  trainers: { name: string } | null;
  chat: { id: string; status: string } | null;                                     // the dog's chat (open one first, else the latest)
  reports: { id: string; kind: Kind; week_number: number; status: Status }[];      // submitted and approved forms
};

export async function bookingHistory(o: { tab: Tab; q?: string; trainerId?: string; limit?: number }): Promise<{ rows: HistoryRow[]; more: boolean }> {
  if (isDemo()) return { rows: [], more: false };
  const sb = serverClient(), today = etParts(new Date()).date, limit = o.limit || 150;
  let q = sb.from("bookings").select("id, dog_name, client_name, client_email, start_date, end_date, status, program, weeks, extra_days, rehab, trainer_id, hubspot_deal_id, trainers(name)");
  if (o.tab === "cancelled") q = q.eq("status", "cancelled").order("start_date", { ascending: false });
  else {
    q = q.neq("status", "cancelled");
    if (o.tab === "now") q = q.lte("start_date", today).gte("end_date", today).order("end_date");
    if (o.tab === "upcoming") q = q.gt("start_date", today).order("start_date");
    if (o.tab === "finished") q = q.lt("end_date", today).order("end_date", { ascending: false });
  }
  if (o.trainerId) q = q.eq("trainer_id", o.trainerId);
  const text = (o.q || "").replace(/[,()*%\\]/g, " ").trim().slice(0, 60);
  if (text) {
    const { data: ts } = await sb.from("trainers").select("id").ilike("name", `%${text}%`);
    const ors = [`dog_name.ilike.%${text}%`, `client_name.ilike.%${text}%`, `client_email.ilike.%${text}%`];
    if (/^\d+$/.test(text)) ors.push(`hubspot_deal_id.eq.${text}`);
    if (ts?.length) ors.push(`trainer_id.in.(${ts.map((t) => t.id).join(",")})`);
    q = q.or(ors.join(","));
  }
  const { data, error } = await q.limit(limit + 1);
  if (error) throw new Error(error.message);
  const list = (data || []).slice(0, limit) as unknown as Omit<HistoryRow, "chat" | "reports">[];
  if (!list.length) return { rows: [], more: false };
  const keys = [...new Set(list.map((b) => dealKey(b)))];
  const [{ data: chats }, { data: reps }] = await Promise.all([
    sb.from("chats").select("id, deal_key, status, created_at").in("deal_key", keys).order("created_at", { ascending: false }),
    sb.from("reports").select("id, booking_id, kind, week_number, status").in("booking_id", list.map((b) => b.id)).in("status", ["submitted", "approved"]).order("week_number")
  ]);
  const chatList = (chats || []) as { id: string; deal_key: string; status: string }[];
  return {
    more: (data || []).length > limit,
    rows: list.map((b) => {
      const mine = chatList.filter((c) => c.deal_key === dealKey(b));
      const chat = mine.find((c) => c.status === "open") || mine[0] || null;
      return { ...b, chat: chat ? { id: chat.id, status: chat.status } : null, reports: ((reps || []) as (HistoryRow["reports"][number] & { booking_id: string })[]).filter((r) => r.booking_id === b.id) };
    })
  };
}
