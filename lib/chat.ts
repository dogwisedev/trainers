import "server-only";
import { serviceClient } from "./supabase";
import { ensureClientUser, sendChatInvite } from "./authEmail";
import { ensureChatFolder, driveConfigured, uploadFile } from "./drive";
import { dealKey, MediaRef } from "./chatTypes";
import { Booking } from "./types";

// Booking chats, created by the server. One chat per HubSpot deal (a two-dog booking is one chat).
// Clients are emailed their chat link automatically 7 days before training (lib/autoInvite.ts; CHAT_AUTO_INVITE=off to stop it).
// A dog with a HubSpot deal that reaches that point with no chat (e.g. booked before chats existed) gets one made then.
// Admins can still send it any time with the "Invite client" button.

type B = Pick<Booking, "id" | "trainer_id" | "client_name" | "dog_name" | "hubspot_deal_id"> & { client_email?: string | null };
export type EnsureResult = { chatId: string; created: boolean; invited: boolean; note?: string };

export async function ensureChatsForBookings(bookings: B[], opts: { invite?: boolean } = {}): Promise<EnsureResult[]> {
  const sb = serviceClient();
  const groups = new Map<string, B[]>();
  for (const b of bookings) groups.set(dealKey(b), [...(groups.get(dealKey(b)) || []), b]);
  const out: EnsureResult[] = [];

  for (const [key, list] of groups) {
    const first = list[0];
    const dogs = [...new Set(list.map((b) => (b.dog_name || "").trim()).filter(Boolean))];
    const email = (list.map((b) => b.client_email).find(Boolean) || "").trim().toLowerCase();
    let created = false, note: string | undefined;
    let { data: chat } = await sb.from("chats").select("*").eq("deal_key", key).eq("status", "open").maybeSingle();
    if (!chat) {
      const { data: t } = await sb.from("trainers").select("name").eq("id", first.trainer_id).maybeSingle();
      const ins = await sb.from("chats").insert({ deal_key: key, trainer_id: first.trainer_id, trainer_name: t?.name || null, client_name: first.client_name, client_email: email || null, title: dogs.join(" & ") || "Dog" }).select("*").single();
      if (ins.error) { // lost a race with another request: use the chat that now exists
        const again = await sb.from("chats").select("*").eq("deal_key", key).eq("status", "open").maybeSingle();
        if (!again.data) throw new Error(ins.error.message);
        chat = again.data;
      } else { chat = ins.data; created = true; await postWelcome(ins.data.id, ins.data.title || "your dog", ins.data.trainer_name); }
    }
    if (!chat) continue;
    // Attach the client's login once we know their email
    if (!chat.client_user_id && (email || chat.client_email)) {
      try {
        const addr = (email || chat.client_email).toLowerCase();
        const uid = await ensureClientUser(addr);
        await sb.from("profiles").upsert({ id: uid, role: "client", display_name: chat.client_name }, { onConflict: "id", ignoreDuplicates: true });
        await sb.from("chats").update({ client_user_id: uid, client_email: addr }).eq("id", chat.id);
        chat.client_user_id = uid; chat.client_email = addr;
      } catch (e) { note = (e as Error).message; }
    }
    let invited = false;
    if (opts.invite && chat.client_user_id && chat.client_email && !chat.invited_at) {
      try {
        await sendChatInvite({ email: chat.client_email, clientName: chat.client_name || "", title: chat.title || "your dog", trainerName: chat.trainer_name || "", chatId: chat.id });
        await sb.from("chats").update({ invited_at: new Date().toISOString() }).eq("id", chat.id);
        invited = true;
      } catch (e) { note = (e as Error).message; }
    }
    out.push({ chatId: chat.id, created, invited, note });
  }
  return out;
}

/** Writes a message as "the system" (report cards, notices). Signed-in people can't do this; only the server can. */
export async function postSystemMessage(chatId: string, m: { kind: "system" | "report"; body: string; media?: MediaRef[]; reportId?: string | null }) {
  const { error } = await serviceClient().from("chat_messages").insert({ chat_id: chatId, sender_role: "system", sender_name: "Dogwise", kind: m.kind, body: m.body, media: m.media || [], report_id: m.reportId || null });
  if (error) throw new Error(error.message);
}

/** When a report is approved, drop it in the booking's chat (PDF saved to the chat's Drive folder). Never blocks the approval. */
export async function postReportToChat(booking: B, report: { id: string; title: string }, pdf: Uint8Array, extra: { name: string; pdf: Uint8Array }[] = []) {
  try {
    const sb = serviceClient();
    const { data: chat } = await sb.from("chats").select("*").eq("deal_key", dealKey(booking)).eq("status", "open").maybeSingle();
    if (!chat) return;
    let media: MediaRef[] = [];
    if (driveConfigured()) {
      let folderId = chat.drive_folder_id as string | null;
      if (!folderId) { const f = await ensureChatFolder(chat); folderId = f.id; await sb.from("chats").update({ drive_folder_id: f.id, drive_folder_url: f.url }).eq("id", chat.id); }
      const name = `${report.title} ${new Date().toISOString().slice(0, 10)}.pdf`;
      media = [{ id: await uploadFile(folderId, name, "application/pdf", pdf), name, kind: "file", size: pdf.byteLength }];
      for (const x of extra) media.push({ id: await uploadFile(folderId, x.name, "application/pdf", x.pdf), name: x.name, kind: "file", size: x.pdf.byteLength });
    }
    await postSystemMessage(chat.id, { kind: "report", body: report.title, media, reportId: report.id });
  } catch { /* the report email already went out; the chat card is a bonus */ }
}

/** The welcome note at the top of a chat (client and trainer both see it). Posted once per chat. */
export function welcomeText(dog: string, trainer: string | null) {
  return `👋 Welcome to ${dog}'s chat! This is where you, ${trainer || "your trainer"} and the Dogwise team talk about ${dog}.\n\n`
    + `• Updates, photos and videos of ${dog} are posted here every day.\n`
    + `• Type in the box at the bottom to send a message. Tap the paperclip to send a photo, video or PDF.\n`
    + `• You'll get an email (and a phone notification, if you turn them on) when there's something new.`;
}
export async function postWelcome(chatId: string, dog: string, trainer: string | null) {
  const sb = serviceClient();
  const { data } = await sb.from("chat_messages").select("id").eq("chat_id", chatId).eq("kind", "system").like("body", "👋 Welcome to%").limit(1);
  if (data?.length) return;
  await postSystemMessage(chatId, { kind: "system", body: welcomeText(dog, trainer) }).catch(() => {});
}
