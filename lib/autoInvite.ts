import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { addDays } from "./dates";
import { etParts } from "./chatRules";
import { dealContacts, hubspotConfigured, readContacts } from "./hubspot";
import { ensureChatsForBookings } from "./chat";
import { auditSystem } from "./audit";

// Clients get their chat link automatically 7 days before training starts (straight away if the booking is made later than that).
// Runs with the 10-minute chat check and right after a booking is saved. CHAT_AUTO_INVITE=off in Vercel turns it off.
export const INVITE_DAYS_BEFORE = 7;
export const autoInviteOn = () => (process.env.CHAT_AUTO_INVITE || "").trim().toLowerCase() !== "off";
const today = () => etParts(new Date()).date;
/** Within 7 days of the start (or already in training, not finished yet). */
export const inviteDue = (b: { start_date: string; end_date: string }, t = today()) => b.start_date <= addDays(t, INVITE_DAYS_BEFORE) && b.end_date >= t;
/** For a booking being made now: invite with it? (The old CHAT_INVITE_CLIENTS=1 still means "always".) */
export const inviteWithBooking = (bs: { start_date: string; end_date: string }[]) => process.env.CHAT_INVITE_CLIENTS === "1" || (autoInviteOn() && bs.some((b) => inviteDue(b)));

type Bk = { id: string; trainer_id: string; client_name: string; client_email: string | null; dog_name: string | null; hubspot_deal_id: string | null; start_date: string; end_date: string; status: string };

/** The client's email from the HubSpot deal's contact, for bookings saved without one. */
async function emailFromDeal(dealId: string): Promise<string | null> {
  if (!hubspotConfigured() || !/^\d+$/.test(dealId)) return null;
  try {
    const ids = (await dealContacts([dealId])).get(dealId) || [];
    const contacts = await readContacts(ids, ["email"]);
    for (const c of contacts.values()) { const e = String(c.email || "").trim().toLowerCase(); if (/^\S+@\S+\.\S+$/.test(e)) return e; }
  } catch { /* HubSpot unreachable: try again next run */ }
  return null;
}

/** Invites every client whose dog starts within 7 days and who hasn't had their chat link yet. Never throws. */
export async function autoInviteClients(sb: SupabaseClient = serviceClient()) {
  const out = { invited: 0, errors: [] as string[] };
  if (!autoInviteOn()) return out;
  try {
    const t = today();
    const { data: chats } = await sb.from("chats").select("id, deal_key, client_email, client_name, title").eq("status", "open").is("invited_at", null).limit(200);
    const list = (chats || []) as { id: string; deal_key: string; client_email: string | null; client_name: string | null; title: string | null }[];
    if (!list.length) return out;
    const keys = list.map((c) => c.deal_key);
    const [a, b] = await Promise.all([
      sb.from("bookings").select("id, trainer_id, client_name, client_email, dog_name, hubspot_deal_id, start_date, end_date, status").in("hubspot_deal_id", keys).neq("status", "cancelled"),
      sb.from("bookings").select("id, trainer_id, client_name, client_email, dog_name, hubspot_deal_id, start_date, end_date, status").in("id", keys.filter((k) => /^[0-9a-f-]{36}$/i.test(k))).neq("status", "cancelled")
    ]);
    const all = [...((a.data || []) as Bk[]), ...((b.data || []) as Bk[])];
    for (const c of list) {
      const bs = all.filter((x) => (x.hubspot_deal_id || x.id) === c.deal_key);
      if (!bs.some((x) => inviteDue(x, t))) continue;
      const email = c.client_email || bs.map((x) => x.client_email).find(Boolean) || (await emailFromDeal(c.deal_key));
      if (!email) { out.errors.push(`${c.title || "chat"}: no client email on the booking or the HubSpot contact`); continue; }
      const [r] = await ensureChatsForBookings(bs.map((x) => ({ ...x, client_email: x.client_email || email })), { invite: true });
      if (r?.invited) {
        out.invited++;
        await auditSystem("Invited a client to their chat", `${c.title || "Dog"} (${c.client_name || "client"}): chat link emailed to ${email}, ${INVITE_DAYS_BEFORE} days or less before training.`, { link: `/a/chats/${c.id}` });
      } else if (r?.note) out.errors.push(`${c.title || "chat"}: ${r.note}`);
    }
  } catch (e) { out.errors.push((e as Error).message); }
  return out;
}
