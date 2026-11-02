"use client";
import { useEffect, useRef, useState } from "react";
import { Banknote, BriefcaseBusiness, Camera, ClipboardCheck, Filter, MessageCircle, MessagesSquare, PawPrint, Syringe, TriangleAlert, Users, Wallet } from "lucide-react";

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
const KEY = "dw-todo-types";

export function TodoTypes() {
  const [on, setOn] = useState<string[]>([]);   // empty = everything
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); if (Array.isArray(v)) setOn(v.filter((k) => TYPES.some((t) => t.key === k))); } catch { /* fine */ } }, []);
  useEffect(() => {
    const root = document.getElementById("todo-list"); if (!root) return;
    const show = new Set(on.length ? on : TYPES.map((t) => t.key));
    root.classList.toggle("todo-filtering", on.length > 0);
    for (const li of root.querySelectorAll<HTMLElement>("li[data-kind]")) li.style.display = show.has(li.dataset.kind || "") ? "" : "none";
    for (const sec of root.querySelectorAll<HTMLElement>("section[data-group]")) sec.style.display = [...sec.querySelectorAll<HTMLElement>("li[data-kind]")].some((li) => li.style.display !== "none") ? "" : "none";
    try { localStorage.setItem(KEY, JSON.stringify(on)); } catch { /* fine */ }
  }, [on]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away); return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const toggle = (k: string) => setOn((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const label = on.length ? (on.length <= 2 ? TYPES.filter((t) => on.includes(t.key)).map((t) => t.label).join(", ") : `${on.length} types`) : "All types";
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} aria-haspopup="true" className={`chip ${on.length ? "border-ink bg-ink text-white" : ""}`}>
        <Filter size={14} /><span className="max-w-[12rem] truncate">{label}</span>
      </button>
      {open && (
        <div role="group" aria-label="Types to show" className="absolute left-0 top-full z-20 mt-1 w-72 rounded-2xl border border-line bg-white p-2 shadow-card">
          {TYPES.map(({ key, label, Icon }) => (
            <label key={key} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-body hover:bg-paper">
              <input type="checkbox" checked={on.includes(key)} onChange={() => toggle(key)} className="h-4 w-4 accent-[rgb(var(--ink-bg))]" />
              <Icon size={16} className="text-ink-soft" />{label}
            </label>
          ))}
          <button type="button" onClick={() => { setOn([]); setOpen(false); }} className="mt-1 w-full rounded-xl px-2.5 py-2 text-left text-small font-semibold text-ink-soft hover:bg-paper">Show everything</button>
        </div>
      )}
    </div>
  );
}
