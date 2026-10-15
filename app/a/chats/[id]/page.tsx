import Link from "next/link";
import { Avatar } from "@/components/ui";
import { notFound } from "next/navigation";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { requireRole } from "@/lib/data";
import { getChat } from "@/lib/chatData";
import { isDemo, serviceClient } from "@/lib/supabase";
import { CloseChat } from "@/components/ChatActions";
import { AdminChatPanel } from "@/components/AdminChatPanel";
import { dogPage, hubspotDeal } from "@/lib/todo";

export const maxDuration = 60; // closing a chat saves to Drive and emails the client

export default async function AdminChat({ params }: { params: { id: string } }) {
  const v = await requireRole("admin");
  const chat = await getChat(params.id);
  if (!chat) notFound();
  // The dog(s) this chat is about: one link per dog to its dog page
  const { data: dogs } = isDemo() ? { data: [] } : await serviceClient().from("bookings").select("id, dog_name, status").or(/^\d+$/.test(chat.deal_key) ? `hubspot_deal_id.eq.${chat.deal_key}` : `id.eq.${chat.deal_key}`).order("start_date");
  const deal = hubspotDeal(chat.deal_key);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/a/chats" className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="All chats"><ChevronLeft /></Link>
        <Avatar name={chat.title || "Dog"} size={42} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[24px] font-extrabold leading-tight">{chat.title || "Dog"}</h1>
          <p className="truncate text-[14px] text-ink-soft">Client {chat.client_name || "?"}, trainer {chat.trainer_id ? <Link className="underline" href={`/a/trainers/${chat.trainer_id}`}>{chat.trainer_name}</Link> : "none"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {((dogs || []) as { id: string; dog_name: string | null; status: string }[]).filter((d) => d.status !== "cancelled").map((d, _, all) => (
            <Link key={d.id} href={dogPage(d.id)} className="btn-ghost h-9 min-h-0 px-3 text-[13px]">{all.length > 1 ? d.dog_name || "Dog" : "Dog page"}</Link>
          ))}
          {deal && <a href={deal} target="_blank" rel="noopener" className="btn-ghost h-9 min-h-0 px-3 text-[13px]">HubSpot<ExternalLink size={13} /></a>}
          {chat.status === "open" && <CloseChat chatId={chat.id} title={chat.title || "this dog"} />}
        </div>
      </div>
      <AdminChatPanel chat={chat} me={{ userId: v.userId, name: v.name }} />
    </>
  );
}
