import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { listTrainers, requireRole } from "@/lib/data";
import { TABS, Tab } from "@/lib/history";
import { Empty } from "@/components/ui";
import { StandbyList } from "@/components/StandbyList";
import { DogFilters } from "@/components/DogFilters";
import { FILTER_KEYS, parseFilter } from "@/lib/dogFilters";
import { DogRows } from "@/components/DogRows";
import { listDogViews } from "@/lib/dogViews";
import { propDefs, hubspotConfigured } from "@/lib/hubspot";
import { dogList } from "@/lib/dogList";
import { serverClient } from "@/lib/supabase";
import { todayIso } from "@/lib/dates";

const STATE_CODES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

// Admin: every dog. Tabs (In care / Upcoming / Finished / Cancelled / Standby), then Search · Views · Filters, then one card
// per dog that says in words what's going on. Export CSV gives exactly what's on screen.
export default async function Dogs({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireRole("admin");
  const today = todayIso();
  const standby = searchParams.f === "standby";
  const tab = (TABS.some((x) => x.key === searchParams.f) ? searchParams.f : "now") as Tab;
  const q = (searchParams.q || "").trim(), t = searchParams.t || "", poc = (searchParams.p || "").trim();
  const f = parseFilter(searchParams, today);
  const [list, views, programs] = await Promise.all([
    standby ? Promise.resolve(null) : dogList({ tab, q, t, poc, f }),
    listDogViews(),
    programList()
  ]);
  const trainers = list?.trainers || await listTrainers({ includeInactive: true });
  const rows = list?.rows || [], more = list?.more || false, ready = list?.ready || new Map();
  const pocs = [...new Map(trainers.map((x) => String(x.poc || "").trim()).filter(Boolean).map((x) => [x.toLowerCase(), x] as const)).values()].sort();
  // Before-training gaps only mean something before training
  const before = tab === "upcoming" ? Object.fromEntries([...ready.entries()].map(([id, x]) => [id, x.ready.missing.length])) : {};
  const keep = (k: Tab | "standby") => { const p = new URLSearchParams({ f: k }); if (t) p.set("t", t); if (q) p.set("q", q); if (poc) p.set("p", poc); if (k !== "standby") for (const key of FILTER_KEYS) { const v = searchParams[key]; if (v) p.set(key, v); } return p; };
  const filtered = !!(t || poc || q || FILTER_KEYS.some((k) => searchParams[k]));
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-extrabold">Dogs</h1>
        <span className="flex flex-wrap gap-2">
          {!standby && <a href={`/api/dogs/export?${keep(tab)}`} className="btn-ghost h-10 min-h-0 px-4"><Download size={16} />Export CSV</a>}
          <Link prefetch={false} href="/a/bookings/new" className="btn-ink h-10 min-h-0 px-4"><Plus size={17} />Book a dog</Link>
        </span>
      </div>
      <nav className="-mx-1 mb-3 mt-3 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Dogs">
        {[...TABS.map((x) => ({ key: x.key as Tab | "standby", label: x.label })), { key: "standby" as const, label: "Standby" }].map((x) => {
          const on = standby ? x.key === "standby" : x.key === tab;
          return <Link key={x.key} prefetch={false} href={`/a/dogs?${keep(x.key)}`} className={`shrink-0 rounded-full px-3.5 py-1.5 text-small font-semibold ${on ? "bg-ink text-white" : "border border-line bg-white"}`}>{x.label}</Link>;
        })}
      </nav>
      {!standby && <DogFilters tab={tab} q={q} t={t} p={poc} f={f} trainers={trainers.filter((x) => x.active).map((x) => [x.id, x.name] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]))} pocs={pocs}
        states={STATE_CODES} programs={programs} views={views.views} viewsEditable={views.editable} total={list?.total ?? rows.length} />}
      {standby ? <StandbyList q={q} /> : rows.length ? <DogRows rows={rows} tab={tab} today={today} before={before} /> : <Empty title={filtered ? "No dogs match." : "Nothing here."} />}
      {!standby && more && <p className="mt-3 text-center text-small text-ink-soft">Showing the first {rows.length}. Filter or search to narrow it down.</p>}
    </>
  );
}

/** The programs to filter by: HubSpot's Type of Program Sold (what sales picks), else the names in use, without the old "N-week" ones. */
async function programList(): Promise<string[]> {
  try {
    if (hubspotConfigured()) {
      const d = (await propDefs("deals")).get("type_of_program_sold");
      if (d?.options.length) return d.options.map((o) => o.label.trim()).filter(Boolean);
    }
  } catch { /* fall back */ }
  const { data } = await serverClient().from("bookings").select("program").not("program", "is", null).gte("end_date", "2026-01-01").limit(3000);
  return [...new Set(((data || []) as { program: string }[]).map((r) => r.program.trim()).filter((x) => x && !/^\d+-week$/i.test(x)))].sort();
}
