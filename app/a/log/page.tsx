import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/data";
import { isDemo, serviceClient } from "@/lib/supabase";
import { LOG_VIEWERS } from "@/lib/audit";
import { etParts } from "@/lib/chatRules";
import { addDays } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Row = { at: string; who: string; role: string; kind: "action" | "message" | "signin" | "notify" | "problem"; what: string; detail: string; link: string | null; ok: boolean | null; error: string | null };
const ROLE_TONE: Record<string, string> = { admin: "bg-ink text-white", trainer: "bg-lav-deep text-white", client: "bg-paper text-ink", sales: "bg-biscuit-wash text-warn", "sign-in": "bg-white border border-line text-ink-soft", extension: "bg-white border border-line text-ink-soft", system: "bg-paper text-fern border border-line" };
const tm = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "America/New_York" });
const mins = (ms: number) => (ms < 3600e3 ? `${Math.max(1, Math.round(ms / 60e3))} min` : ms < 86400e3 ? `${(ms / 3600e3).toFixed(1)} h` : `${(ms / 86400e3).toFixed(1)} days`);
/** Midnight Eastern for a date, as a UTC moment (handles daylight saving). */
function etStart(d: string) {
  for (const off of [4, 5]) { const t = new Date(`${d}T${String(off).padStart(2, "0")}:00:00Z`); const p = etParts(t); if (p.date === d && p.hour === 0) return t; }
  return new Date(`${d}T05:00:00Z`);
}

// Activity log, only for LOG_VIEWERS (alma@dogwiseacademy.com): every action, sign-in, notification change and message for one day, in time order.
export default async function ActivityLog({ searchParams }: { searchParams: { d?: string; who?: string; type?: string; role?: string; q?: string; order?: string } }) {
  const v = await requireRole("admin");
  if (!v.email || !LOG_VIEWERS().includes(v.email.toLowerCase())) notFound();
  if (isDemo()) return <p className="panel p-6">Not available in demo mode.</p>;
  const today = etParts(new Date()).date, d = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.d || "") ? searchParams.d! : today;
  const from = etStart(d).toISOString(), to = etStart(addDays(d, 1)).toISOString();
  const sb = serviceClient();
  const [{ data: logs }, { data: chatMsgs }, { data: teamMsgs }] = await Promise.all([
    sb.from("audit_log").select("*").gte("at", from).lt("at", to).order("at").limit(3000),
    sb.from("chat_messages").select("id, created_at, chat_id, sender_id, sender_name, sender_role, kind, body, media, chats(title, client_name)").gte("created_at", from).lt("created_at", to).neq("sender_role", "system").order("created_at").limit(3000),
    sb.from("messages").select("id, created_at, trainer_id, sender_id, sender_role, sender_name, body, trainers(name)").gte("created_at", from).lt("created_at", to).order("created_at").limit(2000)
  ]);
  // Emails (and each admin's own name) next to every person, including admins' chat messages, which clients see as "Dogwise team"
  const chatRows = (chatMsgs || []) as unknown as { created_at: string; chat_id: string; sender_id: string | null; sender_name: string | null; sender_role: string; kind: string; body: string | null; media: { kind?: string }[] | null; chats: { title: string | null; client_name: string | null } | null }[];
  const teamRows = (teamMsgs || []) as unknown as { created_at: string; trainer_id: string; sender_id: string | null; sender_role: string; sender_name: string | null; body: string; trainers: { name: string } | null }[];
  const uids = [...new Set([
    ...((logs || []) as { user_id: string | null }[]).map((l) => l.user_id),
    ...chatRows.filter((m) => m.sender_role === "admin").map((m) => m.sender_id),
    ...teamRows.filter((m) => m.sender_role === "admin").map((m) => m.sender_id)
  ].filter((x): x is string => !!x))];
  const [{ data: em }, { data: profs }] = uids.length
    ? await Promise.all([sb.rpc("user_emails", { p_ids: uids }), sb.from("profiles").select("id, display_name").in("id", uids)])
    : [{ data: [] }, { data: [] }];
  const emailOf = new Map(((em || []) as { id: string; email: string }[]).map((x) => [x.id, x.email]));
  const nameOf = new Map(((profs || []) as { id: string; display_name: string | null }[]).map((x) => [x.id, x.display_name || ""]));
  const named = (who: string | null, uid: string | null) => { const e = uid ? emailOf.get(uid) : null; const w = who || "?"; return e && !w.includes("@") ? `${w} (${e})` : w; };
  const admin = (uid: string | null) => { if (!uid) return "Dogwise team (system)"; const n = nameOf.get(uid) || "Dogwise team", e = emailOf.get(uid); return e ? `${n} (${e})` : n; };
  const rows: Row[] = [
    ...((logs || []) as { at: string; who: string | null; role: string | null; action: string; detail: string | null; link: string | null; user_id: string | null; ok?: boolean | null; error?: string | null }[]).map((l): Row => ({
      at: l.at, who: named(l.who, l.user_id), role: l.role || "", what: l.action, detail: l.detail || "", link: l.link, ok: l.ok ?? null, error: l.error || null,
      kind: l.ok === false ? "problem" : /sign/i.test(l.action) ? "signin" : /notification/i.test(l.action) ? "notify" : "action"
    })),
    ...chatRows.map((m): Row => ({
      at: m.created_at, who: m.sender_role === "admin" ? admin(m.sender_id) : m.sender_name || m.sender_role, role: m.sender_role, kind: "message", what: `Message in ${m.chats?.title || "a"} chat (${m.chats?.client_name || "client"})`,
      detail: m.kind === "media" ? (m.media?.[0]?.kind === "file" ? "[file]" : "[photo or video]") : (m.body || "").slice(0, 300), link: `/a/chats/${m.chat_id}`, ok: null, error: null
    })),
    ...teamRows.map((m): Row => ({
      at: m.created_at, who: m.sender_role === "admin" ? admin(m.sender_id) : m.sender_name || m.sender_role, role: m.sender_role, kind: "message", what: m.sender_role === "trainer" ? "Trainer message to the team" : `Trainer message to ${m.trainers?.name || "a trainer"}`,
      detail: (m.body || "").slice(0, 300), link: `/a/messages/${m.trainer_id}`, ok: null, error: null
    }))
  ];
  // Filters
  const q = (searchParams.q || "").toLowerCase(), who = searchParams.who || "", type = searchParams.type || "", role = searchParams.role || "";
  const people = [...new Set(rows.map((r) => r.who))].sort();
  let list = rows.filter((r) => (!who || r.who === who) && (!type || r.kind === type) && (!role || r.role === role) && (!q || `${r.who} ${r.what} ${r.detail}`.toLowerCase().includes(q)));
  list.sort((a, b) => a.at.localeCompare(b.at));
  if (searchParams.order === "new") list = list.reverse();

  // Replies: each client message today, and when (and by whom) it was answered
  const clientMsgs = ((chatMsgs || []) as unknown as { id: string; created_at: string; chat_id: string; sender_role: string; body: string | null; kind: string; chats: { title: string | null; client_name: string | null } | null }[]).filter((m) => m.sender_role === "client");
  const chatIds = [...new Set(clientMsgs.map((m) => m.chat_id))];
  const { data: after } = chatIds.length ? await sb.from("chat_messages").select("chat_id, created_at, sender_id, sender_role, sender_name").in("chat_id", chatIds).gte("created_at", from).neq("sender_role", "client").neq("sender_role", "system").order("created_at").limit(5000) : { data: [] };
  const replies = clientMsgs.map((m) => {
    const r = ((after || []) as { chat_id: string; created_at: string; sender_id: string | null; sender_role: string; sender_name: string | null }[]).find((x) => x.chat_id === m.chat_id && x.created_at > m.created_at);
    return { m, r, wait: (r ? new Date(r.created_at).getTime() : Date.now()) - new Date(m.created_at).getTime() };
  }).sort((a, b) => Number(!!a.r) - Number(!!b.r) || b.wait - a.wait);

  // Per person: how much, first and last
  const byPerson = people.map((p) => { const mine = rows.filter((r) => r.who === p); return { p, role: mine[0]?.role || "", n: mine.length, msgs: mine.filter((r) => r.kind === "message").length, first: mine[0]?.at, last: mine[mine.length - 1]?.at }; }).sort((a, b) => b.n - a.n);

  const qs = (o: Record<string, string>) => { const p = new URLSearchParams({ d, ...(who && { who }), ...(type && { type }), ...(role && { role }), ...(q && { q }), ...(searchParams.order && { order: searchParams.order }), ...o }); [...p.entries()].forEach(([k, val]) => { if (!val) p.delete(k); }); return `/a/log?${p}`; };
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-h1 font-extrabold leading-tight">Activity log</h1><p className="text-ink-soft">Only you can see this. Times are Eastern.</p></div>
        <div className="flex items-center gap-2">
          <Link prefetch={false} href={qs({ d: addDays(d, -1) })} className="btn-ghost h-9 min-h-0 px-3 text-small">← Day before</Link>
          {d < today && <Link prefetch={false} href={qs({ d: addDays(d, 1) })} className="btn-ghost h-9 min-h-0 px-3 text-small">Next day →</Link>}
        </div>
      </div>

      <form className="panel mt-4 grid gap-2 p-3 sm:grid-cols-6" method="get">
        <input type="date" name="d" defaultValue={d} max={today} className="field sm:col-span-1" />
        <select name="who" defaultValue={who} className="field sm:col-span-2"><option value="">Everyone</option>{people.map((p) => <option key={p}>{p}</option>)}</select>
        <select name="role" defaultValue={role} className="field"><option value="">All roles</option>{["admin", "trainer", "client", "sales", "sign-in", "extension", "system"].map((r) => <option key={r}>{r}</option>)}</select>
        <select name="type" defaultValue={type} className="field"><option value="">Everything</option><option value="problem">Problems (failed or refused)</option><option value="action">Actions</option><option value="message">Messages</option><option value="signin">Sign-ins</option><option value="notify">Notifications</option></select>
        <select name="order" defaultValue={searchParams.order || ""} className="field"><option value="">Oldest first</option><option value="new">Newest first</option></select>
        <input name="q" defaultValue={q} placeholder="Search text…" className="field sm:col-span-5" />
        <button className="btn-ink">Show</button>
      </form>

      <details className="panel mt-4 p-4" open>
        <summary className="cursor-pointer font-bold">Client messages and replies <span className="count">{replies.length}</span></summary>
        {replies.length ? (
          <ul className="mt-2 divide-y divide-line text-body">
            {replies.map(({ m, r, wait }) => (
              <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span><span className="font-semibold">{tm(m.created_at)}</span> {m.chats?.client_name || "Client"} ({m.chats?.title || "dog"}): <span className="text-ink-soft">{m.kind === "media" ? "[photo or video]" : (m.body || "").slice(0, 90)}</span></span>
                <Link prefetch={false} href={`/a/chats/${m.chat_id}`} className={`font-semibold ${!r ? "text-heart" : wait > 3 * 3600e3 ? "text-warn" : "text-fern"}`}>{r ? `replied by ${r.sender_role === "admin" ? admin(r.sender_id) : r.sender_name || r.sender_role} after ${mins(wait)}` : `no reply yet (${mins(wait)})`}</Link>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-body text-ink-soft">No client messages this day.</p>}
      </details>

      <details className="panel mt-3 p-4">
        <summary className="cursor-pointer font-bold">Who did what <span className="count">{byPerson.length}</span></summary>
        <ul className="mt-2 divide-y divide-line text-body">
          {byPerson.map((x) => (
            <li key={x.p} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link prefetch={false} href={qs({ who: x.p })} className="font-semibold underline">{x.p}</Link>
              <span className="text-ink-soft">{x.role} · {x.n} things ({x.msgs} messages) · {x.first ? tm(x.first) : ""} to {x.last ? tm(x.last) : ""}</span>
            </li>
          ))}
        </ul>
      </details>

      <h2 className="group-title">{list.length} entr{list.length === 1 ? "y" : "ies"}</h2>
      <ul className="panel divide-y divide-line overflow-hidden">
        {list.map((r, i) => (
          <li key={i} className="grid gap-x-3 gap-y-0.5 p-3 text-body sm:grid-cols-[92px_1fr]">
            <span className="font-mono text-caption text-ink-faint sm:pt-0.5">{tm(r.at)}</span>
            <div className="min-w-0">
              <p><span className={`mr-1.5 rounded-full px-2 py-0.5 text-micro font-bold ${ROLE_TONE[r.role] || "bg-paper text-ink-soft"}`}>{r.role || "?"}</span><span className="font-semibold">{r.who}</span> {r.what}</p>
              {r.detail && <p className="mt-0.5 break-words text-ink-soft">{r.detail}</p>}
              {r.ok === false && <p className="mt-0.5 break-words font-semibold text-heart">Didn&apos;t work{r.error ? `: ${r.error}` : ""}</p>}
              {r.link && <Link prefetch={false} href={r.link} className="text-caption font-semibold underline">Open</Link>}
            </div>
          </li>
        ))}
        {!list.length && <li className="p-6 text-center text-ink-soft">Nothing for this day{who || type || role || q ? " with these filters" : ""}.</li>}
      </ul>
      <p className="mt-3 text-caption text-ink-faint">Actions are recorded from when the log was switched on. Messages go back as far as the app has them.</p>
    </>
  );
}
