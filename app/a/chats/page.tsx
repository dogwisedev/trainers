import Link from "next/link";
import { Users } from "lucide-react";
import { IconTile } from "@/components/ui";
import { requireRole, unreadForAdmin } from "@/lib/data";
import { chatSpans, listChats, searchChatMessages } from "@/lib/chatData";
import { chatUnread } from "@/lib/chatTypes";
import { datesLabel, groupChats, nameMatches, orderChats } from "@/lib/chatOrder";
import { etParts } from "@/lib/chatRules";
import { ChatGroupTitle, ChatListRow } from "@/components/ChatBits";
import { ChatFilters } from "@/components/ChatFilters";
import { Empty } from "@/components/ui";

export default async function AdminChats({ searchParams }: { searchParams: { f?: string; t?: string; q?: string } }) {
  await requireRole("admin");
  const q = (searchParams.q || "").trim(), t = searchParams.t || "";
  const [all, teamUnread, hits] = await Promise.all([listChats(), unreadForAdmin(), q ? searchChatMessages(q) : Promise.resolve(new Map<string, string>())]);
  const closed = searchParams.f === "closed";
  const trainers = [...new Map(all.filter((c) => c.trainer_id).map((c) => [c.trainer_id!, c.trainer_name || "Trainer"])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const scoped = all.filter((c) => (!t || c.trainer_id === t) && (!q || nameMatches(c, q) || hits.has(c.id)));
  const chats = scoped.filter((c) => (closed ? c.status === "closed" : c.status === "open"));
  const placed = orderChats(chats, await chatSpans(chats.map((c) => c.deal_key)), etParts(new Date()).date);
  const tab = (k: string) => { const p = new URLSearchParams(); if (k) p.set("f", k); if (t) p.set("t", t); if (q) p.set("q", q); const s = p.toString(); return s ? `/a/chats?${s}` : "/a/chats"; };
  return (
    <>
      <h1 className="text-[30px] font-extrabold">Chats</h1>
      <p className="mb-4 mt-1 text-ink-soft">One chat per booking: the client, the trainer and the whole Dogwise team. Any admin can open any chat.</p>
      <Link href="/a/messages" className="panel mb-4 flex items-center gap-3 px-3.5 py-3 hover:bg-paper/60">
        <IconTile tone="ink"><Users size={19} /></IconTile>
        <span className="min-w-0 flex-1"><span className="block font-bold">Trainer messages</span><span className="block text-[13px] text-ink-soft">Direct messages with trainers</span></span>
        {teamUnread > 0 && <span className="grid h-[22px] min-w-[22px] place-items-center rounded-full bg-heart px-1.5 text-[12px] font-bold text-white">{teamUnread}</span>}
      </Link>
      <ChatFilters base="/a/chats" q={q} t={t} f={closed ? "closed" : undefined} trainers={trainers} />
      <div className="mb-4 flex gap-2">
        {[["", "Open", scoped.filter((c) => c.status === "open").length], ["closed", "Closed", scoped.filter((c) => c.status === "closed").length]].map(([k, l, n]) => (
          <Link key={String(k)} href={tab(String(k))} className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${(k === "closed") === closed ? "bg-ink text-white" : "border border-line bg-white"}`}>{l} <span className="opacity-70">{n}</span></Link>
        ))}
      </div>
      {placed.length ? groupChats(placed).map((g) => (
        <section key={g.group}>
          <ChatGroupTitle label={g.label} count={g.items.length} />
          <ul className="panel divide-y divide-line">
            {g.items.map((p) => { const c = p.chat; return <ChatListRow key={c.id} chat={c} href={`/a/chats/${c.id}`} unread={chatUnread(c, "admin")} who={`${c.client_name || "Client"}, ${c.trainer_name || "no trainer"}`} flag={!c.client_user_id ? "No client email" : !c.invited_at ? "Not invited" : undefined} dates={datesLabel(p)} preview={hits.get(c.id)} />; })}
          </ul>
        </section>
      )) : q || t ? <Empty title="No chats match.">{q ? "Closed chats are archived to Drive, so only their names can be searched." : ""}</Empty>
        : <Empty title={closed ? "No closed chats." : "No chats yet."}>{closed ? "" : "A chat is created for each new booking, or start one from a booking on the trainer's page."}</Empty>}
    </>
  );
}
