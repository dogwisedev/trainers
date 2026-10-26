"use client";
import { useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { importSalesAction, inviteSalesAction } from "@/app/sales-actions";

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
        <label className="block"><span className="label">These rows cover sales up to</span><input type="date" name="through" defaultValue={through || today} className="field" required /></label>
        <Go />
        {r && <p role="status" className={`text-small font-semibold ${r.ok ? "text-fern" : "text-heart"}`}>{r.message}</p>}
      </form>
    </details>
  );
}
