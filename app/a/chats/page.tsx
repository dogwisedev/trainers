import Link from "next/link";
import { ResendInvites } from "@/components/ResendInvites";
import { isDemo, serviceClient } from "@/lib/supabase";
import { ChatsSwitch } from "@/components/ChatsSwitch";
import { requireRole, unreadForAdmin } from "@/lib/data";
import { chatSpans, listChats, searchChatMessages } from "@/lib/chatData";
import { chatUnread } from "@/lib/chatTypes";
import { datesLabel, groupChats, groupWithUnread, nameMatches, orderChats } from "@/lib/chatOrder";
import { etParts } from "@/lib/chatRules";
import { ChatGroupTitle, ChatListRow } from "@/components/ChatBits";
import { ChatFilters } from "@/components/ChatFilters";
import { Empty } from "@/components/ui";

export default async function AdminChats({ searchParams }: { searchParams: { f?: string; t?: string; q?: string; j?: string; o?: string } }) {
  await requireRole("admin");
  const q = (searchParams.q || "").trim(), t = searchParams.t || "";
  const [all, teamUnread, hits] = await Promise.all([listChats(), unreadForAdmin(), q ? searchChatMessages(q) : Promise.resolve(new Map<string, string>())]);
  const closed = searchParams.f === "closed";
  const trainers = [...new Map(all.filter((c) => c.trainer_id).map((c) => [c.trainer_id!, c.trainer_name || "Trainer"])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const scoped = all.filter((c) => (!t || c.trainer_id === t) && (!q || nameMatches(c, q) || hits.has(c.id)));
  // Has the client joined? (opened their chat at least once)
  const clientIds = scoped.map((c) => c.client_user_id).filter((x): x is string => !!x);
  const { data: reads } = clientIds.length && !isDemo() ? await serviceClient().from("chat_reads").select("chat_id, user_id, last_read_at").in("user_id", clientIds) : { data: [] };
  const seen = new Map(((reads || []) as { chat_id: string; user_id: string; last_read_at: string }[]).filter((r) => scoped.some((c) => c.id === r.chat_id && c.client_user_id === r.user_id)).map((r) => [r.chat_id, r.last_read_at]));
  const joined = (c: (typeof scoped)[number]) => seen.has(c.id);
  const who2 = searchParams.j || "";
  const chats = scoped.filter((c) => (closed ? c.status === "closed" : c.status === "open") && (!who2 || (who2 === "yes" ? joined(c) : !joined(c))));
  const by = searchParams.o === "dates" ? "dates" : "latest"; // inside each group: newest message first, or "By dates"
  const placed = orderChats(chats, await chatSpans(chats.map((c) => c.deal_key)), etParts(new Date()).date, by);
  const orderHref = (o: "latest" | "dates") => { const p = new URLSearchParams(); if (closed) p.set("f", "closed"); if (t) p.set("t", t); if (q) p.set("q", q); if (who2) p.set("j", who2); if (o === "dates") p.set("o", "dates"); const s = p.toString(); return s ? `/a/chats?${s}` : "/a/chats"; };
  const tab = (k: string) => { const p = new URLSearchParams(); if (k) p.set("f", k); if (t) p.set("t", t); if (q) p.set("q", q); if (searchParams.o === "dates") p.set("o", "dates"); const s = p.toString(); return s ? `/a/chats?${s}` : "/a/chats"; };
  return (
    <>
      <h1 className="mb-3 text-h1 font-extrabold">Chats</h1>
      <ChatsSwitch on="clients" clientUnread={all.filter((c) => c.status === "open" && chatUnread(c, "admin")).length} trainerUnread={teamUnread} />
      <p className="mb-4 text-ink-soft">One chat per dog, with the owner, the trainer and the team.</p>
      <ChatFilters base="/a/chats" q={q} t={t} f={closed ? "closed" : undefined} trainers={trainers} />
      <div className="mb-4 flex flex-wrap gap-2">
        {[["", "Open", scoped.filter((c) => c.status === "open").length], ["closed", "Closed", scoped.filter((c) => c.status === "closed").length]].map(([k, l, n]) => (
          <Link key={String(k)} prefetch={false} href={tab(String(k))} className={`rounded-full px-3.5 py-1.5 text-small font-semibold ${(k === "closed") === closed ? "bg-ink text-white" : "border border-line bg-white"}`}>{l} <span className="opacity-70">{n}</span></Link>
        ))}
        {!closed && ([["yes", "Client joined"], ["no", "Not joined yet"]] as const).map(([k, l]) => {
          const n = scoped.filter((c) => c.status === "open" && (k === "yes" ? joined(c) : !joined(c))).length;
          const p = new URLSearchParams(); if (t) p.set("t", t); if (q) p.set("q", q); if (who2 !== k) p.set("j", k); if (searchParams.o === "dates") p.set("o", "dates");
          return <Link prefetch={false} key={k} href={`/a/chats${p.toString() ? `?${p}` : ""}`} className={`rounded-full px-3.5 py-1.5 text-small font-semibold ${who2 === k ? "bg-lav-deep text-white" : "border border-line bg-white"}`}>{l} <span className="opacity-70">{n}</span></Link>;
        })}
      </div>
      <div className="mb-4 flex items-center gap-2 text-small" role="group" aria-label="Order inside each group">
        <span className="text-ink-soft">Order:</span>
        {([["latest", "Newest message first"], ["dates", "By dates"]] as const).map(([k, l]) => (
          <Link key={k} prefetch={false} href={orderHref(k)} aria-current={by === k ? "true" : undefined}
            className={`rounded-full px-3 py-1 font-semibold ${by === k ? "bg-ink text-white" : "border border-line bg-white text-ink-soft"}`}>{l}</Link>
        ))}
      </div>
      {!closed && who2 === "no" && <ResendInvites chatIds={chats.filter((c) => c.client_email).map((c) => c.id)} />}
      {placed.length ? groupWithUnread(placed, (c) => chatUnread(c, "admin")).map((g) => (
        <section key={g.group}>
          <ChatGroupTitle label={g.label} count={g.items.length} />
          <ul className="panel divide-y divide-line">
            {g.items.map((p) => { const c = p.chat; return <ChatListRow key={c.id} chat={c} href={`/a/chats/${c.id}`} unread={chatUnread(c, "admin")} who={`${c.client_name || "Client"}, ${c.trainer_name || "no trainer"}`} flag={!c.client_user_id ? "No client email" : !c.invited_at ? "Not invited" : !joined(c) ? "Not joined yet" : undefined} dates={datesLabel(p)} preview={hits.get(c.id)} />; })}
          </ul>
        </section>
      )) : q || t ? <Empty title="No chats match.">{q ? "Closed chats are archived to Drive, so only their names can be searched." : ""}</Empty>
        : <Empty title={closed ? "No closed chats." : "No chats yet."}>{closed ? "" : "A chat is created for each new booking, or start one from a booking on the trainer's page."}</Empty>}
    </>
  );
}
