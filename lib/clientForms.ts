import "server-only";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { contactDeals, contactsMissing, hubspotConfigured, readContacts, updateContact, updateContacts } from "./hubspot";
import { Answers, CLIENT_KEYS, CONTACT_PROPS, DOG_KEYS, DOG_NAME_PROPS } from "./pretrainingFields";
import { fieldDefs, saveAnswers } from "./pretraining";
import type { Profile } from "./pretraining";

// The client's personal "Before training" link, one per HubSpot contact: /f/<contact id>-<signature>.
// No login and no email to type: answers go straight onto that contact (household + dog 1, the same properties the old
// HubSpot forms filled), so a second contact can't be made by mistake. Dogs 2+ are kept in the app by name until they're
// booked; then each booking picks up its dog's answers. Once a deal is booked, saves go through the same path as the
// in-app checklist. The link is written onto every contact as dogwise_forms_link for templates ({{ contact.dogwise_forms_link }}).

const key = () => process.env.MEDIA_SIGNING_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "dogwise-dev-key";
const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const sig = (id: string) => crypto.createHmac("sha256", key()).update(`forms:${id}`).digest("base64url").slice(0, 24);
export const formsLink = (contactId: string) => `${site()}/f/${contactId}-${sig(contactId)}`;
export function contactFromToken(token: string): string | null {
  const m = /^(\d+)-([\w-]{24})$/.exec(String(token || ""));
  if (!m) return null;
  const a = Buffer.from(m[2]), b = Buffer.from(sig(m[1]));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? m[1] : null;
}

export const nameKey = (n: unknown) => String(n ?? "").replace(/\s+/g, " ").trim().toLowerCase();
/** "Spot, Tuffy, and Zeus" → ["Spot", "Tuffy", "Zeus"] (up to 4). */
export const splitNames = (s: unknown) => String(s ?? "").split(/\s*(?:,|&|\+|\/|\n|\band\b)\s*/i).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4);
const pick = (o: Record<string, unknown> | undefined, keys: string[]) => Object.fromEntries(keys.map((k) => [k, String(o?.[k] ?? "")])) as Answers;

export type FormDog = { key: string; name: string; answers: Answers; bookingId: string | null; dogOne: boolean };
export type ClientFormData = {
  contactId: string; name: string; email: string; client: Answers; dogs: FormDog[]; defs: Profile["defs"];
  dealId: string | null; booked: boolean; namesFrom: "deal" | "contact" | "client" | "none";
};

/** Everything the page needs, read fresh from HubSpot each time (so it follows dog 1/2/3 as sales fills them in). */
export async function loadForm(contactId: string, sb: SupabaseClient = serviceClient()): Promise<ClientFormData | null> {
  if (!hubspotConfigured()) return null;
  const contact = (await readContacts([contactId], [...CONTACT_PROPS, "k9___dog_name"])).get(contactId);
  if (!contact) return null;
  const deals = await contactDeals(contactId, [...DOG_NAME_PROPS]).catch(() => []);
  const live = deals.filter((d) => !(d.properties.hs_is_closed === "true" && d.properties.hs_is_closed_won !== "true")); // not Closed Lost
  // The deal booked in the app wins; otherwise the newest live one
  const ids = live.map((d) => d.id);
  const { data: bks } = ids.length ? await sb.from("bookings").select("id, hubspot_deal_id, dog_name, status, end_date").in("hubspot_deal_id", ids).neq("status", "cancelled") : { data: [] };
  const bookings = (bks || []) as { id: string; hubspot_deal_id: string; dog_name: string | null; status: string; end_date: string }[];
  const deal = live.find((d) => bookings.some((b) => b.hubspot_deal_id === d.id)) || live[0] || null;
  const myBookings = deal ? bookings.filter((b) => b.hubspot_deal_id === deal.id) : [];
  const [{ data: fc }, { data: fdogs }, { data: pdogs }, defs] = await Promise.all([
    sb.from("form_contacts").select("*").eq("contact_id", contactId).maybeSingle(),
    sb.from("form_dogs").select("*").eq("contact_id", contactId),
    myBookings.length ? sb.from("pretraining_dogs").select("booking_id, slot, answers").in("booking_id", myBookings.map((b) => b.id)) : Promise.resolve({ data: [] }),
    fieldDefs()
  ]);
  // Dog names: the deal's dog 1/2/3/4, else the contact's "dog's name" (split), else what the client typed in
  const fromDeal = deal ? DOG_NAME_PROPS.map((p) => String(deal.properties[p] || "").trim()).filter(Boolean) : [];
  const fromContact = splitNames(contact.k9___dog_name);
  const fromClient = (Array.isArray(fc?.names) ? (fc!.names as string[]) : []).filter(Boolean);
  const names = fromDeal.length ? fromDeal : fromContact.length ? fromContact : fromClient;
  const namesFrom: ClientFormData["namesFrom"] = fromDeal.length ? "deal" : fromContact.length ? "contact" : fromClient.length ? "client" : "none";
  const saved = new Map(((fdogs || []) as { name_key: string; answers: Answers }[]).map((r) => [r.name_key, r.answers || {}]));
  const booked = myBookings.length > 0;
  // Before booking: if dog 1 changed since the client last answered, its answers follow the dog (see alignDogOne)
  if (!booked && names[0]) await alignDogOne(sb, contactId, names[0], contact, (fc?.dog1_key as string | null) ?? null, saved);
  const fresh = !booked && names[0] ? (await readContacts([contactId], DOG_KEYS)).get(contactId) || contact : contact;
  const pd = (pdogs || []) as { booking_id: string; slot: number; answers: Answers | null }[];
  const dogs: FormDog[] = names.map((name, i) => {
    const k = nameKey(name);
    const b = myBookings.find((x) => nameKey(x.dog_name) === k) || null;
    const slot = b ? pd.find((x) => x.booking_id === b.id)?.slot || null : null;
    const one = booked ? slot === 1 : i === 0;
    const answers = one ? pick(fresh, DOG_KEYS) : b && slot ? { ...pick({}, DOG_KEYS), ...(pd.find((x) => x.booking_id === b.id)?.answers || {}) } : { ...pick({}, DOG_KEYS), ...(saved.get(k) || {}) };
    return { key: k, name, answers, bookingId: b?.id || null, dogOne: one };
  });
  return {
    contactId, name: [contact.firstname, contact.lastname].filter(Boolean).join(" ") || "there", email: String(contact.email || ""),
    client: pick(contact, CLIENT_KEYS), dogs, defs, dealId: deal?.id || null, booked, namesFrom
  };
}

/** Dog 1's answers live on the HubSpot contact. If sales makes a different dog "dog 1" before booking, the answers follow
 *  the dogs: the old dog 1's are kept under its name, and the new dog 1's (if any) go onto the contact. */
async function alignDogOne(sb: SupabaseClient, contactId: string, dog1: string, contact: Record<string, unknown>, was: string | null, saved: Map<string, Answers>) {
  const now = nameKey(dog1);
  if (was === now) return;
  if (was) {
    const onContact = pick(contact, DOG_KEYS);
    if (Object.values(onContact).some(Boolean)) {
      await sb.from("form_dogs").upsert({ contact_id: contactId, name_key: was, name: was, answers: { ...(saved.get(was) || {}), ...onContact }, updated_at: new Date().toISOString() });
      saved.set(was, { ...(saved.get(was) || {}), ...onContact });
    }
    const next = saved.get(now) || {};
    // Clear the old dog's answers off the contact and put the new dog 1's there (blank if it has none yet)
    await updateContact(contactId, Object.fromEntries(DOG_KEYS.map((k) => [k, String(next[k] ?? "")])));
  }
  await sb.from("form_contacts").upsert({ contact_id: contactId, dog1_key: now, updated_at: new Date().toISOString() });
}

/** Saves one section: household answers (dogKey null) or one dog's. */
export async function saveForm(contactId: string, dogKey: string | null, values: Record<string, string>, sb: SupabaseClient = serviceClient()): Promise<{ ok: boolean; message: string }> {
  const allowed = dogKey ? DOG_KEYS : CLIENT_KEYS;
  const clean = Object.fromEntries(Object.entries(values).filter(([k]) => allowed.includes(k)).map(([k, v]) => [k, String(v ?? "").trim().slice(0, 5000)]));
  if (!Object.keys(clean).length) return { ok: true, message: "Nothing to save." };
  const f = await loadForm(contactId, sb);
  if (!f) return { ok: false, message: "We couldn't load your details just now. Try again in a minute." };
  const who = { name: f.name, role: "client" as const };
  const dog = dogKey ? f.dogs.find((d) => d.key === dogKey) : null;
  if (dogKey && !dog) return { ok: false, message: "We couldn't find that dog. Reload the page and try again." };
  // Booked in the app: the same path as the in-app checklist (it keeps the app and HubSpot in step)
  // (household answers can go through any of the deal's bookings; a dog's only through its own booking)
  const viaBooking = f.booked ? (dog ? dog.bookingId : f.dogs.find((d) => d.bookingId)?.bookingId || null) : null;
  if (f.dealId && viaBooking) return saveAnswers(f.dealId, viaBooking, clean, who);
  try {
    if (!dog || dog.dogOne) await updateContact(contactId, clean);       // household, or dog 1: onto the contact
    if (dog) {                                                            // every dog's answers are also kept by name
      const { data: row } = await sb.from("form_dogs").select("answers").eq("contact_id", contactId).eq("name_key", dog.key).maybeSingle();
      await sb.from("form_dogs").upsert({ contact_id: contactId, name_key: dog.key, name: dog.name, answers: { ...((row?.answers as Answers) || {}), ...clean }, updated_at: new Date().toISOString() });
      if (dog.dogOne) await sb.from("form_contacts").upsert({ contact_id: contactId, dog1_key: dog.key, updated_at: new Date().toISOString() });
    }
    return { ok: true, message: "Saved." };
  } catch (e) { return { ok: false, message: `That didn't save: ${(e as Error).message}` }; }
}

/** When HubSpot doesn't have the dogs' names yet, the client types them in (up to 4). */
export async function setFormDogs(contactId: string, names: string[], sb: SupabaseClient = serviceClient()) {
  const list = names.map((n) => n.replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean).slice(0, 4);
  if (!list.length) return { ok: false, message: "Type your dog's name." };
  await sb.from("form_contacts").upsert({ contact_id: contactId, names: list, updated_at: new Date().toISOString() });
  return { ok: true, message: "Saved." };
}

/** Answers a dog gave on the form before it was booked (for the booking's own record). */
export async function formAnswersFor(sb: SupabaseClient, contactId: string, names: (string | null | undefined)[]): Promise<Answers | null> {
  const keys = [...new Set(names.map(nameKey).filter(Boolean))];
  if (!keys.length) return null;
  const { data } = await sb.from("form_dogs").select("answers").eq("contact_id", contactId).in("name_key", keys).limit(1);
  const a = ((data || [])[0]?.answers || null) as Answers | null;
  return a && Object.values(a).some(Boolean) ? a : null;
}

/** Every 30 minutes: new contacts (and the last 90 days, the first time) get their link written onto them. */
export async function writeFormLinks(sb: SupabaseClient = serviceClient()) {
  const out = { written: 0, errors: [] as string[] };
  if (!hubspotConfigured()) return out;
  try {
    const { data: st } = await sb.from("app_state").select("value").eq("key", "forms_links_since").maybeSingle();
    const since = st?.value ? Date.parse(String(st.value)) - 3600e3 : Date.now() - 90 * 86400e3;
    const ids = await contactsMissing("dogwise_forms_link", since, 500);
    if (ids.length) await updateContacts(ids.map((id) => ({ id, properties: { dogwise_forms_link: formsLink(id) } })));
    out.written = ids.length;
    if (ids.length < 500) await sb.from("app_state").upsert({ key: "forms_links_since", value: new Date().toISOString(), updated_at: new Date().toISOString() });
  } catch (e) { out.errors.push((e as Error).message); }
  return out;
}
