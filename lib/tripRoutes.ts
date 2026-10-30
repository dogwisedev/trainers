import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { addDays, todayIso } from "./dates";
import { dealContacts, hubspotConfigured, readContacts } from "./hubspot";
import { EMPTY_RATES, Rates } from "./payroll";
import { GeoFeature, Place, ROAD_FACTOR, clientPlace, googleUrl, haversine, mileCheck, pickResult, trainerPlace } from "./mileageCheck";

// Mileage check, the network side. For each booking (and its trainer) with a trip in the last 60 days:
//  1. Where from: the trainer's profile address, found with FreeRoute (only if the result is in the same ZIP);
//     else the trainer's map point on their profile; else the centre of their ZIP.
//  2. Where to: the client's pickup address (or home address), found the same way; else the centre of their ZIP.
//  3. The driving route between them with FreeRoute. If FreeRoute errors or doesn't answer in time, a straight-line
//     estimate × 1.25 for roads, marked "estimate" (and tried again later).
// Kept in trip_routes, one row per booking and trainer, and only worked out again when an address changes.
// Runs with the 20-minute forms job (a few bookings at a time) and from "Check routes now" on a payslip.

const BASE = "https://api.maps.freeroute.org";
const key = () => process.env.FREEROUTE_API_KEY || "";
export const freerouteOn = () => !!key();
const M_PER_MI = 1609.344;
const GAP_MS = 1100; // FreeRoute allows 60 requests a minute
const RETRY_ESTIMATE_H = 6;

type Pt = { lat: number; lon: number; label: string; source: "address" | "profile" | "zip" };
type TrainerRow = { id: string; name: string; address: string | null; city: string | null; state: string | null; zip: string | null; lat: number | null; lon: number | null };
type BookingRow = { id: string; trainer_id: string; hubspot_deal_id: string | null; client_name: string; dog_name: string | null };
export type RouteRow = {
  booking_id: string; trainer_id: string; input_key: string; one_way_miles: number | null; method: "route" | "estimate" | null;
  from_label: string | null; to_label: string | null; from_source: string | null; to_source: string | null; google_url: string | null; note: string | null; checked_at: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function call(path: string, init: RequestInit = {}, ms = 15000): Promise<unknown> {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${BASE}${path}`, { ...init, signal: ctl.signal, headers: { "X-API-Key": key(), ...(init.body ? { "Content-Type": "application/json" } : {}) }, cache: "no-store" });
    if (!r.ok) throw new Error(`FreeRoute ${r.status}`);
    return await r.json();
  } catch (e) { throw new Error((e as Error).name === "AbortError" ? "FreeRoute didn't answer in time" : (e as Error).message); }
  finally { clearTimeout(t); }
}

/** An address, only if FreeRoute finds it in the right ZIP (or state). */
async function geocode(place: Place): Promise<{ lat: number; lon: number; label: string } | null> {
  if (!freerouteOn()) return null;
  try {
    const d = await call(`/v1/geocode/search?q=${encodeURIComponent(place.text)}&limit=5`) as { features?: GeoFeature[] };
    return pickResult(d.features, place);
  } catch { return null; }
}

/** The centre of a ZIP (free, no key: the same lookup the availability page uses). */
const zipCache = new Map<string, { lat: number; lon: number } | null>();
async function zipCentre(zip: string) {
  if (!/^\d{5}$/.test(zip)) return null;
  if (zipCache.has(zip)) return zipCache.get(zip)!;
  let out: { lat: number; lon: number } | null = null;
  try {
    const r = await fetch(`https://api.zippopotam.us/us/${zip}`, { next: { revalidate: 60 * 60 * 24 * 30 } });
    const p = r.ok ? (await r.json()).places?.[0] : null;
    out = p ? { lat: +p.latitude, lon: +p.longitude } : null;
  } catch { out = null; }
  zipCache.set(zip, out);
  return out;
}

/** Driving miles (one way) between two points, or null if FreeRoute can't say. */
async function routeMiles(a: Pt, b: Pt): Promise<number | null> {
  if (!freerouteOn()) return null;
  try {
    const d = await call(`/v1/directions/driving-car`, { method: "POST", body: JSON.stringify({ coordinates: [[a.lon, a.lat], [b.lon, b.lat]] }) }, 20000) as
      { features?: { properties?: { summary?: { distance?: number }; segments?: { distance?: number }[] } }[] };
    const p = d.features?.[0]?.properties;
    const m = p?.summary?.distance ?? (p?.segments || []).reduce((n, s) => n + (s.distance || 0), 0);
    return m > 0 ? Math.round((m / M_PER_MI) * 10) / 10 : null;
  } catch { return null; }
}

/** The trainer's start point, looked up once per address (a trainer has many bookings). */
const trainerCache = new Map<string, Pt | null>();
async function trainerPoint(t: TrainerRow): Promise<Pt | null> {
  const k = JSON.stringify([t.id, trainerPlace(t)?.text, t.lat, t.lon]);
  if (trainerCache.has(k)) return trainerCache.get(k)!;
  const p = await findTrainerPoint(t);
  if (p) trainerCache.set(k, p);
  return p;
}
async function findTrainerPoint(t: TrainerRow): Promise<Pt | null> {
  const place = trainerPlace(t);
  if (place && place.text.match(/\d/)) { const g = await geocode(place); if (g) return { ...g, label: place.text, source: "address" }; await sleep(GAP_MS); }
  if (t.lat != null && t.lon != null) return { lat: Number(t.lat), lon: Number(t.lon), label: place?.text || `${t.name}'s map point`, source: "profile" };
  const z = place ? await zipCentre(place.zip) : null;
  return z ? { ...z, label: `ZIP ${place!.zip} (centre)`, source: "zip" } : null;
}
async function clientPoint(place: Place): Promise<Pt | null> {
  const g = await geocode(place);
  if (g) return { ...g, label: place.text, source: "address" };
  const z = await zipCentre(place.zip);
  return z ? { ...z, label: `${place.text} (ZIP ${place.zip} centre: the address wasn't found)`, source: "zip" } : null;
}

/** What a check was worked out from: when this changes (an address was fixed), it's worked out again. */
const inputKey = (t: TrainerRow, place: Place | null) => JSON.stringify([trainerPlace(t)?.text || "", t.lat, t.lon, place?.text || ""]);
const googleFrom = (t: TrainerRow) => trainerPlace(t)?.text || (t.lat != null && t.lon != null ? `${t.lat},${t.lon}` : "");

/** Works out one booking's route and saves it. */
async function checkOne(sb: SupabaseClient, b: BookingRow, t: TrainerRow, contact: Record<string, unknown> | null): Promise<RouteRow> {
  const place = clientPlace(contact);
  const row: RouteRow = {
    booking_id: b.id, trainer_id: t.id, input_key: inputKey(t, place), one_way_miles: null, method: null, from_label: null, to_label: place?.text || null,
    from_source: null, to_source: null, google_url: place && googleFrom(t) ? googleUrl(googleFrom(t), place.text) : null, note: null, checked_at: new Date().toISOString()
  };
  if (!place) row.note = b.hubspot_deal_id ? "No client address in the app yet." : "No client address: this booking has no HubSpot deal.";
  else {
    const from = await trainerPoint(t);
    await sleep(GAP_MS);
    const to = await clientPoint(place);
    if (!from) row.note = `${t.name} has no address or map point on their profile.`;
    else if (!to) row.note = "The client's address couldn't be found, and it has no ZIP.";
    else {
      await sleep(GAP_MS);
      const miles = await routeMiles(from, to);
      Object.assign(row, { from_label: from.label, to_label: to.label, from_source: from.source, to_source: to.source });
      if (miles != null) Object.assign(row, { one_way_miles: miles, method: "route" });
      else Object.assign(row, { one_way_miles: Math.round(haversine(from, to) * ROAD_FACTOR * 10) / 10, method: "estimate",
        note: freerouteOn() ? "FreeRoute didn't answer: straight line + 25% for roads. It'll try again." : "Estimate (FreeRoute isn't set up): straight line + 25% for roads." });
    }
  }
  const { error } = await sb.from("trip_routes").upsert(row, { onConflict: "booking_id,trainer_id" });
  if (error) throw new Error(error.message);
  return row;
}

/** Client addresses for these deals: the copy the before-training sync keeps, else straight from HubSpot. */
async function contactsFor(sb: SupabaseClient, dealIds: string[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const ids = [...new Set(dealIds.filter((d) => /^\d+$/.test(d)))];
  if (!ids.length) return out;
  const { data } = await sb.from("pretraining_deals").select("deal_id, contact, pending").in("deal_id", ids);
  for (const r of (data || []) as { deal_id: string; contact: Record<string, unknown>; pending: Record<string, unknown> }[]) out.set(r.deal_id, { ...(r.contact || {}), ...(r.pending || {}) });
  const missing = ids.filter((id) => !clientPlace(out.get(id) || null));
  if (missing.length && hubspotConfigured()) {
    try {
      const of = await dealContacts(missing);
      const props = ["address", "city", "state", "zip", "is_the_pickup_address_the_same_as_the_address_provided_above", "if_no_please_provide_the_full_pickup_address"];
      const cs = await readContacts([...of.values()].flat(), props);
      for (const id of missing) for (const cid of of.get(id) || []) { const c = cs.get(cid); if (c && clientPlace(c)) { out.set(id, c); break; } }
    } catch { /* no HubSpot: those bookings say "no client address" */ }
  }
  return out;
}

/**
 * Checks routes for bookings with trips (last 60 days, or one trainer's dates), a few at a time within `budgetMs`.
 * Skips what's already checked with the same addresses; estimates are tried again after 6 hours. `force` redoes them all.
 */
export async function checkTripRoutes(o: { trainerId?: string; from?: string; to?: string; budgetMs?: number; limit?: number; force?: boolean } = {}, sb: SupabaseClient = serviceClient()) {
  const out = { checked: 0, waiting: 0, errors: [] as string[] };
  const started = Date.now(), budget = o.budgetMs ?? 25000, limit = o.limit ?? 8;
  let q = sb.from("trips").select("trainer_id, booking_id").not("booking_id", "is", null).gte("trip_date", o.from || addDays(todayIso(), -60));
  if (o.to) q = q.lte("trip_date", o.to);
  if (o.trainerId) q = q.eq("trainer_id", o.trainerId);
  const { data: trips, error } = await q;
  if (error) { out.errors.push(error.message); return out; }
  const pairs = [...new Map(((trips || []) as { trainer_id: string; booking_id: string }[]).map((x) => [`${x.booking_id}|${x.trainer_id}`, x])).values()];
  if (!pairs.length) return out;
  const [{ data: bks }, { data: trs }, { data: have, error: hErr }] = await Promise.all([
    sb.from("bookings").select("id, trainer_id, hubspot_deal_id, client_name, dog_name").in("id", [...new Set(pairs.map((p) => p.booking_id))]),
    sb.from("trainers").select("id, name, address, city, state, zip, lat, lon").in("id", [...new Set(pairs.map((p) => p.trainer_id))]),
    sb.from("trip_routes").select("*").in("booking_id", [...new Set(pairs.map((p) => p.booking_id))])
  ]);
  if (hErr) { out.errors.push(/trip_routes/.test(hErr.message) ? "Run migration 038 (trip_routes) in Supabase first." : hErr.message); return out; }
  const contacts = await contactsFor(sb, ((bks || []) as BookingRow[]).map((b) => b.hubspot_deal_id || ""));
  for (const p of pairs) {
    const b = ((bks || []) as BookingRow[]).find((x) => x.id === p.booking_id), t = ((trs || []) as TrainerRow[]).find((x) => x.id === p.trainer_id);
    if (!b || !t) continue;
    const contact = b.hubspot_deal_id ? contacts.get(b.hubspot_deal_id) || null : null;
    const old = ((have || []) as RouteRow[]).find((r) => r.booking_id === b.id && r.trainer_id === t.id);
    const fresh = old && old.input_key === inputKey(t, clientPlace(contact))
      && (old.method === "route" || Date.now() - new Date(old.checked_at).getTime() < RETRY_ESTIMATE_H * 3600e3);
    if (fresh && !o.force) continue;
    if (out.checked >= limit || Date.now() - started > budget) { out.waiting++; continue; }
    try { await checkOne(sb, b, t, contact); out.checked++; } catch (e) { out.errors.push(`${b.dog_name || b.id}: ${(e as Error).message}`); }
  }
  return out;
}

// ── For the payslip ──────────────────────────────────────────────────────────

export type MileageRow = {
  tripId: string; bookingId: string | null; kind: "pickup" | "dropoff" | "followup"; date: string; declared: number; dog: string; client: string;
  route: RouteRow | null; check: ReturnType<typeof mileCheck>;
};
async function ratesOf(sb: SupabaseClient, trainerIds: string[]): Promise<Map<string, Rates>> {
  const { data } = await sb.from("trainer_rates").select("*").in("trainer_id", trainerIds);
  return new Map(((data || []) as (Rates & { trainer_id: string })[]).map((r) => [r.trainer_id, { ...EMPTY_RATES, ...r }]));
}
async function tripsIn(sb: SupabaseClient, trainerIds: string[], start: string, end: string) {
  const { data } = await sb.from("trips").select("id, trainer_id, booking_id, kind, trip_date, miles, bookings(client_name, dog_name)").in("trainer_id", trainerIds).gte("trip_date", start).lte("trip_date", end).order("trip_date");
  return (data || []) as unknown as { id: string; trainer_id: string; booking_id: string | null; kind: MileageRow["kind"]; trip_date: string; miles: number; bookings: { client_name: string; dog_name: string | null } | null }[];
}
async function routesFor(sb: SupabaseClient, bookingIds: string[]) {
  if (!bookingIds.length) return [] as RouteRow[];
  const { data } = await sb.from("trip_routes").select("*").in("booking_id", bookingIds);
  return (data || []) as RouteRow[];
}

/** One trainer's trips in a pay period, each with its route and check. */
export async function mileageRows(trainerId: string, start: string, end: string, sb: SupabaseClient = serviceClient()): Promise<MileageRow[]> {
  const [trips, rates] = await Promise.all([tripsIn(sb, [trainerId], start, end), ratesOf(sb, [trainerId])]);
  const routes = await routesFor(sb, [...new Set(trips.map((t) => t.booking_id).filter((x): x is string => !!x))]);
  const r = rates.get(trainerId) || EMPTY_RATES;
  return trips.map((t) => {
    const route = routes.find((x) => x.booking_id === t.booking_id && x.trainer_id === t.trainer_id) || null;
    return { tripId: t.id, bookingId: t.booking_id, kind: t.kind, date: t.trip_date, declared: Number(t.miles), dog: t.bookings?.dog_name || "", client: t.bookings?.client_name || "",
      route, check: mileCheck(Number(t.miles), route?.one_way_miles == null ? null : Number(route.one_way_miles), Number(r.mileage_free_miles || 0), r.mileage_rate == null ? null : Number(r.mileage_rate)) };
  });
}

/** Per trainer: how many trips in the period need a look (over the route, or paid mileage). For the payslip cards. */
export async function mileageFlags(trainerIds: string[], start: string, end: string, sb: SupabaseClient = serviceClient()): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!trainerIds.length) return out;
  try {
    const [trips, rates] = await Promise.all([tripsIn(sb, trainerIds, start, end), ratesOf(sb, trainerIds)]);
    const routes = await routesFor(sb, [...new Set(trips.map((t) => t.booking_id).filter((x): x is string => !!x))]);
    for (const t of trips) {
      const r = rates.get(t.trainer_id) || EMPTY_RATES, route = routes.find((x) => x.booking_id === t.booking_id && x.trainer_id === t.trainer_id);
      const c = mileCheck(Number(t.miles), route?.one_way_miles == null ? null : Number(route.one_way_miles), Number(r.mileage_free_miles || 0), r.mileage_rate == null ? null : Number(r.mileage_rate));
      if (c.over || c.paid) out.set(t.trainer_id, (out.get(t.trainer_id) || 0) + 1);
    }
  } catch { /* no trips or routes table yet: no flags */ }
  return out;
}
