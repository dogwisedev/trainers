"use client";
import { useMemo, useState, useTransition } from "react";
import { Check, Download, Upload } from "lucide-react";
import { markGustoPaidAction, saveGustoPayeesAction, setGustoCodeAction } from "@/app/payroll-actions";

// Payday in Gusto, mapped once and saved:
//  - Gusto people: uploaded once from Gusto's contractor pay template (names + worker codes only; the SSN digits are never sent).
//    Upload again only when someone new is added in Gusto.
//  - Each trainer is linked to the Gusto person who gets paid for them (a spouse or a business is fine), saved straight away.
//  - Download: Gusto's file, built from the saved list and the approved payslips. No upload needed on payday.
type Pay = { trainerId: string; name: string; amount: number; code: string | null };
type GRow = { code: string; first: string; last: string; business: string };
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const HEADER = ["last_name", "first_name", "business_name", "worker_code", "ssn/ein", "hourly_rate", "hours", "flat_amount", "bonus", "reimbursement", "tips", "cash_tips", "invoice_number", "note"];

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const toCsv = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n") + "\r\n";
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
/** Best guess for a trainer in Gusto's list: same surname + compatible first name (or nickname), else a unique surname or first name. */
function suggest(name: string, g: GRow[]): { code: string; sure: boolean } | null {
  const nick = (name.match(/["“]([^"”]+)["”]/) || [])[1];
  const parts = norm(name.replace(/["“][^"”]*["”]/g, " ")).split(" "), first = parts[0] || "", last = parts[parts.length - 1] || "";
  const firstOk = (gf: string) => { const f = norm(gf); return !!f && (f === first || f.startsWith(first) || first.startsWith(f) || (!!nick && f === norm(nick))); };
  const sameLast = g.filter((r) => { const l = norm(r.last); return !!l && (l === last || l.split(" ").includes(last)); });
  const both = sameLast.filter((r) => firstOk(r.first));
  if (both.length === 1) return { code: both[0].code, sure: true };
  if (sameLast.length === 1) return { code: sameLast[0].code, sure: false };
  const sameFirst = g.filter((r) => firstOk(r.first));
  if (sameFirst.length === 1 && parts.length > 1) return { code: sameFirst[0].code, sure: false };
  return null;
}


export function GustoFill({ run, pay, others, payees: initial, paidAt, paidBy, pending }: { run: string; pay: Pay[]; others: Pay[]; payees: GRow[]; paidAt: string | null; paidBy: string | null; pending: number }) {
  const [payees, setPayees] = useState<GRow[]>(initial);
  const [codes, setCodes] = useState<Record<string, string>>(() => Object.fromEntries([...pay, ...others].map((t) => [t.trainerId, t.code || ""])));
  const [saving, setSaving] = useState<string>("");
  const [msg, setMsg] = useState("");
  const [busy, start] = useTransition();
  const [paid, setPaid] = useState({ at: paidAt, by: paidBy });
  const byCode = useMemo(() => new Map(payees.map((p) => [p.code, p])), [payees]);
  const label = (r: GRow) => (r.last || r.first ? `${r.last}${r.first ? `, ${r.first}` : ""}` : r.business) + (r.business && (r.last || r.first) ? ` (${r.business})` : "");
  const sorted = useMemo(() => [...payees].sort((a, b) => label(a).localeCompare(label(b))), [payees]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (f: File) => {
    setMsg("");
    const rows = parseCsv(await f.text()), h = rows[0]?.map((x) => x.trim().toLowerCase()) || [];
    if (!h.includes("worker_code")) { setMsg("That doesn't look like Gusto's contractor pay template (no worker_code column)."); return; }
    const list = rows.slice(1).map((r) => ({ code: (r[h.indexOf("worker_code")] || "").trim(), first: r[h.indexOf("first_name")] || "", last: r[h.indexOf("last_name")] || "", business: r[h.indexOf("business_name")] || "" })).filter((r) => r.code);
    start(async () => { const res = await saveGustoPayeesAction(list); setMsg(res.message); if (res.ok) setPayees(list); });
  };
  const link = (trainerId: string, code: string) => {
    setCodes((c) => ({ ...c, [trainerId]: code })); setSaving(trainerId);
    start(async () => { const r = await setGustoCodeAction(trainerId, code); setSaving(""); if (!r.ok) setMsg(r.message); });
  };
  const suggestions = [...pay, ...others].filter((t) => !codes[t.trainerId]).map((t) => ({ t, s: suggest(t.name, payees) })).filter((x) => x.s);
  const saveSuggestions = () => start(async () => {
    for (const { t, s } of suggestions) { await setGustoCodeAction(t.trainerId, s!.code); }
    setCodes((c) => ({ ...c, ...Object.fromEntries(suggestions.map(({ t, s }) => [t.trainerId, s!.code])) }));
    setMsg(`Linked ${suggestions.length} trainers. Check any marked "Check this".`);
  });

  const unlinked = pay.filter((t) => !codes[t.trainerId] || !byCode.has(codes[t.trainerId]));
  const total = pay.reduce((n, t) => n + t.amount, 0), inFile = pay.filter((t) => !unlinked.includes(t)).reduce((n, t) => n + t.amount, 0);
  const download = () => {
    if (unlinked.length && !window.confirm(`${unlinked.map((t) => t.name).join(", ")} ${unlinked.length > 1 ? "aren't" : "isn't"} linked to anyone in Gusto, so ${unlinked.length > 1 ? "they" : "they"}'ll be left out ($${money(total - inFile)}). Download anyway?`)) return;
    const amt: Record<string, number> = {};
    for (const t of pay) { const c = codes[t.trainerId]; if (c && byCode.has(c)) amt[c] = (amt[c] || 0) + t.amount; }
    const rows = [HEADER, ...[...payees].sort((a, b) => (a.last || a.business).localeCompare(b.last || b.business)).map((p) => [p.last, p.first, p.business, p.code, "", "", "", amt[p.code] ? amt[p.code].toFixed(2) : "", "", "", "", "", "", ""])];
    const blob = new Blob([toCsv(rows)], { type: "text/csv" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `gusto-contractor-pay-${run}.csv`; a.click(); URL.revokeObjectURL(a.href);
    setMsg(`Downloaded: ${pay.length - unlinked.length} trainers, $${money(inFile)}. Import it in Gusto (Pay contractors), check the total, then submit.`);
  };
  const Row = ({ t, showAmount }: { t: Pay; showAmount: boolean }) => {
    const c = codes[t.trainerId], p = c ? byCode.get(c) : undefined, sug = !c ? suggest(t.name, payees) : null;
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3">
        <span className="min-w-[35%] flex-1"><span className="block font-semibold">{t.name}</span>{p && <span className="block text-[12px] text-ink-faint">Paid in Gusto as {label(p)}</span>}</span>
        {showAmount && <span className="font-mono font-bold tabular-nums">${money(t.amount)}</span>}
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <select className="field h-10 py-0 text-[14px] sm:w-64" value={c || ""} onChange={(e) => link(t.trainerId, e.target.value)}>
            <option value="">{sug ? `Not linked (suggested: ${label(byCode.get(sug.code)!)})` : "Not linked to Gusto"}</option>
            {sorted.map((r) => <option key={r.code} value={r.code}>{label(r)}</option>)}
          </select>
          {saving === t.trainerId ? <span className="text-[12px] text-ink-faint">Saving…</span> : p ? <Check size={16} className="text-fern" aria-label="Linked" /> : <span className="whitespace-nowrap rounded-full bg-heart-wash px-2 py-0.5 text-[11px] font-bold text-heart">{sug ? (sug.sure ? "Suggested" : "Check this") : "Not linked"}</span>}
        </div>
      </li>
    );
  };

  return (
    <>
      {pending > 0 && <p className="mb-4 rounded-xl bg-heart-wash p-3 text-[14px] font-semibold text-heart">{pending} payslip{pending > 1 ? "s are" : " is"} not approved yet, so not included. Approve first.</p>}
      {!payees.length ? (
        <div className="panel mb-4 p-4"><p className="font-bold">First, the Gusto people list (once)</p><p className="mt-1 text-[14px] text-ink-soft">In Gusto: Pay contractors, then download the template (CSV), and upload it here. Only names and worker codes are kept.</p></div>
      ) : null}
      {msg && <p role="status" className="mb-4 rounded-xl bg-paper p-3 text-[14px] font-semibold">{msg}</p>}
      {suggestions.length > 0 && payees.length > 0 && (
        <div className="panel mb-4 flex flex-wrap items-center gap-3 p-3.5"><p className="min-w-0 flex-1 text-[14px]"><b>{suggestions.length} trainer{suggestions.length > 1 ? "s" : ""} not linked yet</b>, with a suggested match.</p>
          <button type="button" className="btn-ink h-9 min-h-0 px-3 text-[13px]" disabled={busy} onClick={saveSuggestions}>Link all suggestions</button></div>
      )}
      <h2 className="group-title">This pay run <span className="count">{pay.length}</span></h2>
      <ul className="panel divide-y divide-line">{pay.map((t) => <Row key={t.trainerId} t={t} showAmount />)}{!pay.length && <li className="p-6 text-center text-ink-soft">No approved payslips in this pay run yet.</li>}</ul>
      <div className="panel mt-3 flex flex-wrap items-center justify-between gap-3 p-4">
        <div><p className="text-[13px] text-ink-soft">Total to pay ({pay.length} trainers)</p><p className="text-[26px] font-extrabold tabular-nums">${money(total)}</p>
          {unlinked.length > 0 ? <p className="text-[12px] font-semibold text-heart">{unlinked.length} not linked: ${money(total - inFile)} won&apos;t be in the file.</p> : <p className="text-[12px] text-ink-faint">Check this matches Gusto&apos;s total before you submit.</p>}</div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ink" disabled={!payees.length || !pay.length} onClick={download}><Download size={17} />Download Gusto file</button>
          {paid.at ? <span className="self-center text-[14px] font-semibold text-fern">Paid in Gusto {new Date(paid.at).toLocaleDateString("en-US")}{paid.by ? ` by ${paid.by}` : ""}</span>
            : <button type="button" className="btn-ghost" disabled={busy || !pay.length} onClick={() => { if (window.confirm(`Mark this pay run as paid in Gusto ($${money(total)})?`)) start(async () => { const r = await markGustoPaidAction(run); if (r.ok) setPaid({ at: new Date().toISOString(), by: "you" }); else setMsg(r.message); }); }}>Mark as paid in Gusto</button>}
        </div>
      </div>
      {others.length > 0 && (
        <details className="panel mt-4 p-0"><summary className="cursor-pointer px-4 py-3 font-bold">Other trainers <span className="count">{others.length}</span> <span className="text-[13px] font-normal text-ink-soft">not in this pay run</span></summary>
          <ul className="divide-y divide-line border-t border-line">{others.map((t) => <Row key={t.trainerId} t={t} showAmount={false} />)}</ul></details>
      )}
      <div className="panel mt-4 flex flex-wrap items-center gap-3 p-4">
        <p className="min-w-0 flex-1 text-[14px]"><b>Gusto people: {payees.length}.</b> Upload Gusto&apos;s template again only when someone new is added in Gusto.</p>
        <label className="btn-ghost cursor-pointer"><Upload size={16} />{payees.length ? "Update from Gusto" : "Upload Gusto's template"}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} /></label>
      </div>
    </>
  );
}
