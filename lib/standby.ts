import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { closedWonWithStatus, hubspotConfigured, optionValue, propDefs, readDeals, updateDeal } from "./hubspot";
import { raiseIncident, resolveIncidents } from "./incidents";
import { auditSystem } from "./audit";
import { todayIso } from "./dates";
import { salesPeople } from "./sales";

// Standby: Closed Won deals parked (never booked), and trainings postponed. HubSpot's Client Status = "Standby" is the
// truth for the list; the app adds a note and an optional reminder (table standby, migration 043). A reminder comes back
// as a To do on its day. Cancelling writes Client Status = "Cancelled" and HubSpot's Cancellation Reason.

const dealUrl = (id: string) => `https://app.hubspot.com/contacts/21869370/record/0-3/${id}`;
const DOGS = ["k9___dog_name", "dog_2_name", "dog_3_name", "dog_4_name"];

/** HubSpot: Client Status = Standby (and, for a postponed training, who asked). */
export async function hubspotStandby(dealId: string, postponedBy?: string | null) {
  if (!hubspotConfigured() || !/^\d+$/.test(dealId)) return;
  const defs = await propDefs("deals");
  const props: Record<string, string> = {};
  const st = optionValue(defs.get("client_status"), "Standby"); if (st) props.client_status = st;
  if (postponedBy) { const by = optionValue(defs.get("drop_off_postponed"), postponedBy); if (by) props.drop_off_postponed = by; }
  if (Object.keys(props).length) await updateDeal(dealId, props);
}

/** HubSpot: Client Status = Cancelled, Cancellation Reason (one of HubSpot's options), Cancellation Info (the note). */
export async function hubspotCancelled(dealId: string, reason: string, note: string) {
  if (!hubspotConfigured() || !/^\d+$/.test(dealId)) return;
  const defs = await propDefs("deals");
  const props: Record<string, string> = {};
  const st = optionValue(defs.get("client_status"), "Cancelled"); if (st) props.client_status = st;
  const why = reason && reason !== "Other" ? optionValue(defs.get("cancellation_reason"), reason) : null; if (why) props.cancellation_reason = why;
  const info = (note || "").trim();
  if (defs.has("cancellation_info") && info) props.cancellation_info = info.slice(0, 1000);
  if (Object.keys(props).length) await updateDeal(dealId, props);
}

/** Put a deal on standby: note, optional reminder date. Clears its "not booked" / reminder To do. */
export async function setStandby(o: { dealId: string; note: string; remindOn: string | null; by: string; source: "deal" | "postponed"; bookingId?: string | null; postponedBy?: string | null }, sb: SupabaseClient = serviceClient()) {
  const { error } = await sb.from("standby").upsert({ deal_id: o.dealId, source: o.source, booking_id: o.bookingId || null, note: o.note || null, remind_on: o.remindOn || null, reminded_at: null, created_by: o.by, updated_at: new Date().toISOString() }, { onConflict: "deal_id" });
  if (error) throw new Error(/standby|schema cache/i.test(error.message) ? "Standby isn't switched on yet (migration 043)." : error.message);
  await hubspotStandby(o.dealId, o.postponedBy || null);
  await resolveIncidents({ kinds: ["deal_not_booked", "standby_reminder"], ref: `deal:${o.dealId}` }, o.by, `On standby${o.remindOn ? `, reminder ${o.remindOn}` : ""}`, sb);
  await resolveIncidents({ kinds: ["standby_reminder"], ref: `standby:${o.dealId}` }, o.by, "Standby updated", sb);
}

/** Cancel a Closed Won deal that was never booked (or is on standby). */
export async function cancelDeal(o: { dealId: string; reason: string; note: string; by: string }, sb: SupabaseClient = serviceClient()) {
  await hubspotCancelled(o.dealId, o.reason, o.note);
  await sb.from("standby").delete().eq("deal_id", o.dealId);
  for (const ref of [`deal:${o.dealId}`, `standby:${o.dealId}`]) await resolveIncidents({ kinds: ["deal_not_booked", "standby_reminder"], ref }, o.by, `Cancelled: ${o.reason}`, sb);
}

/** Standby reminders whose day has come: a To do each (runs with the 30-minute HubSpot sync). */
export async function standbyReminders(sb: SupabaseClient = serviceClient()) {
  const out = { raised: 0, errors: [] as string[] };
  const { data, error } = await sb.from("standby").select("deal_id, note, remind_on, created_at").lte("remind_on", todayIso()).is("reminded_at", null).limit(50);
  if (error) { if (!/standby|schema cache/i.test(error.message)) out.errors.push(error.message); return out; }
  if (!data?.length) return out;
  const names = hubspotConfigured() ? await readDeals(data.map((x) => x.deal_id), ["dealname", ...DOGS]).catch(() => new Map()) : new Map();
  for (const r of data as { deal_id: string; note: string | null; remind_on: string; created_at: string }[]) {
    const p = names.get(r.deal_id) || {}, name = p.dealname || `Deal ${r.deal_id}`, dogs = DOGS.map((k) => String(p[k] || "").trim()).filter(Boolean);
    const ok = await raiseIncident({ kind: "standby_reminder", title: name, ref: `standby:${r.deal_id}`, urgent: false, link: dealUrl(r.deal_id),
      detail: `${name}${dogs.length ? ` (${dogs.join(" & ")})` : ""}: on standby since ${r.created_at.slice(0, 10)}.${r.note ? ` Note: ${r.note}` : ""}` }, sb);
    await sb.from("standby").update({ reminded_at: new Date().toISOString() }).eq("deal_id", r.deal_id);
    if (ok) out.raised++;
  }
  if (out.raised) await auditSystem("Standby reminders due", `${out.raised} on To do.`, { link: "/a/dogs?f=standby" });
  return out;
}

export type StandbyRow = { dealId: string; name: string; dogs: string; zip: string; amount: number; paid: number | null; wonOn: string; owner: string; note: string; remindOn: string | null; since: string | null; source: string; hubspot: string };
/** The Standby list: every Closed Won deal with Client Status = Standby in HubSpot, with the app's note and reminder. */
export async function listStandby(sb: SupabaseClient = serviceClient()): Promise<{ rows: StandbyRow[]; error?: string }> {
  if (!hubspotConfigured()) return { rows: [], error: "HubSpot isn't set up here." };
  try {
    const [deals, people] = await Promise.all([closedWonWithStatus("Standby", ["dealname", "amount", "closedate", "hubspot_owner_id", ...DOGS]), salesPeople().catch(() => [])]);
    const ids = deals.map((d) => d.id);
    const [{ data: notes }, { data: money }] = await Promise.all([
      ids.length ? sb.from("standby").select("deal_id, note, remind_on, created_at, source").in("deal_id", ids) : Promise.resolve({ data: [] }),
      ids.length ? sb.from("deal_money").select("deal_id, amount_paid").in("deal_id", ids) : Promise.resolve({ data: [] })
    ]);
    const nOf = new Map(((notes || []) as { deal_id: string; note: string | null; remind_on: string | null; created_at: string; source: string }[]).map((x) => [x.deal_id, x]));
    const mOf = new Map(((money || []) as { deal_id: string; amount_paid: number | null }[]).map((x) => [x.deal_id, x]));
    const owner = new Map(people.map((o) => [o.id, o.name]));
    const rows = deals.map((d) => {
      const p = d.properties, n = nOf.get(d.id), zip = (String(p.dealname || "").match(/\b(\d{5})\b/) || [])[1] || "";
      return { dealId: d.id, name: String(p.dealname || `Deal ${d.id}`).replace(/,?\s*\b\d{5}\b\s*$/, "").trim(), dogs: DOGS.map((k) => String(p[k] || "").trim()).filter(Boolean).join(" & "), zip,
        amount: Number(p.amount || 0), paid: mOf.get(d.id)?.amount_paid ?? null, wonOn: String(p.closedate || "").slice(0, 10), owner: owner.get(String(p.hubspot_owner_id || "")) || "",
        note: n?.note || "", remindOn: n?.remind_on || null, since: n?.created_at?.slice(0, 10) || null, source: n?.source || "deal", hubspot: dealUrl(d.id) };
    });
    return { rows };
  } catch (e) { return { rows: [], error: (e as Error).message }; }
}
