"use server";
import { revalidatePath } from "next/cache";
import { audited } from "@/lib/audit";
import { getViewer } from "@/lib/data";
import { isDemo, serverClient, serviceClient } from "@/lib/supabase";
import { SESSIONS, bookingForChat, clearFollowupTodos, followupState, writeSessionDate } from "@/lib/followups";
import { dayET } from "@/lib/pulseMath";

type R = { ok: boolean; message: string };
const DEMO: R = { ok: false, message: "Demo mode: nothing is saved." };
const PARTS = ["Morning", "Afternoon", "Evening", "Any time"];
const prettyDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** Client: ask for the next follow-up session, with up to 3 preferred days (and a part of the day each). */
export async function requestFollowupAction(chatId: string, options: { day: string; part: string }[], note: string): Promise<R> {
  return audited("requestFollowupAction", { chatId, options, note }, async () => {
  if (isDemo()) return DEMO;
  const v = await getViewer();
  if (!v || v.role !== "client") return { ok: false, message: "Please sign in." };
  const sb = serviceClient();
  const { data: chat } = await sb.from("chats").select("id, deal_key, client_user_id, status").eq("id", chatId).maybeSingle();
  if (!chat || chat.client_user_id !== v.userId || chat.status !== "open") return { ok: false, message: "This chat isn't available." };
  const bookingId = await bookingForChat(chat.deal_key, sb);
  const st = bookingId ? await followupState(bookingId, sb) : null;
  if (!st || !st.handedOver) return { ok: false, message: "Follow-ups can be booked once the training is complete." };
  if (st.sessions.some((s) => s.status === "requested")) return { ok: false, message: "You've already asked: your trainer will reply here with a time." };
  if (!st.nextN) return { ok: false, message: `All ${SESSIONS} follow-up sessions are booked. Message us here for anything else.` };
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const opts = options.filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.day) && o.day >= tomorrow && PARTS.includes(o.part)).slice(0, 3);
  if (!opts.length) return { ok: false, message: "Pick at least one day, from tomorrow on." };
  const { error } = await sb.from("followups").insert({ booking_id: st.bookingId, chat_id: chatId, n: st.nextN, status: "requested", requested_by: "client", options: opts, note: note.trim().slice(0, 1000) || null });
  if (error) return { ok: false, message: /followups|schema cache/i.test(error.message) ? "Follow-up booking isn't switched on yet." : error.message };
  // Posted as the client, so the trainer is notified exactly as for any message
  const body = `📅 Follow-up session ${st.nextN}: I'd like to book it. Days that suit me:\n${opts.map((o) => `• ${prettyDay(o.day)}, ${o.part.toLowerCase()}`).join("\n")}${note.trim() ? `\n\n${note.trim()}` : ""}`;
  await serverClient().from("chat_messages").insert({ chat_id: chatId, kind: "text", body });
  revalidatePath(`/c/${chatId}`);
  return { ok: true, message: `Sent. ${st.trainer.split(" ")[0]} will reply here with a time.` };
});
}

/**
 * Trainer (or the office): confirm a session at a date and time, or set one up directly, or change one.
 * `label` is the time as the trainer typed it ("Tue, Nov 18, 10:00 AM"), shown to the client as is.
 */
export async function confirmFollowupAction(bookingId: string, followupId: string | null, atIso: string, label: string): Promise<R> {
  return audited("confirmFollowupAction", { bookingId, followupId, atIso, label }, async () => {
  if (isDemo()) return DEMO;
  const v = await getViewer();
  if (!v || (v.role !== "trainer" && v.role !== "admin")) return { ok: false, message: "Trainers and the office only." };
  const sb = serviceClient();
  const st = await followupState(bookingId, sb);
  if (!st) return { ok: false, message: "Booking not found." };
  if (v.role === "trainer" && st.trainerId !== v.trainerId) return { ok: false, message: "That dog isn't one of yours." };
  const at = new Date(atIso);
  if (isNaN(at.getTime()) || at.getTime() < Date.now() - 3600e3) return { ok: false, message: "Pick a date and time from now on." };
  let row = followupId ? st.sessions.find((s) => s.id === followupId) : null;
  if (followupId && (!row || !["requested", "confirmed"].includes(row.status))) return { ok: false, message: "That session can't be changed now." };
  const n = row?.n ?? st.nextN;
  if (!n) return { ok: false, message: `All ${SESSIONS} sessions are booked.` };
  const { data: chat } = await sb.from("chats").select("id, status").eq("deal_key", st.dealId || bookingId).maybeSingle();
  // The reminder the day before (a scheduled message, as you); a changed time replaces the old one
  if (row?.reminder_id) await sb.from("scheduled_messages").update({ cancelled_at: new Date().toISOString(), note: "Follow-up changed" }).eq("id", row.reminder_id).is("sent_message_id", null);
  let reminderId: string | null = null;
  const remindAt = new Date(at.getTime() - 24 * 3600e3);
  if (chat?.status === "open" && remindAt.getTime() > Date.now() + 30 * 60e3) {
    const { data: rem } = await sb.from("scheduled_messages").insert({ chat_id: chat.id, created_by: v.userId, sender_role: v.role, sender_name: v.name, body: `⏰ Reminder: follow-up session ${n} for ${st.dog} is tomorrow, ${label}. Reply here if anything changes.`, media: [], send_at: remindAt.toISOString() }).select("id").single();
    reminderId = rem?.id || null;
  }
  const fields = { status: "confirmed", at: at.toISOString(), reminder_id: reminderId, updated_at: new Date().toISOString() };
  const { data: saved, error } = row
    ? await sb.from("followups").update(fields).eq("id", row.id).select("id").single()
    : await sb.from("followups").insert({ booking_id: bookingId, chat_id: chat?.id || null, n, requested_by: v.role, ...fields }).select("id").single();
  if (error || !saved) return { ok: false, message: error?.message || "Couldn't save it." };
  try { await writeSessionDate(st.dealId, n, dayET(at.toISOString()), sb); } catch (e) { return { ok: true, message: `Booked, but HubSpot wasn't updated (${(e as Error).message}).` }; }
  if (chat?.status === "open") await serverClient().from("chat_messages").insert({ chat_id: chat.id, kind: "text", body: `✅ Follow-up session ${n} for ${st.dog} is booked: ${label}. See you then!` });
  await clearFollowupTodos(saved.id, sb);
  revalidatePath(`/t/followups/${bookingId}`); revalidatePath(`/a/dogs/${bookingId}`);
  return { ok: true, message: `Session ${n} booked for ${label}. The client has been told in the chat${reminderId ? ", and gets a reminder the day before" : ""}.` };
});
}

/** Trainer (or the office): cancel a requested or booked session. It can be booked again. */
export async function cancelFollowupAction(followupId: string): Promise<R> {
  return audited("cancelFollowupAction", { followupId }, async () => {
  if (isDemo()) return DEMO;
  const v = await getViewer();
  if (!v || (v.role !== "trainer" && v.role !== "admin")) return { ok: false, message: "Trainers and the office only." };
  const sb = serviceClient();
  const { data: f } = await sb.from("followups").select("id, booking_id, n, status, reminder_id, chat_id").eq("id", followupId).maybeSingle();
  if (!f || !["requested", "confirmed"].includes(f.status)) return { ok: false, message: "That session can't be cancelled now." };
  const st = await followupState(f.booking_id, sb);
  if (!st || (v.role === "trainer" && st.trainerId !== v.trainerId)) return { ok: false, message: "That dog isn't one of yours." };
  await sb.from("followups").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", f.id);
  if (f.reminder_id) await sb.from("scheduled_messages").update({ cancelled_at: new Date().toISOString(), note: "Follow-up cancelled" }).eq("id", f.reminder_id).is("sent_message_id", null);
  if (f.status === "confirmed") await writeSessionDate(st.dealId, f.n, null, sb).catch(() => null);
  if (f.chat_id) await serverClient().from("chat_messages").insert({ chat_id: f.chat_id, kind: "text", body: `Follow-up session ${f.n} for ${st.dog} is cancelled. You can book it again any time with "Book your follow-up".` });
  await clearFollowupTodos(f.id, sb);
  revalidatePath(`/t/followups/${f.booking_id}`);
  return { ok: true, message: `Session ${f.n} cancelled. The client has been told.` };
});
}
