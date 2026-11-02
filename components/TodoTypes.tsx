"use client";
import { useEffect, useRef, useState } from "react";
import { Banknote, BriefcaseBusiness, Camera, ClipboardCheck, Filter, MessageCircle, MessagesSquare, PawPrint, Syringe, TriangleAlert, UserRound, Users, Wallet } from "lucide-react";

// "Types" on To do: one checkbox per icon kind (the icon on each row says what it's about). Remembered on this device.
// It works on the rendered list: each row carries data-kind; rows of hidden kinds get display:none (an attribute wouldn't
// beat the rows' flex class), groups with nothing left are hidden too, and header counts hide while a filter is on.
const TYPES: { key: string; label: string; Icon: typeof PawPrint }[] = [
  { key: "chat", label: "Chats", Icon: MessagesSquare }, { key: "message", label: "Messages from trainers", Icon: MessageCircle },
  { key: "form", label: "Forms", Icon: ClipboardCheck }, { key: "camera", label: "Photos and videos", Icon: Camera },
  { key: "dog", label: "Dogs and starts", Icon: PawPrint }, { key: "vaccine", label: "Vaccines", Icon: Syringe },
  { key: "deal", label: "HubSpot deals", Icon: BriefcaseBusiness }, { key: "money", label: "Money and dates", Icon: Banknote },
  { key: "pay", label: "Pay", Icon: Wallet }, { key: "people", label: "Trainers", Icon: Users }, { key: "alert", label: "Incidents and problems", Icon: TriangleAlert }
];
const KEY = "dw-todo-types", PKEY = "dw-todo-pocs", NONE = "__none";
const pkey = (p: string | undefined | null) => (p || "").trim().toLowerCase() || NONE;

/** The two To do filters: Types (one per icon) and POC (each trainer's Point of Contact). Each is remembered on this device. */
export function TodoTypes({ pocs = [] }: { pocs?: string[] }) {
  const [on, setOn] = useState<string[]>([]);    // types; empty = everything
  const [pon, setPon] = useState<string[]>([]);  // POC keys; empty = everyone
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); if (Array.isArray(v)) setOn(v.filter((k) => TYPES.some((t) => t.key === k))); } catch { /* fine */ }
    try { const v = JSON.parse(localStorage.getItem(PKEY) || "[]"); if (Array.isArray(v)) setPon(v.filter((k) => k === NONE || pocs.some((p) => pkey(p) === k))); } catch { /* fine */ }
  }, [pocs]);
  useEffect(() => {
    const root = document.getElementById("todo-list"); if (!root) return;
    const typeOk = (k: string) => !on.length || on.includes(k), pocOk = (k: string) => !pon.length || pon.includes(k || NONE);
    root.classList.toggle("todo-filtering", on.length > 0 || pon.length > 0);
    for (const li of root.querySelectorAll<HTMLElement>("li[data-kind]")) {
      let ok = typeOk(li.dataset.kind || "");
      if (li.hasAttribute("data-poc")) ok = ok && pocOk(li.dataset.poc || NONE);
      else { // a fold-out of forms: filter its rows by POC, and hide it if none are left
        const rows = [...li.querySelectorAll<HTMLElement>("li[data-poc]")];
        let any = !rows.length;
        for (const r of rows) { const show = pocOk(r.dataset.poc || NONE); r.style.display = show ? "" : "none"; if (show) any = true; }
        ok = ok && any;
      }
      li.style.display = ok ? "" : "none";
    }
    for (const sec of root.querySelectorAll<HTMLElement>("section[data-group]")) sec.style.display = [...sec.querySelectorAll<HTMLElement>("li[data-kind]")].some((li) => li.style.display !== "none") ? "" : "none";
    try { localStorage.setItem(KEY, JSON.stringify(on)); localStorage.setItem(PKEY, JSON.stringify(pon)); } catch { /* fine */ }
  }, [on, pon]);
  const typeLabel = on.length ? (on.length <= 2 ? TYPES.filter((t) => on.includes(t.key)).map((t) => t.label).join(", ") : `${on.length} types`) : "All types";
  const pocLabel = pon.length ? (pon.length <= 2 ? pon.map((k) => (k === NONE ? "No trainer" : pocs.find((p) => pkey(p) === k) || k)).join(", ") : `${pon.length} POCs`) : "All POCs";
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Menu label={typeLabel} active={on.length > 0} icon={<Filter size={14} />} onClear={() => setOn([])}>
        {TYPES.map(({ key, label, Icon }) => (
          <Check key={key} checked={on.includes(key)} onChange={() => setOn((cur) => (cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key]))}><Icon size={16} className="text-ink-soft" />{label}</Check>
        ))}
      </Menu>
      {pocs.length > 0 && (
        <Menu label={pocLabel} active={pon.length > 0} icon={<UserRound size={14} />} onClear={() => setPon([])}>
          {[...pocs.map((p) => ({ k: pkey(p), label: p })), { k: NONE, label: "No trainer (deals, pay, jobs)" }].map(({ k, label }) => (
            <Check key={k} checked={pon.includes(k)} onChange={() => setPon((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]))}>{label}</Check>
          ))}
        </Menu>
      )}
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return <label className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-body hover:bg-paper"><input type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 accent-[rgb(var(--ink-bg))]" />{children}</label>;
}

function Menu({ label, active, icon, onClear, children }: { label: string; active: boolean; icon: React.ReactNode; onClear: () => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away); return () => document.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} aria-haspopup="true" className={`chip ${active ? "border-ink bg-ink text-white" : ""}`}>{icon}<span className="max-w-[12rem] truncate">{label}</span></button>
      {open && (
        <div role="group" className="absolute left-0 top-full z-20 mt-1 max-h-[70vh] w-72 overflow-y-auto rounded-2xl border border-line bg-white p-2 shadow-card">
          {children}
          <button type="button" onClick={() => { onClear(); setOpen(false); }} className="mt-1 w-full rounded-xl px-2.5 py-2 text-left text-small font-semibold text-ink-soft hover:bg-paper">Show everything</button>
        </div>
      )}
    </div>
  );
}
