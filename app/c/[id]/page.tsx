import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/data";
import { getChat, listChatMessages } from "@/lib/chatData";
import { isDemo } from "@/lib/supabase";
import { ChatThread } from "@/components/ChatThread";

export default async function ClientChat({ params }: { params: { id: string } }) {
  const v = await requireRole("client");
  const chat = await getChat(params.id);
  if (!chat || chat.client_user_id !== v.userId) notFound();
  const { messages, hasMore } = await listChatMessages(chat.id);
  return (
    <>
      <h1 className="text-[26px] font-extrabold leading-tight">{chat.title || "Your dog"}</h1>
      <p className="mb-4 text-[14px] text-ink-soft">{chat.trainer_name ? `Training with ${chat.trainer_name}. ` : ""}<Link href="/c" className="underline">All chats</Link></p>
      <ChatThread chatId={chat.id} me={{ userId: v.userId, role: "client", name: v.name }} initial={messages} hasMore={hasMore} open={chat.status === "open"} folderUrl={chat.drive_folder_url} demo={isDemo()} withBottomNav={false} otherLabel={`${chat.trainer_name || "your trainer"} and the Dogwise team`} />
    </>
  );
}
