"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Bookmark, Plus, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { WINDOWS, type DogFilter, describe } from "@/lib/dogFilters";
import { deleteDogViewAction, saveDogViewAction } from "@/app/actions";

// Dogs: Search · Views · Filters. Filters work like HubSpot's: "+ Add filter", pick a field, set it; every condition is one
// row, and all of them must match. Views are named tab + filters, shared by the office: open one, save the current one,
// or remove one. Everything lives in the URL, so Export CSV gives exactly what's on screen.
type Opt = [string, string];
type Field = { key: string; label: string; kind: "select" | "date"; options?: Opt[] };
type Cond = { key: string; v: string; from?: string; to?: string };
type View = { id: string; name: string; query: string; mine: boolean };
type Props = { tab: string; q: string; t: string; p: string; f: DogFilter; trainers: Opt[]; pocs: string[]; states: string[]; programs: string[]; views: View[]; viewsEditable: boolean; total: number };

const ENUMS: Record<string, Opt[]> = {
  vac: [["missing", "are missing"], ["ok", "are OK"]], forms: [["missing", "are missing"], ["done", "are all done"]], bal: [["owed", "is owed"], ["paid", "is paid in full"]],
  pu: [["late", "isn't confirmed"]], rep: [["late", "are late or missing"]], ho: [["missing", "is missing"], ["in", "is in"]],
  fu: [["none", "none booked"], ["asked", "client asked"], ["booked", "booked"], ["done", "done"]]
};
const DATE_OPTS: Opt[] = [...WINDOWS, ["on", "On a date"], ["between", "Between dates"]];

function toConds(f: DogFilter, t: string, p: string): Cond[] {
  const c: Cond[] = [];
  if (t) c.push({ key: "trainer", v: t }); if (p) c.push({ key: "poc", v: p });
  const date = (key: string, w?: string, a?: string, b?: string) => { if (w) c.push({ key, v: w }); else if (a || b) c.push({ key, v: a && a === b ? "on" : "between", from: a, to: b }); };
  date("start", f.sw, f.sf, f.st); date("end", f.ew, f.ef, f.et);
  for (const k of ["vac", "forms", "bal", "pu", "rep", "ho", "fu", "state", "prog"] as const) if (f[k]) c.push({ key: k, v: String(f[k]) });
  return c;
}
export function toQuery(tab: string, q: string, conds: Cond[]): string {
  const u = new URLSearchParams({ f: tab }); if (q) u.set("q", q);
  for (const c of conds) {
    if (!c.v) continue;
    if (c.key === "trainer") u.set("t", c.v); else if (c.key === "poc") u.set("p", c.v);
    else if (c.key === "start" || c.key === "end") {
      const [w, a, b] = c.key === "start" ? ["sw", "sf", "st"] : ["ew", "ef", "et"];
      if (c.v === "on") { if (c.from) { u.set(a, c.from); u.set(b, c.from); } } else if (c.v === "between") { if (c.from) u.set(a, c.from); if (c.to) u.set(b, c.to); } else u.set(w, c.v);
    } else u.set(c.key, c.v);
  }
  return u.toString();
}

export function DogFilters(props: Props) {
  const { tab, q, t, p, f, trainers, pocs, states, programs, views, viewsEditable, total } = props;
  const router = useRouter();
  const fields: Field[] = [
    { key: "trainer", label: "Trainer", kind: "select", options: trainers }, { key: "poc", label: "Point of contact", kind: "select", options: pocs.map((x) => [x, x]) },
    { key: "start", label: "Start date", kind: "date" }, { key: "end", label: "End date (handover)", kind: "date" },
    { key: "vac", label: "Vaccines", kind: "select", options: ENUMS.vac }, { key: "forms", label: "Before-training forms", kind: "select", options: ENUMS.forms },
    { key: "bal", label: "Balance", kind: "select", options: ENUMS.bal }, { key: "pu", label: "Pickup", kind: "select", options: ENUMS.pu },
    { key: "rep", label: "Weekly reports", kind: "select", options: ENUMS.rep }, { key: "ho", label: "Handover report", kind: "select", options: ENUMS.ho },
    { key: "fu", label: "Follow-ups", kind: "select", options: ENUMS.fu },
    { key: "state", label: "Client's state", kind: "select", options: states.map((x) => [x, x]) }, { key: "prog", label: "Program", kind: "select", options: programs.map((x) => [x, x]) }
  ];
  const fieldOf = (k: string) => fields.find((x) => x.key === k)!;
  const current = toConds(f, t, p);
  const [open, setOpen] = useState<"" | "filters" | "views">("");
  const [conds, setConds] = useState<Cond[]>(current);
  const [text, setText] = useState(q);
  const go = (query: string) => { setOpen(""); router.push(`/a/dogs?${query}`); };
  const chips = [
    ...(t ? [{ key: "trainer", text: `Trainer: ${trainers.find(([id]) => id === t)?.[1] || "?"}` }] : []),
    ...(p ? [{ key: "poc", text: `POC: ${p}` }] : []),
    ...describe(f).map((c) => ({ key: c.key === "s" ? "start" : c.key === "e" ? "end" : c.key, text: c.text }))
  ];
  const drop = (key: string) => go(toQuery(tab, q, current.filter((c) => c.key !== key)));
  const here = toQuery(tab, q, current);
  return (
    <>
      <div className="mb-2 flex gap-2">
        <form className="relative min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); go(toQuery(tab, text.trim(), current)); }}>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search dog, client, email or deal" className="field h-11 pl-9" aria-label="Search" />
        </form>
        <button type="button" onClick={() => setOpen(open === "views" ? "" : "views")} className="btn-ghost h-11 min-h-0 shrink-0 px-3"><Bookmark size={16} /><span className="hidden sm:inline">Views</span></button>
        <button type="button" onClick={() => { setConds(current); setOpen("filters"); }} className={`h-11 min-h-0 shrink-0 px-3 ${chips.length ? "btn-ink" : "btn-ghost"}`}><SlidersHorizontal size={16} />Filters{chips.length ? ` · ${chips.length}` : ""}</button>
      </div>
      {open === "views" && <ViewsMenu views={views} editable={viewsEditable} here={here} onOpen={go} onClose={() => setOpen("")} />}
      {chips.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => <button key={c.key} type="button" onClick={() => drop(c.key)} className="inline-flex items-center gap-1 rounded-full bg-paper px-3 py-1 text-small font-semibold" aria-label={`Remove ${c.text}`}>{c.text}<X size={13} className="text-ink-faint" /></button>)}
          <button type="button" onClick={() => go(toQuery(tab, q, []))} className="px-1 text-small font-semibold text-ink-soft underline">Clear</button>
          <span className="ml-auto text-small text-ink-soft">{total} {total === 1 ? "dog" : "dogs"}</span>
        </div>
      )}
      {open === "filters" && (
        <Sheet title="Filters" onClose={() => setOpen("")} footer={<><button type="button" onClick={() => go(toQuery(tab, q, conds))} className="btn-ink flex-1">Show dogs</button><button type="button" onClick={() => setConds([])} className="btn-ghost">Clear</button></>}>
          {conds.length === 0 && <p className="text-small text-ink-soft">No filters: every dog in this tab. Add one below.</p>}
          <ul className="space-y-2">
            {conds.map((c, i) => {
              const fd = fieldOf(c.key), set = (patch: Partial<Cond>) => setConds((cur) => cur.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <li key={c.key} className="rounded-xl border border-line px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-28 shrink-0 text-small font-semibold sm:w-36">{fd.label}</span>
                    <select value={c.v} onChange={(e) => set({ v: e.target.value })} className="field-sm min-w-0 flex-1">
                      {(fd.kind === "date" ? DATE_OPTS : fd.options || []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <button type="button" onClick={() => setConds((cur) => cur.filter((_, j) => j !== i))} className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-paper" aria-label={`Remove ${fd.label}`}><X size={16} /></button>
                  </div>
                  {fd.kind === "date" && (c.v === "on" || c.v === "between") && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input type="date" value={c.from || ""} onChange={(e) => set({ from: e.target.value })} className="field-sm" aria-label="From" />
                      {c.v === "between" && <input type="date" value={c.to || ""} min={c.from} onChange={(e) => set({ to: e.target.value })} className="field-sm" aria-label="To" />}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {fields.some((fd) => !conds.some((c) => c.key === fd.key)) && (
            <label className="mt-2 flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-1.5">
              <Plus size={15} className="text-ink-soft" />
              <select value="" onChange={(e) => { const fd = fieldOf(e.target.value); if (fd) setConds((cur) => [...cur, { key: fd.key, v: fd.kind === "date" ? "weekend" : fd.options?.[0]?.[0] || "" }]); }} className="h-9 min-w-0 flex-1 bg-transparent text-input font-semibold text-ink focus:outline-none md:text-small" aria-label="Add filter">
                <option value="">Add filter…</option>
                {fields.filter((fd) => !conds.some((c) => c.key === fd.key)).map((fd) => <option key={fd.key} value={fd.key}>{fd.label}</option>)}
              </select>
            </label>
          )}
          <p className="mt-3 text-caption text-ink-faint">Every filter must match. &ldquo;This weekend&rdquo; is Thursday to Wednesday, like the HubSpot reports, and stays relative in a saved view.</p>
        </Sheet>
      )}
    </>
  );
}

function ViewsMenu({ views, editable, here, onOpen, onClose }: { views: View[]; editable: boolean; here: string; onOpen: (q: string) => void; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(""), [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); }; document.addEventListener("mousedown", away); return () => document.removeEventListener("mousedown", away); }, [onClose]);
  const same = (a: string, b: string) => [...new URLSearchParams(a)].map((x) => x.join("=")).sort().join("&") === [...new URLSearchParams(b)].map((x) => x.join("=")).sort().join("&");
  return (
    <div ref={box} className="mb-3 rounded-2xl border border-line bg-white p-2 shadow-card">
      <p className="px-2 pb-1 pt-1 text-caption font-bold uppercase tracking-wide text-ink-faint">Views</p>
      <ul className="max-h-[50vh] overflow-y-auto">
        {views.map((v) => (
          <li key={v.id} className="flex items-center gap-1">
            <button type="button" onClick={() => onOpen(v.query)} className={`min-w-0 flex-1 truncate rounded-xl px-3 py-2 text-left text-small ${same(v.query, here) ? "bg-paper font-bold" : "hover:bg-paper"}`}>{v.name}</button>
            {editable && v.mine && <button type="button" disabled={pending} onClick={() => { if (window.confirm(`Remove the view "${v.name}" for everyone?`)) start(async () => { await deleteDogViewAction(v.id); router.refresh(); }); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint hover:bg-paper hover:text-bad" aria-label={`Remove ${v.name}`}><Trash2 size={15} /></button>}
          </li>
        ))}
        {!views.length && <li className="px-3 py-2 text-small text-ink-soft">No views yet.</li>}
      </ul>
      {editable ? (
        <form className="mt-2 flex gap-2 border-t border-line px-1 pt-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveDogViewAction(name, here); setMsg(r.message); if (r.ok) { setName(""); router.refresh(); } }); }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Save what's on screen as…" className="field-sm min-w-0 flex-1" maxLength={60} />
          <button type="submit" disabled={pending || !name.trim()} className="btn-ink h-10 min-h-0 shrink-0 px-3">Save</button>
        </form>
      ) : <p className="mt-2 border-t border-line px-3 pt-2 text-caption text-ink-faint">Saving and removing views needs migration 047.</p>}
      {msg && <p className="px-3 pt-1 text-caption text-ink-soft">{msg}</p>}
    </div>
  );
}

function Sheet({ title, onClose, footer, children }: { title: string; onClose: () => void; footer: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/40 md:items-center md:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" className="flex max-h-[90vh] w-full flex-col rounded-t-[22px] bg-white shadow-card md:max-w-xl md:rounded-[22px]">
        <div className="flex items-center justify-between px-4 pt-4"><h2 className="text-lead font-extrabold">{title}</h2><button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full hover:bg-paper" aria-label="Close"><X size={18} /></button></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">{children}</div>
        <div className="flex shrink-0 gap-2 border-t border-line px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))]">{footer}</div>
      </div>
    </div>
  );
}
