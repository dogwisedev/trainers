"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Check, ChevronRight } from "lucide-react";
import { approveAction, approveManyAction, buildDraftsAction } from "@/app/payroll-actions";
import { money } from "@/lib/payroll";
import { lineClient, lineLead, lineProgram } from "@/lib/payslipDoc";
import type { Line } from "@/lib/payrollData";

export type BoardSlip = { id: string; name: string; status: "draft" | "approved"; total: number; notes: string | null; sent_at: string | null; send_error: string | null; missing: number; lines: Line[] };
type Filter = "pending" | "approved" | "all";

export function PayslipBoard({ slips: initial, submit, label, paid, demo }: { slips: BoardSlip[]; submit: string; label: string; paid: string; demo: boolean }) {
  const [slips, setSlips] = useState(initial);
  const [filter, setFilter] = useState<Filter>(initial.some((s) => s.status === "draft") ? "pending" : "all");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [armed, setArmed] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  const counts = { pending: slips.filter((s) => s.status === "draft").length, approved: slips.filter((s) => s.status === "approved").length, all: slips.length };
  const shown = useMemo(() => slips.filter((s) => filter === "all" || (filter === "pending" ? s.status === "draft" : s.status === "approved")), [slips, filter]);
  const ready = slips.filter((s) => s.status === "draft" && !s.missing);
  const total = slips.reduce((n, s) => n + Number(s.total || 0), 0);

  const mark = (id: string, ok: boolean, error?: string) =>
    setSlips((cur) => cur.map((s) => (s.id === id ? (ok ? { ...s, status: "approved", sent_at: new Date().toISOString(), send_error: null } : error?.startsWith("Approved") ? { ...s, status: "approved", send_error: error } : s) : s)));

  const approveOne = (s: BoardSlip) => {
    if (armed !== s.id) { setArmed(s.id); setTimeout(() => setArmed((a) => (a === s.id ? null : a)), 4000); return; }
    setArmed(null); setBusy((b) => ({ ...b, [s.id]: true }));
    start(async () => {
      const r = await approveAction(s.id);
      mark(s.id, r.ok, r.message);
      setMsg(r.ok ? null : r);
      setBusy((b) => ({ ...b, [s.id]: false }));
    });
  };
  const approveAll = () => {
    if (!ready.length || !window.confirm(`Approve and email ${ready.length} payslips (${money(ready.reduce((n, s) => n + Number(s.total), 0))})?`)) return;
    start(async () => {
      const r = await approveManyAction(ready.map((s) => s.id));
      Object.entries(r.results).forEach(([id, x]) => mark(id, x.ok, x.message));
      setMsg(r);
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[19px] font-extrabold">{label}</p>
          <p className="text-[13px] text-ink-soft">Paid Fri {paid}. {money(total)} across {slips.length} trainers.</p>
        </div>
        <Link href="/a/payroll" className="text-[14px] font-semibold underline">Past pay runs</Link>
      </div>

      {slips.length > 0 && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper" aria-label={`${counts.approved} of ${counts.all} approved`}>
          <div className="h-full rounded-full bg-fern transition-all" style={{ width: `${(counts.approved / Math.max(1, counts.all)) * 100}%` }} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(["pending", "approved", "all"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${filter === f ? "bg-ink text-white" : "border border-line bg-white"}`}>
            {f === "pending" ? "Pending" : f === "approved" ? "Approved" : "All"} <span className="opacity-70">{counts[f]}</span>
          </button>
        ))}
        {ready.length > 1 && filter !== "approved" && (
          <button onClick={approveAll} disabled={pending || demo} className="btn-ink ml-auto h-9 min-h-0 px-3 text-[13px]"><Check size={15} />Approve all pending ({ready.length})</button>
        )}
      </div>
      {msg && <p role="status" className={`mt-3 rounded-xl px-3 py-2 text-[14px] ${msg.ok ? "bg-mint-wash text-fern" : "bg-heart-wash text-heart"}`}>{msg.message}</p>}
      {demo && <p className="mt-3 rounded-xl bg-biscuit-wash px-3 py-2 text-[13px] text-[#8A5A00]">Demo: example rates, approving is switched off.</p>}

      {!slips.length && (
        <div className="mt-4 rounded-[22px] border border-dashed border-line bg-white/60 p-6 text-center">
          <p className="font-semibold">No payslips for this run yet.</p>
          <p className="mt-1 text-[14px] text-ink-soft">They build themselves on pay Mondays, or build them now.</p>
          <button className="btn-mint mt-4" disabled={pending} onClick={() => start(async () => { const r = await buildDraftsAction(submit); setMsg(r); if (r.ok) location.reload(); })}>Build drafts now</button>
        </div>
      )}

      <ul className="mt-4 grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((s) => {
          const tone = s.status === "approved" ? (s.send_error ? "border-heart/40 bg-heart-wash" : "border-mint-deep bg-mint-wash") : "border-biscuit bg-biscuit-wash/50";
          const visible = s.lines.slice(0, 4);
          return (
            <li key={s.id} className={`rounded-[18px] border p-3.5 ${tone}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="truncate font-bold">{s.name}</p>
                <p className="shrink-0 text-[17px] font-extrabold">{money(s.total)}</p>
              </div>
              <ul className="mt-2 space-y-1 text-[13px]">
                {visible.map((l, i) => (
                  <li key={i} className={`flex justify-between gap-2 ${l.kind === "deduction" ? "text-heart" : ""}`}>
                    <span className="min-w-0 truncate">
                      <span className="font-semibold">{l.kind === "deduction" || l.kind === "other" ? lineClient(l) : l.dog || lineClient(l)}</span>
                      {l.kind !== "deduction" && l.kind !== "other" && <span className="text-ink-soft"> {[l.dog ? lineClient(l) : "", typeof lineLead(l) === "number" ? `${lineLead(l)} wk of ${lineProgram(l)}` : [lineLead(l), lineProgram(l)].filter(Boolean).join(", ")].filter(Boolean).join(", ")}</span>}
                      {l.kind === "deduction" && l.pct != null && <span> ({l.pct}%)</span>}
                    </span>
                    <span className="shrink-0 tabular-nums">{money(l.amount)}</span>
                  </li>
                ))}
                {s.lines.length > visible.length && <li className="text-ink-faint">+{s.lines.length - visible.length} more</li>}
                {!s.lines.length && <li className="text-ink-faint">No lines</li>}
              </ul>
              {s.notes && <p className="mt-2 line-clamp-2 text-[12px] italic text-ink-soft">{s.notes}</p>}
              {s.missing > 0 && <p className="mt-2 text-[12px] font-semibold text-heart">{s.missing} line{s.missing > 1 ? "s" : ""} without a pay rate</p>}
              <div className="mt-3 flex items-center gap-2">
                {s.status === "approved" ? (
                  <span className={`text-[13px] font-semibold ${s.send_error ? "text-heart" : "text-fern"}`}>{s.send_error ? "Approved, email failed" : `Approved and sent${s.sent_at ? ` ${new Date(s.sent_at).toLocaleDateString("en-US")}` : ""}`}</span>
                ) : (
                  <button onClick={() => approveOne(s)} disabled={busy[s.id] || !!s.missing || demo}
                    className={`btn h-9 min-h-0 px-3 text-[13px] ${armed === s.id ? "bg-fern text-white" : "bg-ink text-white"}`}>
                    <Check size={15} />{busy[s.id] ? "Sending…" : armed === s.id ? `Send to ${s.name.replace(/".*?"\s*/, "").split(" ")[0]}?` : "Approve"}
                  </button>
                )}
                {s.status === "approved" && <Link href={`/a/payroll/${s.id}?edit=1`} className="ml-auto text-[13px] font-semibold text-ink underline">Edit</Link>}
                <Link href={`/a/payroll/${s.id}`} className={`${s.status === "approved" ? "" : "ml-auto "}inline-flex items-center text-[13px] font-semibold text-ink-soft hover:text-ink`}>Open<ChevronRight size={15} /></Link>
              </div>
            </li>
          );
        })}
      </ul>
      {slips.length > 0 && !shown.length && <p className="mt-4 text-[14px] text-ink-soft">{filter === "pending" ? "All approved. Nothing left to do for this run." : "None yet."}</p>}
    </div>
  );
}
