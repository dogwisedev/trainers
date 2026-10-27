import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { closedWonSince, hsDateET, hubspotConfigured } from "./hubspot";
import { raiseIncident, resolveIncidents } from "./incidents";
import { auditSystem } from "./audit";

// "Closed Won, not booked": deals won in HubSpot (on or after UNBOOKED_FROM, default Oct 11 2026) with no booking in the app.
// Runs with the 30-minute HubSpot sync. Each one is a To do item with a "Book now" button that fills the form from the deal.
// It clears itself once the deal is booked (or stops being Closed Won). "Not a booking" on To do dismisses it for good.
export const UNBOOKED_FROM = () => (/^\d{4}-\d{2}-\d{2}$/.test(process.env.UNBOOKED_FROM || "") ? process.env.UNBOOKED_FROM! : "2026-10-11");
const dealUrl = (id: string) => `https://app.hubspot.com/contacts/21869370/record/0-3/${id}`;
const DOGS = ["k9___dog_name", "dog_2_name", "dog_3_name", "dog_4_name"];

export async function checkUnbookedDeals(sb: SupabaseClient = serviceClient()) {
  const out = { won: 0, raised: 0, cleared: 0, errors: [] as string[] };
  if (!hubspotConfigured()) return out;
  let deals;
  try { deals = await closedWonSince(UNBOOKED_FROM(), ["dealname", ...DOGS]); }
  catch (e) { out.errors.push((e as Error).message); return out; } // HubSpot unreachable: change nothing
  out.won = deals.length;
  const ids = deals.map((d) => d.id);

  // Which of these deals have a booking (any status: a cancelled booking is a decision someone made)
  const booked = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from("bookings").select("hubspot_deal_id").in("hubspot_deal_id", ids.slice(i, i + 200));
    if (error) { out.errors.push(error.message); return out; }
    for (const r of (data || []) as { hubspot_deal_id: string }[]) booked.add(r.hubspot_deal_id);
  }
  const { data: incs } = await sb.from("chat_incidents").select("ref, status, auto_resolved").eq("kind", "deal_not_booked");
  const rows = (incs || []) as { ref: string | null; status: string; auto_resolved: boolean }[];
  const dismissed = new Set(rows.filter((r) => r.status === "resolved" && !r.auto_resolved).map((r) => r.ref));
  const live = new Set(rows.filter((r) => r.status !== "resolved").map((r) => r.ref));

  for (const d of deals) {
    const ref = `deal:${d.id}`;
    if (booked.has(d.id) || dismissed.has(ref) || live.has(ref)) continue;
    const name = d.properties.dealname || `Deal ${d.id}`;
    const dogs = DOGS.map((k) => (d.properties[k] || "").trim()).filter(Boolean);
    const won = hsDateET(d.properties.closedate);
    if (await raiseIncident({
      kind: "deal_not_booked", title: name, ref, urgent: false, link: dealUrl(d.id),
      detail: `${name}${dogs.length ? ` (${dogs.join(" & ")})` : ""}: Closed Won${won ? ` on ${won}` : ""} in HubSpot, but not booked in the app.`
    }, sb)) out.raised++;
  }
  // Clear the ones that are now booked, or no longer Closed Won
  const wonIds = new Set(ids);
  for (const ref of live) {
    const id = String(ref || "").replace(/^deal:/, "");
    if (!id) continue;
    if (booked.has(id) || !wonIds.has(id)) {
      await resolveIncidents({ kinds: ["deal_not_booked"], ref: ref! }, "automatic", booked.has(id) ? "Booked in the app" : "No longer Closed Won in HubSpot", sb);
      out.cleared++;
    }
  }
  if (out.raised) await auditSystem("Found Closed Won deals not booked in the app", `${out.raised} new on To do (checking deals won since ${UNBOOKED_FROM()}).`, { link: "/a" });
  return out;
}

/** Called right after a booking is saved, so its "not booked" to-do disappears straight away. */
export async function clearUnbooked(dealId: string | null | undefined, sb?: SupabaseClient) {
  if (!dealId) return;
  try { await resolveIncidents({ kinds: ["deal_not_booked"], ref: `deal:${dealId}` }, "automatic", "Booked in the app", sb); } catch { /* the cron clears it anyway */ }
}
