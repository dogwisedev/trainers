import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/data";
import { getChat } from "@/lib/chatData";
import { isDemo, serviceClient } from "@/lib/supabase";
import { etParts } from "@/lib/chatRules";
import { IncidentReportForm } from "@/components/IncidentReportForm";

// Trainer: report an incident for the dog(s) in this chat.
export default async function ReportIncident({ params }: { params: { id: string } }) {
  const v = await requireRole("trainer");
  const chat = await getChat(params.id);
  if (!chat || chat.trainer_id !== v.trainerId) notFound();
  const { data } = isDemo() ? { data: [] } : await serviceClient().from("bookings").select("id, dog_name").or(/^\d+$/.test(chat.deal_key) ? `hubspot_deal_id.eq.${chat.deal_key}` : `id.eq.${chat.deal_key}`).neq("status", "cancelled");
  const dogs = ((data || []) as { id: string; dog_name: string | null }[]).map((b) => ({ id: b.id, name: b.dog_name || "Dog" }));
  const p = etParts(new Date()), now = `${p.date}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Link prefetch={false} href={`/t/chats/${chat.id}`} className="grid h-10 w-10 place-items-center rounded-full hover:bg-mint-wash" aria-label="Back to the chat"><ChevronLeft /></Link>
        <div className="min-w-0"><h1 className="truncate text-h2 font-extrabold leading-tight">Report an incident</h1><p className="truncate text-body text-ink-soft">{chat.title || "Dog"}, {chat.client_name}</p></div>
      </div>
      <IncidentReportForm chatId={chat.id} dogs={dogs} now={now} back={`/t/chats/${chat.id}`} />
    </>
  );
}
