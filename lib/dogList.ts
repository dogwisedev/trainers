import "server-only";
import { listTrainers } from "./data";
import { bookingHistory, type HistoryRow, type Tab } from "./history";
import { readinessFor } from "./pretraining";
import { type DogFilter, activeCount, matches, needsReadiness } from "./dogFilters";
import { todayIso } from "./dates";

// The Dogs list as shown (and as exported): tab + trainer + POC + search + the stacked filters. One function, so the
// page and the CSV can never disagree.
export async function dogList(o: { tab: Tab; q: string; t: string; poc: string; f: DogFilter; limit?: number }) {
  const trainers = await listTrainers({ includeInactive: true });
  const pocIds = o.poc ? trainers.filter((x) => String(x.poc || "").trim().toLowerCase() === o.poc.toLowerCase()).map((x) => x.id) : undefined;
  const filtering = activeCount(o.f) > 0, show = o.limit || 150;
  // Dates go to the database; the rest is checked here, so read more rows when filtering
  const { rows, more } = await bookingHistory({ tab: o.tab, q: o.q, trainerId: o.t || undefined, trainerIds: pocIds, admin: true, limit: filtering ? 800 : show,
    startFrom: o.f.sf, startTo: o.f.st, endFrom: o.f.ef, endTo: o.f.et });
  const ready = o.tab === "now" || o.tab === "upcoming" || needsReadiness(o.f) ? await readinessFor(rows.map((r) => r.id)).catch(() => new Map()) : new Map();
  const today = todayIso();
  const kept: HistoryRow[] = filtering ? rows.filter((r) => matches(r, o.f, ready.get(r.id)?.ready, today)) : rows;
  return { trainers, rows: kept.slice(0, show), total: kept.length, more: filtering ? kept.length > show || more : more, ready };
}
