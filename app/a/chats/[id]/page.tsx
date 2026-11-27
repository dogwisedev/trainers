import Link from "next/link";
import { Pill } from "@/components/ui";
import { QuietChatButton } from "@/components/QuietChatButton";
import { QUIET_LABEL, canQuiet } from "@/lib/quietChats";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireRole } from "@/lib/data";
import { getChat } from "@/lib/chatData";
import { short } from "@/lib/dates";
import { trainingOver } from "@/lib/chatOps";
import { isDemo, serviceClient } from "@/lib/supabase";
import { CloseChat } from "@/components/ChatActions";
import { AdminChatInfo, AdminChatPanel, clientAccessProblem } from "@/components/AdminChatPanel";
import { ChatHeader } from "@/components/ChatHeader";
import { dogPage, hubspotDeal } from "@/lib/todo";

export const maxDuration = 60; // closing a chat saves to Drive and emails the client

export default async function AdminChat({ params }: { params: { id: string } }) {
  const v = await requireRole("admin");
  const chat = await getChat(params.id);
  const over = chat && !isDemo() ? await trainingOver(chat.id) : null;
  const closeAfter = over && !over.over ? (over.lastDropOff ? short(over.lastDropOff) : "the last drop-off") : null;
  if (!chat) notFound();
  // The dog(s) this chat is about: one link per dog to its dog page
  const { data: dogs } = isDemo() ? { data: [] } : await serviceClient().from("bookings").select("id, dog_name, status").or(/^\d+$/.test(chat.deal_key) ? `hubspot_deal_id.eq.${chat.deal_key}` : `id.eq.${chat.deal_key}`).order("start_date");
  const deal = hubspotDeal(chat.deal_key);
  return (
    <>
      <ChatHeader backHref="/a/chats" title={chat.title || "Dog"} attention={clientAccessProblem(chat)} openAtStart={!!clientAccessProblem(chat)}
        subtitle={<>{chat.client_name || "?"} · {chat.trainer_id ? <Link prefetch={false} className="underline" href={`/a/trainers/${chat.trainer_id}`}>{chat.trainer_name}</Link> : "no trainer"}{chat.quiet_at ? " · quiet" : ""}</>}
        info={
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              {((dogs || []) as { id: string; dog_name: string | null; status: string }[]).filter((d) => d.status !== "cancelled").map((d, _, all) => (
                <Link key={d.id} prefetch={false} href={dogPage(d.id)} className="btn-ghost h-9 min-h-0 px-3 text-small">{all.length > 1 ? d.dog_name || "Dog" : "Dog page"}</Link>
              ))}
              {deal && <a href={deal} target="_blank" rel="noopener" className="btn-ghost h-9 min-h-0 px-3 text-small">HubSpot<ExternalLink size={13} /></a>}
              {chat.quiet_at && <Pill tone="line">{QUIET_LABEL}</Pill>}
            </div>
            <AdminChatInfo chat={chat} />
            {chat.status === "open" && (
              <div className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-line pt-3">
                {canQuiet(v.email) && <QuietChatButton chatId={chat.id} quiet={!!chat.quiet_at} />}
                <CloseChat chatId={chat.id} title={chat.title || "this dog"} after={closeAfter} />
              </div>
            )}
          </>
        } />
      <AdminChatPanel chat={chat} me={{ userId: v.userId, name: v.name }} access={false} />
    </>
  );
}
