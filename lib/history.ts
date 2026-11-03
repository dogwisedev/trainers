import "server-only";
import { isDemo, serverClient, serviceClient } from "./supabase";
import { programStrip, type Strip, type StripForm } from "./programStrip";
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
  strip?: Strip; poc?: string; owner?: string | null; cancelReason?: string | null;   // admin only: the program at a glance
  picked_up_at?: string | null; dropped_off_at?: string | null;                     // confirmed pickup / drop-off (migration 045)
};

/** admin: also the program strip (forms, weekly reports, handover, follow-ups, payment), the trainer's POC and the salesperson.
 *  trainerIds: only these trainers (the POC filter). */
export async function bookingHistory(o: { tab: Tab; q?: string; trainerId?: string; trainerIds?: string[]; limit?: number; admin?: boolean }): Promise<{ rows: HistoryRow[]; more: boolean }> {
  if (isDemo()) return { rows: [], more: false };
  const sb = serverClient(), today = etParts(new Date()).date, limit = o.limit || 150;
  // Upcoming until the pickup is confirmed, In care until the drop-off is (button or form; migration 045). Before 045 is
  // run, the old date rule (tried second if the columns aren't there).
  const build = (confirmed: boolean) => {
    let q = sb.from("bookings").select(confirmed ? "id, dog_name, client_name, client_email, start_date, end_date, status, program, weeks, extra_days, rehab, trainer_id, hubspot_deal_id, picked_up_at, dropped_off_at, trainers(name)" : "id, dog_name, client_name, client_email, start_date, end_date, status, program, weeks, extra_days, rehab, trainer_id, hubspot_deal_id, trainers(name)");
    if (o.tab === "cancelled") return q.eq("status", "cancelled").order("start_date", { ascending: false });
    q = q.neq("status", "cancelled");
    if (confirmed) {
      if (o.tab === "upcoming") q = q.is("picked_up_at", null).order("start_date");
      if (o.tab === "now") q = q.not("picked_up_at", "is", null).is("dropped_off_at", null).order("end_date");
      if (o.tab === "finished") q = q.not("dropped_off_at", "is", null).order("end_date", { ascending: false });
    } else {
      if (o.tab === "now") q = q.lte("start_date", today).gte("end_date", today).order("end_date");
      if (o.tab === "upcoming") q = q.gt("start_date", today).order("start_date");
      if (o.tab === "finished") q = q.lt("end_date", today).order("end_date", { ascending: false });
    }
    return q;
  };
  let q = build(true);
  if (o.trainerId) q = q.eq("trainer_id", o.trainerId);
  if (o.trainerIds) q = o.trainerIds.length ? q.in("trainer_id", o.trainerIds) : q.eq("trainer_id", "00000000-0000-0000-0000-000000000000");
  const text = (o.q || "").replace(/[,()*%\\]/g, " ").trim().slice(0, 60);
  if (text) {
    const { data: ts } = await sb.from("trainers").select("id").ilike("name", `%${text}%`);
    const ors = [`dog_name.ilike.%${text}%`, `client_name.ilike.%${text}%`, `client_email.ilike.%${text}%`];
    if (/^\d+$/.test(text)) ors.push(`hubspot_deal_id.eq.${text}`);
    if (ts?.length) ors.push(`trainer_id.in.(${ts.map((t) => t.id).join(",")})`);
    q = q.or(ors.join(","));
  }
  let { data, error } = await q.limit(limit + 1);
  if (error && /picked_up_at|dropped_off_at|schema cache/i.test(error.message)) {
    q = build(false);
    if (o.trainerId) q = q.eq("trainer_id", o.trainerId);
    if (o.trainerIds) q = o.trainerIds.length ? q.in("trainer_id", o.trainerIds) : q.eq("trainer_id", "00000000-0000-0000-0000-000000000000");
    if (text) { const { data: ts } = await sb.from("trainers").select("id").ilike("name", `%${text}%`); const ors = [`dog_name.ilike.%${text}%`, `client_name.ilike.%${text}%`, `client_email.ilike.%${text}%`]; if (/^\d+$/.test(text)) ors.push(`hubspot_deal_id.eq.${text}`); if (ts?.length) ors.push(`trainer_id.in.(${ts.map((t) => t.id).join(",")})`); q = q.or(ors.join(",")); }
    ({ data, error } = await q.limit(limit + 1));
  }
  if (error) throw new Error(error.message);
  const list = (data || []).slice(0, limit) as unknown as Omit<HistoryRow, "chat" | "reports">[];
  if (!list.length) return { rows: [], more: false };
  const keys = [...new Set(list.map((b) => dealKey(b)))];
  const [{ data: chats }, { data: reps }] = await Promise.all([
    sb.from("chats").select("id, deal_key, status, created_at").in("deal_key", keys).order("created_at", { ascending: false }),
    sb.from("reports").select("id, booking_id, kind, week_number, status").in("booking_id", list.map((b) => b.id)).in("status", ["submitted", "approved"]).order("week_number")
  ]);
  const chatList = (chats || []) as { id: string; deal_key: string; status: string }[];
  // Admin: everything for the strip (server-only tables: read with the server key; the page checks the admin first)
  let forms: (StripForm & { booking_id: string })[] = [], money = new Map<string, { amount: number | null; amount_paid: number | null; payment_status: string | null; owner_id: string | null }>(),
    fups: { booking_id: string; n: number; status: string }[] = [], poc = new Map<string, string>(), cancel = new Map<string, string | null>();
  if (o.admin) {
    const svc = serviceClient(), ids = list.map((b) => b.id), deals = [...new Set(list.map((b) => b.hubspot_deal_id).filter(Boolean))] as string[];
    const [{ data: f }, { data: m }, { data: fu }, { data: tr }, { data: cx }] = await Promise.all([
      svc.from("reports").select("booking_id, kind, week_number, status, submitted_at, due_by").in("booking_id", ids),
      deals.length ? svc.from("deal_money").select("deal_id, amount, amount_paid, payment_status, owner_id").in("deal_id", deals) : Promise.resolve({ data: [] }),
      svc.from("followups").select("booking_id, n, status").in("booking_id", ids),
      svc.from("trainers").select("id, poc"),
      o.tab === "cancelled" ? svc.from("bookings").select("id, cancel_reason").in("id", ids) : Promise.resolve({ data: [] })
    ]);
    forms = (f || []) as typeof forms;
    money = new Map(((m || []) as { deal_id: string; amount: number | null; amount_paid: number | null; payment_status: string | null; owner_id: string | null }[]).map((x) => [x.deal_id, x]));
    fups = (fu || []) as typeof fups;
    poc = new Map(((tr || []) as { id: string; poc: string | null }[]).map((t) => [t.id, String(t.poc || "").trim()]));
    cancel = new Map(((cx || []) as { id: string; cancel_reason: string | null }[]).map((x) => [x.id, x.cancel_reason]));
  }
  return {
    more: (data || []).length > limit,
    rows: list.map((b) => {
      const mine = chatList.filter((c) => c.deal_key === dealKey(b));
      const chat = mine.find((c) => c.status === "open") || mine[0] || null;
      const row: HistoryRow = { ...b, chat: chat ? { id: chat.id, status: chat.status } : null, reports: ((reps || []) as (HistoryRow["reports"][number] & { booking_id: string })[]).filter((r) => r.booking_id === b.id) };
      if (o.admin) {
        const mo = b.hubspot_deal_id ? money.get(b.hubspot_deal_id) : null;
        const owed = mo && mo.amount != null && mo.amount_paid != null ? Math.max(0, Number(mo.amount) - Number(mo.amount_paid)) : null;
        row.strip = programStrip(b, forms.filter((x) => x.booking_id === b.id), fups.filter((x) => x.booking_id === b.id), mo ? { amount: mo.amount == null ? null : Number(mo.amount), paid: mo.amount_paid == null ? null : Number(mo.amount_paid), owed, status: mo.payment_status } : null);
        row.poc = poc.get(b.trainer_id) || ""; row.owner = mo?.owner_id || null; row.cancelReason = cancel.get(b.id) ?? null;
      }
      return row;
    })
  };
}
