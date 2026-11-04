import "server-only";
import { serviceClient } from "./supabase";
import { daysBetween, short } from "./dates";
import { dealContacts, dealDateProps, hsDate, hubspotConfigured, readContacts, readDeals, stageLabel } from "./hubspot";
import { clientPlace, zipIn } from "./mileageCheck";
import { PROGRAM_SOLD } from "./programs";
import { dayET } from "./pulseMath";

// A Closed Won deal as the booking page and the Sales Assistant need it: client, dogs, dates, length, program, where the
// trainer drives to, when it was sold (for the short-notice test), and what's already booked on it.
const DEAL_DOGS = ["k9___dog_name", "dog_2_name", "dog_3_name", "dog_4_name"];
export type DealForBooking = { id: string; name: string; client: string; email: string; zip?: string; dogs: string[]; start: string | null; end: string | null; weeks: number | null; extra: number; stage: string; closedWon: boolean; program?: string; soldOn?: string | null;
  booked: { id: string; dog: string; trainer: string; dates: string }[] };

export async function readDealForBooking(id: string): Promise<{ ok: boolean; message: string; deal?: DealForBooking }> {
  const sb = serviceClient();
  const { data: existing } = await sb.from("bookings").select("id, dog_name, start_date, end_date, trainers(name)").eq("hubspot_deal_id", id).neq("status", "cancelled");
  const booked = ((existing || []) as unknown as { id: string; dog_name: string | null; start_date: string; end_date: string; trainers: { name: string } | null }[])
    .map((b) => ({ id: b.id, dog: b.dog_name || "Dog", trainer: b.trainers?.name || "no trainer", dates: `${short(b.start_date)} to ${short(b.end_date)}` }));
  if (!hubspotConfigured()) return { ok: true, message: "HubSpot isn't connected, so fill in the rest by hand.", deal: { id, name: `Deal ${id}`, client: "", email: "", dogs: [], start: null, end: null, weeks: null, extra: 0, stage: "", closedWon: false, booked } };
  try {
    const props = await dealDateProps();
    const deals = await readDeals([id], ["dealname", "hs_is_closed_won", "dealstage", "type_of_program_sold", "closedate", props.start.name, ...(props.end ? [props.end.name] : []), ...DEAL_DOGS]);
    const d = deals.get(id);
    if (!d) return { ok: false, message: `HubSpot has no deal ${id}. Check the link.` };
    const contactIds = (await dealContacts([id])).get(id) || [];
    const contacts = [...(await readContacts(contactIds, ["firstname", "lastname", "email", "zip", "address", "if_no_please_provide_the_full_pickup_address", "is_the_pickup_address_the_same_as_the_address_provided_above"])).values()];
    const c = contacts.find((x) => x.email) || contacts[0] || {};
    const start = hsDate(d[props.start.name]), end = props.end ? hsDate(d[props.end.name]) : null;
    let weeks: number | null = null, extra = 0;
    if (start && end && end > start) { const days = daysBetween(start, end); weeks = Math.min(12, Math.max(1, Math.floor(days / 7))); extra = Math.min(13, Math.max(0, days - weeks * 7)); }
    return { ok: true, message: "", deal: {
      id, name: d.dealname || `Deal ${id}`, client: [c.firstname, c.lastname].filter(Boolean).join(" ").trim(), email: String(c.email || "").trim().toLowerCase(),
      // Where the trainer drives to: the pickup address's ZIP if it's different, else the client's ZIP, else the one in the deal name
      zip: (clientPlace(c as Record<string, unknown>)?.zip || zipIn(d.dealname) || "").slice(0, 5),
      dogs: DEAL_DOGS.map((k) => String(d[k] || "").trim()).filter(Boolean), start, end, weeks, extra,
      stage: await stageLabel(d.dealstage), closedWon: d.hs_is_closed_won === "true", booked, program: PROGRAM_SOLD[String(d.type_of_program_sold || "").trim()] || "",
      soldOn: d.closedate ? dayET(d.closedate) : null
    } };
  } catch (e) { return { ok: false, message: `Couldn't read the deal from HubSpot: ${(e as Error).message}` }; }
}
