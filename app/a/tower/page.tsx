import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/data";
import { serviceClient } from "@/lib/supabase";
import { buildTodo } from "@/lib/todo";
import { watching, wins } from "@/lib/clientCare";
import { trainerRatings } from "@/lib/ratings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The Tower page, in the app (admins): risk and decisions, the watch list, wins, trainer ratings, the QA box and case
 *  updates, in one place. Replaces Sean's Tower artifact. */
export default async function Tower() {
  await requireRole("admin");
  const sb = serviceClient(), site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  const [todo, watched, praise, ratings, flags, upd] = await Promise.all([
    buildTodo().catch(() => null), watching(week, site, sb).catch(() => []), wins(week, site, sb, 30).catch(() => []), trainerRatings(7, sb).catch(() => []),
    sb.from("qa_flags").select("client, dog, reason, by, status, at").gte("at", new Date(Date.now() - 14 * 864e5).toISOString()).order("at", { ascending: false }).limit(30).then((r) => r.data || [], () => []),
    sb.from("case_updates").select("client, dog, text, by, at, for_sean, settled_at, booking_id").gte("at", week).order("at", { ascending: false }).limit(40).then((r) => r.data || [], () => [])
  ]);
  const risk = (todo?.items || []).filter((i) => i.decision || /needs a person now/.test(i.text));
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const box = (title: string, empty: string, body: React.ReactNode, n: number) => (
    <section className="panel overflow-hidden"><h2 className="border-b border-line bg-paper/60 px-4 py-2.5 text-body font-extrabold">{title} <span className="font-normal text-ink-soft">{n}</span></h2>{n ? body : <p className="px-4 py-3 text-small text-ink-soft">{empty}</p>}</section>
  );
  const tone = { red: "bg-heart text-white", amber: "bg-biscuit-wash text-warn", green: "bg-mint-wash text-fern" };
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Link prefetch={false} href="/a/pulse?view=office" className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="Back to Pulse"><ChevronLeft /></Link>
        <div><h1 className="text-h2 font-extrabold leading-tight">Tower</h1><p className="text-body text-ink-soft">Risk, decisions, the watch list, wins, ratings and the QA box, in one place.</p></div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {box("Risk and decisions", "Nothing open.", <ul className="divide-y divide-line">{risk.map((i) => <li key={i.key} className="px-4 py-2.5 text-body"><a href={i.primary?.href || "/a"} className="font-semibold hover:underline">{i.text}</a>{i.detail && <span className="block text-small text-ink-soft">{i.detail.slice(0, 200)}</span>}<span className="block text-caption text-ink-faint">{i.poc || "No owner"}{i.since ? ` · since ${day(i.since)}` : ""}</span></li>)}</ul>, risk.length)}
        {box("Trainer ratings, last 7 days", "No trainers with dogs in care.", <ul className="divide-y divide-line">{ratings.map((r) => <li key={r.trainerId} className="flex items-start gap-3 px-4 py-2.5"><span className={`mt-0.5 rounded-full px-2.5 py-0.5 text-caption font-bold ${tone[r.rating]}`}>{r.rating}</span><span className="min-w-0 flex-1 text-body"><Link prefetch={false} href={`/a/trainers/${r.trainerId}`} className="font-semibold hover:underline">{r.trainer}</Link><span className="block text-small text-ink-soft">{r.why}</span></span></li>)}</ul>, ratings.length)}
        {box("Watching", "No dogs on the watch list.", <ul className="divide-y divide-line">{watched.map((w, i) => <li key={i} className="px-4 py-2.5 text-body"><a href={w.link} className="font-semibold hover:underline">{w.dog}</a> ({w.client}, {w.trainer}): {w.reason}, day {w.days}<span className="block text-small text-ink-soft">This week: {w.since}{w.urgent ? `, ${w.urgent} urgent` : ""}{w.latest ? `. ${w.latest}` : ""}</span></li>)}</ul>, watched.length)}
        {box("Wins, last 7 days", "No client praise picked up this week.", <ul className="divide-y divide-line">{praise.map((w, i) => <li key={i} className="px-4 py-2.5 text-body"><a href={w.link} className="font-semibold hover:underline">{w.dog}</a> ({w.trainer}): <span className="text-ink-soft">{w.quote}</span></li>)}</ul>, praise.length)}
        {box("QA box, last 14 days", "Nobody flagged.", <ul className="divide-y divide-line">{(flags as { client: string; dog: string; reason: string; by: string; status: string; at: string }[]).map((f, i) => <li key={i} className="px-4 py-2.5 text-body">{f.client} / {f.dog}: {f.reason}<span className="block text-caption text-ink-faint">{f.by}, {day(f.at)} · {f.status === "hand" ? "to flag by hand in HubSpot" : f.status === "already" ? "was already flagged" : "ticked"}</span></li>)}</ul>, (flags as unknown[]).length)}
        {box("Case updates, last 7 days", "No case updates yet.", <ul className="divide-y divide-line">{(upd as { client: string; dog: string; text: string; by: string; at: string; for_sean: boolean; settled_at: string | null; booking_id: string | null }[]).map((u, i) => <li key={i} className="px-4 py-2.5 text-body"><a href={u.booking_id ? `/a/dogs/${u.booking_id}` : "#"} className="font-semibold hover:underline">{u.client} / {u.dog}</a>: {u.text}<span className="block text-caption text-ink-faint">{u.by}, {day(u.at)}{u.for_sean ? (u.settled_at ? " · was with Sean, settled" : " · with Sean") : ""}</span></li>)}</ul>, (upd as unknown[]).length)}
      </div>
    </>
  );
}
