"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviteSalesAction, refreshSalesAction } from "@/app/sales-actions";

/** Admin: when Sales was last updated from HubSpot, and a button to update it now. */
export function SalesRefresh({ last }: { last: { at: string; deals: number; won: number; byMonth?: Record<string, number>; errors: string[]; by: string } | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const stale = !last || Date.now() - Date.parse(last.at) > 75 * 60e3;
  return (
    <div className={`mt-4 flex flex-wrap items-center gap-3 rounded-2xl border px-3.5 py-3 text-small ${last?.errors.length || stale ? "border-heart/40 bg-heart-wash" : "border-line bg-white"}`}>
      <p className="min-w-0 flex-1">
        {last ? <>Updated from HubSpot <b>{when(last.at)} ET</b> ({last.by === "schedule" ? "every 30 minutes" : `by ${last.by}`}): {last.won} Closed Won deals in these six months.</> : <b>Not updated from HubSpot yet.</b>}
        {last?.byMonth && Object.keys(last.byMonth).length > 0 && (
          <span className="mt-1 block text-ink-soft">By month: {Object.entries(last.byMonth).sort((a, b) => b[0].localeCompare(a[0])).map(([m, n]) => `${new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} ${n}`).join(" · ")}. These should match a HubSpot report of Closed Won deals by close date.</span>
        )}
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
