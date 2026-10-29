// Mileage check: the miles a trainer declares for a pickup, drop-off or follow-up, set against the driving route from the
// trainer's home to the client. Pure (no network, no database), so it's easy to test. The network side is lib/tripRoutes.ts.

/** Roads are longer than a straight line: used only when the route service can't answer (an estimate). */
export const ROAD_FACTOR = 1.25;
/** Declared miles count as "over the route" when they're more than 25% AND more than 15 miles over the round trip. */
export const OVER_SHARE = 1.25, OVER_MILES = 15;

const STATES: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut", DE: "delaware", DC: "district of columbia",
  FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine",
  MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada",
  NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon",
  PA: "pennsylvania", RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont", VA: "virginia",
  WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming"
};
/** "NY", "ny", "New York" → "new york" (or "" if it isn't a US state). */
export function stateName(s: unknown): string {
  const v = String(s ?? "").trim();
  if (!v) return "";
  const up = v.toUpperCase();
  if (STATES[up]) return STATES[up];
  const low = v.toLowerCase().replace(/\s+/g, " ");
  return Object.values(STATES).includes(low) ? low : "";
}
/** The last 5-digit ZIP in a piece of text ("… PA 18370", "18370-1234"). */
export function zipIn(text: unknown): string {
  const m = String(text ?? "").match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/s);
  return m ? m[1] : "";
}
const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const isNo = (v: unknown) => /^(no|false|n)$/i.test(clean(v));

export type Place = { text: string; zip: string; state: string };

/** Where the trainer drives to: the separate pickup address if the client gave one, otherwise their home address. */
export function clientPlace(c: Record<string, unknown> | null | undefined): Place | null {
  if (!c) return null;
  const pickup = clean(c.if_no_please_provide_the_full_pickup_address);
  if (isNo(c.is_the_pickup_address_the_same_as_the_address_provided_above) && pickup) {
    return { text: pickup, zip: zipIn(pickup), state: stateName(c.state) };
  }
  const zip = clean(c.zip).slice(0, 5);
  const text = [clean(c.address), clean(c.city), [clean(c.state), zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return text ? { text, zip: /^\d{5}$/.test(zip) ? zip : zipIn(text), state: stateName(c.state) } : null;
}

/** Where the trainer starts: their address on their profile. */
export function trainerPlace(t: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null }): Place | null {
  const zip = clean(t.zip).slice(0, 5);
  const text = [clean(t.address), clean(t.city), [clean(t.state), zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return text ? { text, zip: /^\d{5}$/.test(zip) ? zip : zipIn(text), state: stateName(t.state) } : null;
}

/**
 * The address search can return a same-name town in another state (Deer Park, NY → Deer Park, Texas), so a result only
 * counts when it's in the place's ZIP, or (no ZIP known) in its state. Returns the first result that passes.
 */
export type GeoFeature = { geometry?: { coordinates?: number[] }; properties?: { postcode?: string; state?: string; label?: string } };
export function pickResult(features: GeoFeature[] | undefined, place: Place): { lat: number; lon: number; label: string } | null {
  for (const f of features || []) {
    const [lon, lat] = f.geometry?.coordinates || [];
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const p = f.properties || {};
    const ok = place.zip ? String(p.postcode || "").slice(0, 5) === place.zip : !!place.state && stateName(p.state) === place.state;
    if (ok) return { lat, lon, label: String(p.label || place.text) };
  }
  return null;
}

/** Straight-line miles between two points. */
export function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 3958.8, r = Math.PI / 180, x = (b.lat - a.lat) * r, y = (b.lon - a.lon) * r;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(y / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Google Maps driving directions between two addresses (or "lat,lon"), for checking by hand. */
export const googleUrl = (from: string, to: string) =>
  `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&travelmode=driving`;

export type MileStatus = "over" | "paid" | "ok" | "unchecked";
/**
 * One trip: declared miles (round trip, as the forms ask) against the route (one way, doubled).
 *  over: more than 25% and 15 miles over the route  ·  paid: mileage is paid on it (over the trainer's free miles): check it
 *  ok: neither  ·  unchecked: no route yet
 */
export function mileCheck(declared: number, oneWay: number | null | undefined, freeMiles: number, rate: number | null | undefined) {
  const round = oneWay == null ? null : Math.round(oneWay * 2 * 10) / 10;
  const paid = rate != null && declared > (freeMiles || 0);
  const over = round != null && declared > round * OVER_SHARE && declared - round > OVER_MILES;
  const status: MileStatus = over ? "over" : paid ? "paid" : round == null ? "unchecked" : "ok";
  return { round, paid, over, overBy: round == null ? null : Math.round((declared - round) * 10) / 10, status };
}
