"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ClipboardList } from "lucide-react";
import { caseUpdateAction, settleForSeanAction, ticketsForAction } from "@/app/care-actions";
import type { CaseAction } from "@/lib/caseUpdates";

type Upd = { id: string; text: string; by: string; at: string; actions: { what: string }[]; for_sean: boolean; settled_at: string | null };
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The team's update on a client's case: logged word for word on the HubSpot deal at once, with the actions picked.
 *  Replaces replying to the QA daily email. Admins. */
export function CaseUpdate({ bookingId, updates }: { bookingId: string; updates: Upd[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState(""), [forSean, setForSean] = useState(false);
  const [act, setAct] = useState<"" | "ticket" | "declined" | "session">(""), [ticket, setTicket] = useState(""), [n, setN] = useState<0 | 1 | 2 | 3>(0), [date, setDate] = useState("");
  const [tickets, setTickets] = useState<{ id: string; subject: string }[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (act === "ticket" && tickets === null) ticketsForAction(bookingId).then(setTickets); }, [act, tickets, bookingId]);
  const actions = (): CaseAction[] => act === "ticket" && ticket ? [{ kind: "close_ticket", ticketId: ticket }] : act === "declined" ? [{ kind: "declined" }] : act === "session" && date ? [{ kind: "session", n, date }] : [];
  const save = () => start(async () => { const r = await caseUpdateAction(bookingId, text, forSean, actions()); setMsg({ ok: r.ok, text: r.message }); if (r.ok) { setText(""); setForSean(false); setAct(""); setTicket(""); setDate(""); router.refresh(); } });
  return (
    <section className="panel p-4">
      <h2 className="flex items-center gap-2 text-lead font-bold"><ClipboardList size={18} />Case update</h2>
      <p className="mt-0.5 text-small text-ink-soft">What's happened on this client's case. It goes on the HubSpot deal as a note straight away, word for word, and into tomorrow's QA daily.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="field mt-3" placeholder="e.g. Payment plan agreed with Sean, first instalment in, extension confirmed" />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {([["", "No action"], ["ticket", "Close the ticket"], ["declined", "Follow-up declined"], ["session", "Session booked"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setAct(k)} aria-pressed={act === k} className={`min-h-[36px] rounded-full border px-3 text-small ${act === k ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-soft"}`}>{l}</button>))}
      </div>
      {act === "ticket" && (tickets === null ? <p className="mt-2 text-small text-ink-soft">Looking for their open tickets…</p> : tickets.length ? (
        <select value={ticket} onChange={(e) => setTicket(e.target.value)} className="field mt-2"><option value="">Pick the ticket to close</option>{tickets.map((t) => <option key={t.id} value={t.id}>{t.subject}</option>)}</select>
      ) : <p className="mt-2 text-small text-ink-soft">No open ticket names this client or dog.</p>)}
      {act === "declined" && <p className="mt-2 text-small text-ink-soft">Moves their follow-up to Not Interested, quietly (no automated email).</p>}
      {act === "session" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={n} onChange={(e) => setN(Number(e.target.value) as 0 | 1 | 2 | 3)} className="field w-auto"><option value={0}>Next free session</option><option value={1}>Session 1</option><option value={2}>Session 2</option><option value={3}>Session 3</option></select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field w-auto" />
        </div>
      )}
      <label className="mt-2 flex min-h-[44px] items-center gap-2 text-small"><input type="checkbox" checked={forSean} onChange={(e) => setForSean(e.target.checked)} className="h-5 w-5 accent-[#281870]" />Needs Sean (a refund, discount or credit, a legal threat, the client asking for the owner)</label>
      <button type="button" disabled={pending || (text.trim().length < 3 && !actions().length)} onClick={save} className="btn-ink mt-2">{pending ? "Saving to HubSpot…" : "Save update"}</button>
      {msg && <p role="status" className={`mt-2 text-small font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</p>}
      {updates.length > 0 && <ul className="mt-4 divide-y divide-line border-t border-line">{updates.map((u) => (
        <li key={u.id} className="py-2 text-body">{u.text}<span className="block text-caption text-ink-faint">{u.by}, {when(u.at)}{u.actions?.length ? ` · ${u.actions.map((a) => a.what).join("; ")}` : ""}{u.for_sean ? (u.settled_at ? " · was with Sean, settled" : " · with Sean") : ""}</span>
          {u.for_sean && !u.settled_at && <button type="button" className="mt-1 text-caption font-semibold underline" onClick={() => start(async () => { await settleForSeanAction(u.id); router.refresh(); })}>Mark settled</button>}
        </li>))}</ul>}
    </section>
  );
}
