"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { approveAndSendAction, correctAndResendAction, EditLine, resendAction, savePayslipAction } from "@/app/payroll-actions";
import { Result } from "@/app/actions";
import { deductionAmount, money, Rates, sumLines } from "@/lib/payroll";
import { payslipHtml, SlipData } from "@/lib/payslipDoc";

type L = EditLine & { key: string };
type Opt = { id: string; client: string; dog: string };
const DEDUCTIONS = ["Deduction - missing weekly reports", "Deduction - late handover report"];
let seq = 0;
const k = () => `l${++seq}`;

export function PayslipEditor(props: {
  id: string; approved: boolean; initial: EditLine[]; adjustments: number; notes: string; rates: Rates; bookings: Opt[];
  doc: Omit<SlipData, "lines" | "subtotal" | "adjustments" | "total" | "notes">;
  status: { approvedBy?: string | null; approvedAt?: string | null; sentTo?: string | null; sentAt?: string | null; error?: string | null };
  startEditing?: boolean;
}) {
  const [lines, setLines] = useState<L[]>(props.initial.map((l) => ({ ...l, key: k() })));
  const [adj, setAdj] = useState(String(props.adjustments || 0));
  const [notes, setNotes] = useState(props.notes || "");
  const [msg, setMsg] = useState<Result | null>(null);
  const [preview, setPreview] = useState(false);
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(!!props.startEditing && props.approved);
  const locked = props.approved && !editing;

  const subtotal = sumLines(lines);
  const total = Math.round((subtotal + Number(adj || 0)) * 100) / 100;
  const set = (key: string, patch: Partial<L>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch, auto: false } : l)));
  const add = (l: EditLine) => setLines((ls) => [...ls, { ...l, key: k() }]);
  const edit = () => ({ lines: lines.map(({ key, ...l }) => ({ ...l, amount: Number(l.amount || 0) })), adjustments: Number(adj || 0), notes });
  const run = (fn: () => Promise<Result>) => start(async () => { setMsg(null); setMsg(await fn()); });

  const html = useMemo(() => payslipHtml({ ...props.doc, lines: lines.map((l) => ({ kind: l.kind, weeks_completed: l.weeks_completed ?? null, days: l.days ?? null, pct: l.pct ?? null, client: l.client ?? null, dog: l.dog ?? null, program: l.program ?? null, description: l.description ?? null, amount: l.amount })), subtotal, adjustments: Number(adj || 0), total, notes }, "/brand-logo.png"), [props.doc, lines, subtotal, adj, total, notes]);

  return (
    <div className="space-y-4">
      {props.approved && editing && (
        <div className="rounded-[18px] bg-biscuit-wash p-4 text-[14px] text-[#8A5A00]">
          <p className="font-bold">Correcting an approved payslip.</p>
          <p>The trainer keeps seeing the current version until you send the corrected one. They&apos;ll get an email saying it replaces the earlier payslip.</p>
        </div>
      )}
      {locked && (
        <div className={`rounded-[18px] p-4 text-[14px] ${props.status.error ? "bg-heart-wash text-heart" : "bg-mint-wash text-fern"}`}>
          <p className="font-bold">Approved{props.status.approvedBy ? ` by ${props.status.approvedBy}` : ""}{props.status.approvedAt ? ` on ${new Date(props.status.approvedAt).toLocaleDateString("en-US")}` : ""}.</p>
          <p>{props.status.error ? `Email not sent: ${props.status.error}` : props.status.sentTo ? `Emailed to ${props.status.sentTo}${props.status.sentAt ? ` on ${new Date(props.status.sentAt).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}` : ""}.` : "Not emailed yet."}</p>
        </div>
      )}

      <ul className="space-y-2.5">
        {lines.map((l) => (
          <li key={l.key} className={`panel p-3.5 ${l.kind === "deduction" ? "border-heart/30" : ""}`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[12px] font-bold uppercase tracking-wide text-ink-faint">{l.kind === "training" && l.days ? "Extra days" : { training: "Training", route: "Route", deduction: "Deduction", other: "Other" }[l.kind]}{l.auto ? " · from bookings" : ""}</span>
              {!locked && <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="grid h-9 w-9 place-items-center rounded-full text-ink-faint hover:bg-heart-wash hover:text-heart" aria-label="Remove line"><Trash2 size={16} /></button>}
            </div>
            {l.kind === "training" && (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                {l.days ? (
                  <Field label="Extra days"><input disabled={locked} type="number" min={0} max={13} value={l.days ?? ""} onChange={(e) => set(l.key, { days: Number(e.target.value) })} className="field" /></Field>
                ) : (
                  <Field label="Weeks done"><input disabled={locked} type="number" min={0} value={l.weeks_completed ?? ""} onChange={(e) => set(l.key, { weeks_completed: Number(e.target.value) })} className="field" /></Field>
                )}
                <Field label="Client"><input disabled={locked} value={l.client || ""} onChange={(e) => set(l.key, { client: e.target.value })} className="field" /></Field>
                <Field label="Dog"><input disabled={locked} value={l.dog || ""} onChange={(e) => set(l.key, { dog: e.target.value })} className="field" /></Field>
                <Field label="Program"><input disabled={locked} value={l.program || ""} onChange={(e) => set(l.key, { program: e.target.value })} className="field" /></Field>
                <Money disabled={locked} value={l.amount} onChange={(v) => set(l.key, { amount: v, description: null })} />
              </div>
            )}
            {l.kind === "route" && (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Field label="Client"><input disabled={locked} value={l.client || ""} onChange={(e) => set(l.key, { client: e.target.value })} className="field" /></Field>
                <Field label="Dog"><input disabled={locked} value={l.dog || ""} onChange={(e) => set(l.key, { dog: e.target.value })} className="field" /></Field>
                <div className="col-span-2 md:col-span-1" />
                <Money disabled={locked} value={l.amount} onChange={(v) => set(l.key, { amount: v })} />
              </div>
            )}
            {l.kind === "deduction" && (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Field label="Reason" className="col-span-2">
                  <select disabled={locked} value={DEDUCTIONS.includes(l.description || "") ? l.description! : "other"} onChange={(e) => set(l.key, { description: e.target.value === "other" ? "Deduction - " : e.target.value })} className="field">
                    {DEDUCTIONS.map((d) => <option key={d} value={d}>{d.replace("Deduction - ", "")}</option>)}<option value="other">Other</option>
                  </select>
                  {!DEDUCTIONS.includes(l.description || "") && <input disabled={locked} value={l.description || ""} onChange={(e) => set(l.key, { description: e.target.value })} className="field mt-2" />}
                </Field>
                <Field label="% of $100">
                  <input disabled={locked} type="number" min={0} max={100} value={l.pct ?? ""} onChange={(e) => { const pct = Number(e.target.value); set(l.key, { pct, amount: deductionAmount(props.rates, pct) }); }} className="field" />
                </Field>
                <Money disabled={locked} value={l.amount} onChange={(v) => set(l.key, { amount: v })} />
              </div>
            )}
            {l.kind === "other" && (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Field label="Description" className="col-span-2 md:col-span-3"><input disabled={locked} value={l.description || ""} onChange={(e) => set(l.key, { description: e.target.value })} className="field" /></Field>
                <Money disabled={locked} value={l.amount} onChange={(v) => set(l.key, { amount: v })} />
              </div>
            )}
            {l.kind === "training" && l.description?.startsWith("No pay rate") && <p className="mt-2 text-[13px] text-heart">{l.description}. Set it on the trainer&apos;s profile and rebuild, or type the amount.</p>}
          </li>
        ))}
      </ul>

      {!locked && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost h-10 min-h-0 px-3 text-[14px]" onClick={() => { const b = props.bookings[0]; add({ kind: "route", client: b?.client || "", dog: b?.dog || "", amount: 0 }); }}><Plus size={16} />Route</button>
          <button type="button" className="btn-ghost h-10 min-h-0 px-3 text-[14px]" onClick={() => add({ kind: "deduction", description: DEDUCTIONS[0], pct: 100, amount: deductionAmount(props.rates, 100) })}><Plus size={16} />Deduction</button>
          <button type="button" className="btn-ghost h-10 min-h-0 px-3 text-[14px]" onClick={() => add({ kind: "training", weeks_completed: 1, client: "", dog: "", program: "", amount: 0 })}><Plus size={16} />Training</button>
          <button type="button" className="btn-ghost h-10 min-h-0 px-3 text-[14px]" onClick={() => add({ kind: "other", description: "", amount: 0 })}><Plus size={16} />Other</button>
        </div>
      )}

      <div className="panel space-y-3 p-4">
        <div className="flex justify-between text-[15px]"><span className="text-ink-soft">Subtotal</span><b>{money(subtotal)}</b></div>
        <div className="flex items-center justify-between gap-3 text-[15px]">
          <span className="text-ink-soft">Adjustments</span>
          <span className="relative w-36"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">$</span>
            <input disabled={locked} inputMode="decimal" value={adj} onChange={(e) => setAdj(e.target.value)} className="field py-2 pl-6 text-right" /></span>
        </div>
        <div className="flex items-end justify-between border-t border-line pt-3"><span className="font-semibold">Total</span><span className="text-[28px] font-extrabold text-[#6B4FE0]">{money(total)}</span></div>
        <label className="block"><span className="label">Notes on the payslip (the trainer sees these)</span>
          <textarea disabled={locked} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="field" placeholder="e.g. Weekly report for Oct 18 was late, 50% deducted." /></label>
      </div>

      <div className="flex gap-4 text-[14px] font-semibold">
        <button type="button" className="underline" onClick={() => setPreview((p) => !p)}>{preview ? "Hide preview" : "Preview payslip"}</button>
        <a href={`/api/payslips/${props.id}/pdf`} target="_blank" className="underline">Open PDF</a>
      </div>
      <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 flex gap-2 rounded-[20px] border border-line bg-white/95 p-2 backdrop-blur md:bottom-4">
        {props.approved && editing ? (
          <>
            <button type="button" disabled={pending} className="btn-ghost flex-1 whitespace-nowrap px-3" onClick={() => { setLines(props.initial.map((l) => ({ ...l, key: k() }))); setAdj(String(props.adjustments || 0)); setNotes(props.notes || ""); setEditing(false); }}>Cancel</button>
            <button type="button" disabled={pending} className="btn-ink flex-[1.6] whitespace-nowrap px-3"
              onClick={() => { if (window.confirm(`Send the corrected payslip (${money(total)}) to the trainer?`)) run(async () => { const r = await correctAndResendAction(props.id, edit()); if (r.ok) setEditing(false); return r; }); }}>
              {pending ? "Sending…" : "Send corrected payslip"}
            </button>
          </>
        ) : !locked ? (
          <>
            <button type="button" disabled={pending} className="btn-ghost flex-1 whitespace-nowrap px-3" onClick={() => run(() => savePayslipAction(props.id, edit()))}>Save draft</button>
            <button type="button" disabled={pending} className="btn-ink flex-[1.6] whitespace-nowrap px-3"
              onClick={() => { if (window.confirm(`Approve ${money(total)} and email this payslip to the trainer?`)) run(() => approveAndSendAction(props.id, edit())); }}>
              {pending ? "Working…" : "Approve and send"}
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={pending} className="btn-ink flex-1" onClick={() => setEditing(true)}>Edit</button>
            <button type="button" disabled={pending} className="btn-ghost flex-1" onClick={() => run(() => resendAction(props.id))}>{pending ? "Sending…" : "Email again"}</button>
          </>
        )}
      </div>
      {msg && <p role="status" className={`rounded-xl px-3 py-2 text-[14px] ${msg.ok ? "bg-mint-wash text-fern" : "bg-heart-wash text-heart"}`}>{msg.message}</p>}
      {preview && <div className="overflow-x-auto rounded-[18px] border border-line bg-white p-2"><div className="min-w-[560px]" dangerouslySetInnerHTML={{ __html: html }} /></div>}
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block ${className}`}><span className="label">{label}</span>{children}</label>;
}
function Money({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const [txt, setTxt] = useState(String(value ?? 0));
  const focused = useRef(false);
  // Follow changes made elsewhere (e.g. a deduction % recalculating the amount)
  useEffect(() => { if (!focused.current) setTxt(String(value ?? 0)); }, [value]);
  return (
    <Field label="Amount">
      <span className="relative block"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">$</span>
        <input disabled={disabled} inputMode="decimal" value={txt} onChange={(e) => { setTxt(e.target.value); const n = Number(e.target.value.replace(/[$,]/g, "")); if (!isNaN(n)) onChange(n); }} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; setTxt(String(value ?? 0)); }} className="field pl-6 text-right" /></span>
    </Field>
  );
}
