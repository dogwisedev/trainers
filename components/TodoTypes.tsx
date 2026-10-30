"use client";
import { useEffect, useRef, useState } from "react";
import { Filter } from "lucide-react";

// "Types" on To do: show only some kinds of item (chats, forms, dogs…). A dropdown with checkboxes, remembered on this device.
// It works on the rendered list: each row carries data-kind, and hidden kinds get the hidden attribute. Groups with nothing
// left to show are hidden too, and the counts in the headers are hidden while a filter is on (they count everything).
const TYPES: { key: string; label: string; kinds: string[] }[] = [
  { key: "chats", label: "Chats", kinds: ["chat", "message"] },
  { key: "forms", label: "Forms and photos", kinds: ["form", "camera"] },
  { key: "dogs", label: "Dogs, starts and vaccines", kinds: ["dog", "vaccine"] },
  { key: "deals", label: "Deals and money", kinds: ["deal", "money"] },
  { key: "pay", label: "Pay", kinds: ["pay"] },
  { key: "people", label: "Trainers and incidents", kinds: ["people", "alert"] }
];
const KEY = "dw-todo-types";

export function TodoTypes() {
  const [on, setOn] = useState<string[]>([]);   // empty = everything
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); if (Array.isArray(v)) setOn(v.filter((k) => TYPES.some((t) => t.key === k))); } catch { /* fine */ } }, []);
  useEffect(() => {
    const root = document.getElementById("todo-list"); if (!root) return;
    const show = new Set(on.length ? TYPES.filter((t) => on.includes(t.key)).flatMap((t) => t.kinds) : TYPES.flatMap((t) => t.kinds));
    root.classList.toggle("todo-filtering", on.length > 0);
    for (const li of root.querySelectorAll<HTMLElement>("li[data-kind]")) li.hidden = !show.has(li.dataset.kind || "");
    for (const sec of root.querySelectorAll<HTMLElement>("section[data-group]")) sec.hidden = !sec.querySelector("li[data-kind]:not([hidden])");
    try { localStorage.setItem(KEY, JSON.stringify(on)); } catch { /* fine */ }
  }, [on]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away); return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const toggle = (k: string) => setOn((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const label = on.length ? TYPES.filter((t) => on.includes(t.key)).map((t) => t.label).join(", ") : "All types";
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} aria-haspopup="true" className={`chip ${on.length ? "border-ink bg-ink text-white" : ""}`}>
        <Filter size={14} /><span className="max-w-[12rem] truncate">{label}</span>
      </button>
      {open && (
        <div role="group" aria-label="Types to show" className="absolute left-0 top-full z-20 mt-1 w-64 rounded-2xl border border-line bg-white p-2 shadow-card">
          {TYPES.map((t) => (
            <label key={t.key} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-body hover:bg-paper">
              <input type="checkbox" checked={on.includes(t.key)} onChange={() => toggle(t.key)} className="h-4 w-4 accent-[rgb(var(--ink-bg))]" />{t.label}
            </label>
          ))}
          <button type="button" onClick={() => { setOn([]); setOpen(false); }} className="mt-1 w-full rounded-xl px-2.5 py-2 text-left text-small font-semibold text-ink-soft hover:bg-paper">Show everything</button>
        </div>
      )}
    </div>
  );
}
