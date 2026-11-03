import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { closedWonSince, hsDateET, hubspotConfigured } from "./hubspot";
import { raiseIncident, resolveIncidents } from "./incidents";
import { auditSystem } from "./audit";

// "Closed Won, not booked": deals won in HubSpot (on or after UNBOOKED_FROM, default Oct 11 2026) with no booking in the app.
// Runs with the 30-minute HubSpot sync. Each one is a To do item with a "Book now" button that fills the form from the deal.
// It stays until the deal is booked, put on Standby, or Cancelled (Client Status in HubSpot), or stops being Closed Won.
// There's no plain "Done": the To do row offers Book now, Standby (note + optional reminder) and Cancelled (with HubSpot's reason).
// A training cancelled in the app whose deal is still Closed Won (and not Cancelled/Standby/Refunded) comes back too.
export const UNBOOKED_FROM = () => (/^\d{4}-\d{2}-\d{2}$/.test(process.env.UNBOOKED_FROM || "") ? process.env.UNBOOKED_FROM! : "2026-10-11");
const dealUrl = (id: string) => `https://app.hubspot.com/contacts/21869370/record/0-3/${id}`;
const DOGS = ["k9___dog_name", "dog_2_name", "dog_3_name", "dog_4_name"];

export async function checkUnbookedDeals(sb: SupabaseClient = serviceClient()) {
  const out = { won: 0, raised: 0, cleared: 0, errors: [] as string[] };
  if (!hubspotConfigured()) return out;
  let deals;
  try { deals = await closedWonSince(UNBOOKED_FROM(), ["dealname", "client_status", ...DOGS]); }
  catch (e) { out.errors.push((e as Error).message); return out; } // HubSpot unreachable: change nothing
  out.won = deals.length;
  const ids = deals.map((d) => d.id);

  // Which deals have a live booking (a cancelled one doesn't count: the deal still needs a decision in HubSpot)
  const booked = new Set<string>(), cancelledOnly = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from("bookings").select("hubspot_deal_id, status").in("hubspot_deal_id", ids.slice(i, i + 200));
    if (error) { out.errors.push(error.message); return out; }
    for (const r of (data || []) as { hubspot_deal_id: string; status: string }[]) { if (r.status !== "cancelled") booked.add(r.hubspot_deal_id); else cancelledOnly.add(r.hubspot_deal_id); }
  }
  for (const id of booked) cancelledOnly.delete(id);
  const decided = (d: { properties: Record<string, string | null> }) => /^(standby|cancelled|refunded)$/i.test(String(d.properties.client_status || "").trim());
  const { data: incs } = await sb.from("chat_incidents").select("ref, status").eq("kind", "deal_not_booked").neq("status", "resolved");
  const live = new Set(((incs || []) as { ref: string | null }[]).map((r) => r.ref));

  for (const d of deals) {
    const ref = `deal:${d.id}`;
    if (booked.has(d.id) || decided(d) || live.has(ref)) continue;
    const name = d.properties.dealname || `Deal ${d.id}`;
    const dogs = DOGS.map((k) => (d.properties[k] || "").trim()).filter(Boolean);
    const won = hsDateET(d.properties.closedate);
    if (await raiseIncident({
      kind: "deal_not_booked", title: name, ref, urgent: false, link: dealUrl(d.id),
      detail: cancelledOnly.has(d.id)
        ? `${name}${dogs.length ? ` (${dogs.join(" & ")})` : ""}: cancelled in the app, but still Closed Won in HubSpot. Book again, put on Standby, or mark Cancelled.`
        : `${name}${dogs.length ? ` (${dogs.join(" & ")})` : ""}: Closed Won${won ? ` on ${won}` : ""} in HubSpot, but not booked in the app.`
    }, sb)) out.raised++;
  }
  // Clear the ones that are now booked, decided (Standby / Cancelled / Refunded in HubSpot), or no longer Closed Won
  const wonOf = new Map(deals.map((d) => [d.id, d]));
  for (const ref of live) {
    const id = String(ref || "").replace(/^deal:/, "");
    if (!id) continue;
    const d = wonOf.get(id);
    if (booked.has(id) || !d || decided(d)) {
      await resolveIncidents({ kinds: ["deal_not_booked"], ref: ref! }, "automatic", booked.has(id) ? "Booked in the app" : !d ? "No longer Closed Won in HubSpot" : `Client Status is ${d.properties.client_status} in HubSpot`, sb);
      out.cleared++;
    }
  }
  if (out.raised) await auditSystem("Found Closed Won deals not booked in the app", `${out.raised} new on To do (checking deals won since ${UNBOOKED_FROM()}).`, { link: "/a" });
  return out;
}

/** Called right after a booking is saved, so its "not booked" to-do disappears straight away. */
export async function clearUnbooked(dealId: string | null | undefined, sb?: SupabaseClient) {
  if (!dealId) return;
  try {
    await resolveIncidents({ kinds: ["deal_not_booked", "standby_reminder"], ref: `deal:${dealId}` }, "automatic", "Booked in the app", sb);
    await resolveIncidents({ kinds: ["standby_reminder"], ref: `standby:${dealId}` }, "automatic", "Booked in the app", sb);
    await (sb || serviceClient()).from("standby").delete().eq("deal_id", dealId); // booked again: off the Standby list (Client Status moves on with the program sync)
  } catch { /* the cron clears it anyway */ }
}
