"use client";
import { useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { importSalesAction, inviteSalesAction, refreshSalesAction, setSalesCutoverAction } from "@/app/sales-actions";

/** Admin: when Sales was last updated from HubSpot, and a button to update it now. */
export function SalesRefresh({ last }: { last: { at: string; deals: number; won: number; errors: string[]; by: string } | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const stale = !last || Date.now() - Date.parse(last.at) > 75 * 60e3;
  return (
    <div className={`mt-4 flex flex-wrap items-center gap-3 rounded-2xl border px-3.5 py-3 text-small ${last?.errors.length || stale ? "border-heart/40 bg-heart-wash" : "border-line bg-white"}`}>
      <p className="min-w-0 flex-1">
        {last ? <>Updated from HubSpot <b>{when(last.at)} ET</b> ({last.by === "schedule" ? "every 30 minutes" : `by ${last.by}`}): {last.deals} deals, {last.won} Closed Won.</> : <b>Not updated from HubSpot yet.</b>}
        {last?.errors.length ? <span className="mt-1 block font-semibold text-heart">Problems: {last.errors.join("; ")}</span> : null}
        {last && stale && !last.errors.length ? <span className="mt-1 block font-semibold text-heart">Over an hour ago: the 30-minute update may not be running.</span> : null}
        {msg && <span role="status" className={`mt-1 block font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.message}</span>}
      </p>
      <button type="button" className="btn-ink h-10 min-h-0 shrink-0 px-4" disabled={pending}
        onClick={() => start(async () => { setMsg(null); const r = await refreshSalesAction(); setMsg(r); router.refresh(); })}>
        {pending ? "Updating… (up to a minute)" : "Refresh from HubSpot"}
      </button>
    </div>
  );
}

/** Admin: where each month's sales come from. Up to this day: the Monies sheet. After it: HubSpot. Changeable either way. */
export function SalesCutover({ through, today, sheetRows, hubspotRows }: { through: string | null; today: string; sheetRows: number; hubspotRows: number }) {
  const [r, act] = useFormState(setSalesCutoverAction, null);
  return (
    <div className="panel p-4">
      <p className="font-bold">Where these sales come from</p>
      <p className="mt-1 text-small text-ink-soft">This month: <b>{hubspotRows}</b> from HubSpot, <b>{sheetRows}</b> from the Monies sheet. {through ? <>The sheet covers sales up to <b>{through}</b>; deals won after that come from HubSpot.</> : <>Every month comes from HubSpot.</>}</p>
      <form action={act} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-[180px] flex-1"><span className="label">Sheet covers sales up to</span><input type="date" name="through" defaultValue={through || ""} max={today} className="field" /></label>
        <SaveCutover />
      </form>
      <p className="mt-1 text-caption text-ink-faint">Leave it empty to use HubSpot for every month. Then tap Refresh from HubSpot.</p>
      {r && <p role="status" className={`mt-2 text-small font-semibold ${r.ok ? "text-fern" : "text-heart"}`}>{r.message}</p>}
    </div>
  );
}
function SaveCutover() { const { pending } = useFormStatus(); return <button className="btn-ghost" disabled={pending}>{pending ? "Saving…" : "Save"}</button>; }

/** Admin: the HubSpot sales team, and who has a login. */
export function SalesTeam({ team }: { team: { id: string; name: string; email: string; hasLogin: boolean }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <details className="panel p-4">
      <summary className="cursor-pointer font-bold">Sales team logins <span className="count">{team.length}</span></summary>
      <p className="mt-2 text-small text-ink-soft">The people in your HubSpot sales team. Each sees only their own sales.</p>
      {!team.length && <p className="mt-2 text-small font-semibold text-heart">No sales team found in HubSpot. Check the token has the crm.objects.owners.read scope, and that the team name contains &ldquo;sales&rdquo;.</p>}
      <ul className="mt-2 divide-y divide-line">
        {team.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <span><span className="font-semibold">{t.name}</span> <span className="text-small text-ink-soft">{t.email}</span></span>
            <button type="button" className="btn-ghost h-8 min-h-0 px-2.5 text-small" disabled={pending} onClick={() => start(async () => { const r = await inviteSalesAction(t.id); setMsg(r.message); router.refresh(); })}>{t.hasLogin ? "Send link again" : "Send login"}</button>
          </li>
        ))}
      </ul>
      {msg && <p role="status" className="mt-2 text-small font-semibold">{msg}</p>}
    </details>
  );
}

function Go() { const { pending } = useFormStatus(); return <button className="btn-ink" disabled={pending}>{pending ? "Importing…" : "Import"}</button>; }
/** Admin: paste a month of sales from the Monies sheet. */
export function SalesImport({ month, today, monthName, through }: { month: string; today: string; monthName: string; through: string | null }) {
  const [r, act] = useFormState(importSalesAction, null);
  return (
    <details className="panel p-4">
      <summary className="cursor-pointer font-bold">Import {monthName} sales from the Monies sheet</summary>
      <form action={act} className="mt-3 space-y-3" onSubmit={(e) => { if (!window.confirm(`Import these rows as ${monthName} sales? This replaces any ${monthName} rows pasted before.`)) e.preventDefault(); }}>
        <p className="rounded-xl bg-biscuit-wash p-3 text-body font-semibold text-warn">These go into {monthName}. To import another month, pick its tab at the top first.</p>
        <input type="hidden" name="month" value={month} />
        <p className="text-small text-ink-soft">In the sheet&apos;s Sales tab, select this month&apos;s rows (from the Name column to Paid in full), copy, and paste here. Importing again replaces this month&apos;s pasted rows.</p>
        <textarea name="rows" rows={6} className="field font-mono text-small" placeholder={"James S\tSmith\t3 week basic\t3000\t210\tYES"} required />
        <label className="block"><span className="label">These rows cover sales up to</span><input type="date" name="through" defaultValue={through || ""} max={today} className="field" required /></label>
        <p className="-mt-1 text-caption text-ink-faint">The last day the sheet has every sale for. Deals won after it come from HubSpot, so a later date hides HubSpot deals up to that day.</p>
        <Go />
        {r && <p role="status" className={`text-small font-semibold ${r.ok ? "text-fern" : "text-heart"}`}>{r.message}</p>}
      </form>
    </details>
  );
}
