import "server-only";
import { pulse, PRESETS, snapshotCached, type Pulse, type View } from "./pulse";

// Pulse (the dashboard at /a/pulse) for the Claude connector: the same figures the page shows, worked out from the
// same snapshot (the last 90 days, kept for an hour, so a call is quick unless the snapshot has to be taken again),
// as JSON. Links into the app are made absolute. lib/pulse.ts is used as it is: nothing here changes a figure.

export const PULSE_VIEWS: View[] = ["office", "trainers", "sales"];
export const PULSE_RANGES = PRESETS.map((p) => p.key);

/** The connector offers Pulse unless PULSE_CONNECTOR is "off" in Vercel. */
export const pulseOnConnector = () => (process.env.PULSE_CONNECTOR || "").trim().toLowerCase() !== "off";

/** Every relative app link in a value (keys href and to), made absolute. */
function absolute<T>(x: T, link: (path: string) => string): T {
  if (Array.isArray(x)) return x.map((v) => absolute(v, link)) as T;
  if (x && typeof x === "object") {
    return Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, v]) =>
      [k, (k === "href" || k === "to") && typeof v === "string" && v.startsWith("/") ? link(v) : absolute(v, link)])) as T;
  }
  return x;
}

/** Long lists are cut to keep the answer small. */
const most = <T,>(xs: T[], n: number) => xs.slice(0, n);

export async function pulseForClaude(o: { range: string; views: View[]; link: (path: string) => string }) {
  const snap = await snapshotCached();
  const got = new Map<View, Pulse>();
  for (const v of o.views) got.set(v, await pulse({ r: o.range, v }, snap));
  const any = got.values().next().value as Pulse;
  const r = any.range, office = got.get("office"), trainers = got.get("trainers"), sales = got.get("sales");
  const out = {
    snapshotAt: snap.builtAt,
    range: { key: r.key, label: r.label, from: r.from, to: r.to, days: r.days, comparedWith: { from: r.prevFrom, to: r.prevTo } },
    href: "/a/pulse",
    dataPoints: snap.points,
    notes: [...new Set([...got.values()].flatMap((p) => p.notes))],
    tiles: any.tiles,
    office: office?.office ? {
      cards: office.cards, ...office.office,
      moves: most(office.office.moves, 60), movesTotal: office.office.moves.length,
      cancellations: most(office.office.cancellations, 40), incidents: most(office.office.incidents, 40)
    } : undefined,
    trainers: trainers ? { cards: trainers.cards, rows: trainers.trainers.map((t) => ({ ...t, href: `/a/trainers/${t.id}` })) } : undefined,
    sales: sales ? (sales.sales ? { cards: sales.cards, ...sales.sales } : { cards: sales.cards, unavailable: sales.notes.find((n) => /HubSpot/.test(n)) || "Sales needs HubSpot." }) : undefined
  };
  return absolute(out, o.link);
}
