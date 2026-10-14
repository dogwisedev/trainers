import { redirect } from "next/navigation";
import { requireRole } from "@/lib/data";
import { getChat } from "@/lib/chatData";
import { isDemo, serviceClient } from "@/lib/supabase";

// The admin Dog profile is now the "Before training" tab of the dog page.
export default async function Page({ params, searchParams }: { params: { id: string }; searchParams: { dog?: string } }) {
  await requireRole("admin");
  if (searchParams.dog) redirect(`/a/dogs/${searchParams.dog}?tab=before`);
  const chat = await getChat(params.id);
  if (!chat || isDemo()) redirect(`/a/chats/${params.id}`);
  const { data } = await serviceClient().from("bookings").select("id").or(/^\d+$/.test(chat.deal_key) ? `hubspot_deal_id.eq.${chat.deal_key}` : `id.eq.${chat.deal_key}`).neq("status", "cancelled").order("start_date").limit(1);
  redirect(data?.[0] ? `/a/dogs/${data[0].id}?tab=before` : `/a/chats/${params.id}`);
}
