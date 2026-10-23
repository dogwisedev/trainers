"use client";
import { useMemo, useState, useTransition } from "react";
import { Download, Upload } from "lucide-react";
import { markGustoPaidAction, saveGustoCodesAction } from "@/app/payroll-actions";

// Payday: upload Gusto's contractor pay template, check each trainer's match, download it filled in (flat_amount), import into Gusto.
// The file is read and filled in this browser only: it never reaches our server (it has SSN digits in it).
type Pay = { trainerId: string; name: string; amount: number; code: string | null };
type GRow = { code: string; first: string; last: string; business: string };
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

export function GustoFill({ run, pay, paidAt, paidBy, pending }: { run: string; pay: Pay[]; paidAt: string | null; paidBy: string | null; pending: number }) {
  const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [how, setHow] = useState<Record<string, "saved" | "auto" | "check" | "none">>({});
  const [msg, setMsg] = useState("");
  const [busy, start] = useTransition();
  const [paid, setPaid] = useState({ at: paidAt, by: paidBy });
  const head = file?.rows[0].map((h) => h.trim().toLowerCase()) || [];
  const col = (n: string) => head.indexOf(n);
  const g: GRow[] = useMemo(() => !file ? [] : file.rows.slice(1).map((r) => ({ code: r[col("worker_code")]?.trim() || "", first: r[col("first_name")] || "", last: r[col("last_name")] || "", business: r[col("business_name")] || "" })).filter((r) => r.code), [file]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = (r: GRow) => (r.last || r.first ? `${r.last}${r.first ? `, ${r.first}` : ""}` : r.business) + (r.business && (r.last || r.first) ? ` (${r.business})` : "");

  const load = async (f: File) => {
    setMsg("");
    const rows = parseCsv(await f.text());
    const h = rows[0]?.map((x) => x.trim().toLowerCase()) || [];
    if (!h.includes("worker_code") || !h.includes("flat_amount")) { setMsg("That doesn't look like Gusto's contractor pay template (no worker_code / flat_amount columns)."); return; }
    setFile({ name: f.name, rows });
    const gr = rows.slice(1).map((r) => ({ code: r[h.indexOf("worker_code")]?.trim() || "", first: r[h.indexOf("first_name")] || "", last: r[h.indexOf("last_name")] || "", business: r[h.indexOf("business_name")] || "" })).filter((r) => r.code);
    const p: Record<string, string> = {}, w: Record<string, "saved" | "auto" | "check" | "none"> = {};
    for (const t of pay) {
      if (t.code && gr.some((r) => r.code === t.code)) { p[t.trainerId] = t.code; w[t.trainerId] = "saved"; continue; }
      const s = suggest(t.name, gr);
      p[t.trainerId] = s?.code || ""; w[t.trainerId] = s ? (s.sure ? "auto" : "check") : "none";
    }
    setPick(p); setHow(w);
  };
  const missing = pay.filter((t) => !pick[t.trainerId]);
  const dupes = Object.entries(pay.reduce<Record<string, string[]>>((m, t) => { const c = pick[t.trainerId]; if (c) (m[c] ||= []).push(t.name); return m; }, {})).filter(([, n]) => n.length > 1);
  const total = pay.reduce((n, t) => n + t.amount, 0), inFile = pay.filter((t) => pick[t.trainerId]).reduce((n, t) => n + t.amount, 0);

  const download = () => start(async () => {
    if (!file) return;
    if (missing.length && !window.confirm(`${missing.length} trainer${missing.length > 1 ? "s aren't" : " isn't"} matched to anyone in Gusto (${missing.map((t) => t.name).join(", ")}). They won't be in the file. Download anyway?`)) return;
    const byCode: Record<string, number> = {};
    for (const t of pay) if (pick[t.trainerId]) byCode[pick[t.trainerId]] = (byCode[pick[t.trainerId]] || 0) + t.amount;
    const ci = col("worker_code"), ai = col("flat_amount");
    const out = file.rows.map((r, i) => (i === 0 ? r : (() => { const c = [...r]; while (c.length < head.length) c.push(""); const amt = byCode[(r[ci] || "").trim()]; if (amt) c[ai] = amt.toFixed(2); return c; })()));
    const blob = new Blob([toCsv(out)], { type: "text/csv" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `gusto-contractor-pay-${run}.csv`; a.click(); URL.revokeObjectURL(a.href);
    const save = pay.filter((t) => pick[t.trainerId] && pick[t.trainerId] !== t.code).map((t) => ({ trainerId: t.trainerId, code: pick[t.trainerId] }));
    if (save.length) await saveGustoCodesAction(save);
    setMsg(`Downloaded. ${pay.length - missing.length} trainers, $${money(inFile)}. Now import it in Gusto (Pay contractors), check the total, then submit.`);
  });

  return (
    <>
      {pending > 0 && <p className="mb-4 rounded-xl bg-heart-wash p-3 text-[14px] font-semibold text-heart">{pending} payslip{pending > 1 ? "s are" : " is"} not approved yet, so not included. Approve first.</p>}
      <ol className="panel mb-4 space-y-2 p-4 text-[14px]">
        <li><b>1.</b> In Gusto: <b>Pay contractors</b>, then download the template (CSV).</li>
        <li><b>2.</b> Upload it here, and check the matches below.</li>
        <li><b>3.</b> Download the filled file, and import it in Gusto. Check the total, then submit.</li>
      </ol>
      <label className="btn-ink mb-4 w-full cursor-pointer sm:w-auto"><Upload size={17} />{file ? `Uploaded: ${file.name}` : "Upload Gusto's template"}
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); }} />
      </label>
      {msg && <p role="status" className="mb-4 rounded-xl bg-paper p-3 text-[14px] font-semibold">{msg}</p>}
      <ul className="panel divide-y divide-line">
        {pay.map((t) => {
          const w = how[t.trainerId];
          return (
            <li key={t.trainerId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3">
              <span className="min-w-[40%] flex-1 font-semibold">{t.name}</span>
              <span className="font-mono font-bold tabular-nums">${money(t.amount)}</span>
              {file && (
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <select className="field h-10 py-0 text-[14px] sm:w-64" value={pick[t.trainerId] || ""} onChange={(e) => { setPick((p) => ({ ...p, [t.trainerId]: e.target.value })); setHow((h) => ({ ...h, [t.trainerId]: e.target.value ? "saved" : "none" })); }}>
                    <option value="">Not in Gusto</option>
                    {g.map((r) => <option key={r.code} value={r.code}>{label(r)}</option>)}
                  </select>
                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${w === "saved" || w === "auto" ? "bg-paper text-fern" : w === "check" ? "bg-biscuit-wash text-[#7A5418]" : "bg-heart-wash text-heart"}`}>{w === "saved" ? "Matched" : w === "auto" ? "Auto" : w === "check" ? "Check this" : "No match"}</span>
                </div>
              )}
            </li>
          );
        })}
        {!pay.length && <li className="p-6 text-center text-ink-soft">No approved payslips in this pay run yet.</li>}
      </ul>
      {dupes.length > 0 && <p className="mt-3 rounded-xl bg-heart-wash p-3 text-[14px] font-semibold text-heart">Two trainers are matched to the same Gusto person: {dupes.map(([, n]) => n.join(" and ")).join("; ")}. Fix one of them.</p>}
      <div className="panel mt-3 flex flex-wrap items-center justify-between gap-3 p-4">
        <div><p className="text-[13px] text-ink-soft">Total to pay ({pay.length} trainers)</p><p className="text-[26px] font-extrabold tabular-nums">${money(total)}</p><p className="text-[12px] text-ink-faint">Check this matches Gusto&apos;s total before you submit.</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ink" disabled={!file || busy || dupes.length > 0} onClick={download}><Download size={17} />Download filled file</button>
          {paid.at ? <span className="self-center text-[14px] font-semibold text-fern">Paid in Gusto {new Date(paid.at).toLocaleDateString("en-US")}{paid.by ? ` by ${paid.by}` : ""}</span>
            : <button type="button" className="btn-ghost" disabled={busy || !pay.length} onClick={() => { if (window.confirm(`Mark this pay run as paid in Gusto ($${money(total)})?`)) start(async () => { const r = await markGustoPaidAction(run); if (r.ok) setPaid({ at: new Date().toISOString(), by: "you" }); else setMsg(r.message); }); }}>Mark as paid in Gusto</button>}
        </div>
      </div>
    </>
  );
}
