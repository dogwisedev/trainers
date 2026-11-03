"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarCheck, CalendarPlus, CheckCircle2, Clock, XCircle } from "lucide-react";
import { cancelFollowupAction, confirmFollowupAction } from "@/app/followup-actions";

// Trainer (or the office): the 3 follow-up sessions of one dog. A client's request shows their preferred days: pick one,
// set the time, Confirm. Or set a session up directly. Booked ones can be changed or cancelled; once it's happened, Log it.
type S = { id: string; n: number; status: string; options: { day: string; part: string }[]; note: string | null; at: string | null; duration_min: number | null };
const nice = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const niceDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const PART_TIME: Record<string, string> = { Morning: "10:00", Afternoon: "14:00", Evening: "17:30", "Any time": "10:00" };

export function FollowupPlanner({ bookingId, sessions, nextN, handedOver, logHref }: { bookingId: string; sessions: S[]; nextN: number | null; handedOver: boolean; logHref: string }) {
  const by = (n: number) => sessions.filter((s) => s.n === n && s.status !== "cancelled").sort((a, z) => (["requested", "confirmed", "done"].includes(z.status) ? 1 : 0) - (["requested", "confirmed", "done"].includes(a.status) ? 1 : 0))[0];
  return (
    <div className="space-y-3">
      {!handedOver && <p className="rounded-xl bg-biscuit-wash p-3 text-small text-warn">The client can book follow-ups once the handover report is sent. You can still set one up here.</p>}
      {[1, 2, 3].map((n) => <Session key={n} n={n} s={by(n)} bookingId={bookingId} canSetUp={nextN === n} logHref={logHref} />)}
    </div>
  );
}

function Session({ n, s, bookingId, canSetUp, logHref }: { n: number; s?: S; bookingId: string; canSetUp: boolean; logHref: string }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [day, setDay] = useState(s?.at ? s.at.slice(0, 10) : s?.options?.[0]?.day || "");
  const [time, setTime] = useState(s?.at ? new Date(s.at).toTimeString().slice(0, 5) : PART_TIME[s?.options?.[0]?.part || "Morning"]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const live = s && ["requested", "confirmed"].includes(s.status);
  const past = s?.status === "confirmed" && s.at && Date.parse(s.at) < Date.now();
  const save = () => start(async () => {
    const at = new Date(`${day}T${time}`), label = nice(at.toISOString());
    const r = await confirmFollowupAction(bookingId, live ? s!.id : null, at.toISOString(), label);
    setMsg({ ok: r.ok, text: r.message }); if (r.ok) { setEdit(false); router.refresh(); }
  });
  const cancel = () => { if (!s || !window.confirm(`Cancel follow-up session ${n}? The client is told in the chat.`)) return; start(async () => { const r = await cancelFollowupAction(s.id); setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh(); }); };
  const head = s?.status === "done" ? <><CheckCircle2 size={18} className="text-fern" />Done{s.duration_min ? ` · ${s.duration_min} min` : ""}{s.at ? ` · ${niceDay(s.at.slice(0, 10))}` : ""}</>
    : s?.status === "missed" ? <><XCircle size={18} className="text-heart" />Didn&apos;t happen</>
    : s?.status === "confirmed" ? <><CalendarCheck size={18} className="text-fern" />{nice(s.at!)}</>
    : s?.status === "requested" ? <><Clock size={18} className="text-warn" />The client asked: pick a time</>
    : <span className="text-ink-faint">Not booked</span>;
  const picker = (
    <div className="mt-3 space-y-2">
      {s?.status === "requested" && s.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">{s.options.map((o) => <button key={o.day + o.part} type="button" onClick={() => { setDay(o.day); setTime(PART_TIME[o.part] || "10:00"); }} className={`chip ${day === o.day ? "chip-on" : ""}`}>{niceDay(o.day)} · {o.part.toLowerCase()}</button>)}</div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="block"><span className="label">Day</span><input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="field h-11 w-auto" /></label>
        <label className="block"><span className="label">Time</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="field h-11 w-auto" /></label>
        <button type="button" onClick={save} disabled={pending || !day || !time} className="btn-ink h-11 min-h-0 px-4">{pending ? "Saving…" : s?.status === "confirmed" ? "Save new time" : "Confirm"}</button>
      </div>
      <p className="text-caption text-ink-faint">The client gets the time in the chat, and a reminder the day before.</p>
    </div>
  );
  return (
    <div className={`panel p-4 ${s?.status === "requested" ? "border-biscuit ring-1 ring-biscuit" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold">Session {n}</p>
        <p className="flex items-center gap-1.5 text-small font-semibold">{head}</p>
      </div>
      {s?.status === "requested" && s.note && <p className="mt-2 rounded-xl bg-paper p-2.5 text-small">&ldquo;{s.note}&rdquo;</p>}
      {(s?.status === "requested" || edit) && picker}
      {!s || s.status === "missed" ? (canSetUp && (edit ? picker : <button type="button" onClick={() => setEdit(true)} className="btn-ghost mt-3 h-10 min-h-0 px-3 text-small"><CalendarPlus size={15} />Set up session {n}</button>)) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {s?.status === "confirmed" && !edit && !past && <button type="button" onClick={() => setEdit(true)} className="btn-ghost h-9 min-h-0 px-3 text-small">Change time</button>}
        {live && <button type="button" onClick={cancel} disabled={pending} className="btn-ghost h-9 min-h-0 px-3 text-small">Cancel</button>}
        {past && <Link prefetch={false} href={logHref} className="btn-ink h-9 min-h-0 px-3 text-small">Log the session</Link>}
      </div>
      {msg && <p role="status" className={`mt-2 text-small font-semibold ${msg.ok ? "text-fern" : "text-heart"}`}>{msg.text}</p>}
    </div>
  );
}
