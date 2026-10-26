import "server-only";
import { serviceClient } from "./supabase";
import { alertAdmins } from "./adminAlert";
import { mailConfigured, sendMail } from "./mail";
import { BRAND_LOGO_PNG_BASE64 } from "./brandLogo";
import { signMedia } from "./mediaSig";
import { driveConfigured, ensureChatFolder, uploadFile } from "./drive";
import { reportPdf } from "./reportPdf";
import { buildTranscript } from "./chatTranscript";
import { ChatMsg, ChatRow, driveView } from "./chatTypes";
import { CHAT_KINDS, INCIDENT_LABEL, IncidentKind, RULES, clientDigestDue, clientWaiting, pileUp, readyToClose, trainerSilent } from "./chatRules";
import { clearFormIncidents } from "./incidents";
import { catchUpBookings } from "./bookingCatchup";
import { sendDailyDigest } from "./digest";
import { autoInviteClients } from "./autoInvite";
import { registerNotifyUrl, sweepNotifications } from "./chatNotify";
import { watchDirectEdits } from "./directEdits";
import { auditSystem } from "./audit";

const URGENT_CHAT: IncidentKind[] = ["client_waiting", "client_pileup"];

const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const logo = { filename: "dogwise.png", content: Buffer.from(BRAND_LOGO_PNG_BASE64, "base64"), contentType: "image/png", cid: "dogwise-logo" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const ms = (v: string | null) => (v ? new Date(v).getTime() : 0);
export const muteToken = (chatId: string) => signMedia(chatId, "mute-chat");

type Span = { start_date: string; end_date: string; status: string };
type Incident = { id: string; chat_id: string; kind: IncidentKind; status: string; opened_at: string; last_alert_at: string | null };

/** Runs every few minutes (Vercel cron): opens and clears incidents, alerts admins, sends the (rare) client digest emails. */
export async function runChatChecks(now = new Date()) {
  const sb = serviceClient();
  const { data: chatRows } = await sb.from("chats").select("*").eq("status", "open");
  const chats = (chatRows || []) as ChatRow[];
  const out = { chats: chats.length, opened: 0, cleared: 0, realerted: 0, digests: 0, invited: 0, notified: 0, errors: [] as string[] };
  try { out.cleared += await clearFormIncidents(sb); } catch (e) { out.errors.push(`forms: ${(e as Error).message}`); }
  try { const c = await catchUpBookings(sb); out.errors.push(...c.errors.map((x) => `booking email: ${x}`)); } catch (e) { out.errors.push(`booking email: ${(e as Error).message}`); }
  try { if (await sendDailyDigest(sb)) out.digests++; } catch (e) { out.errors.push(`daily summary: ${(e as Error).message}`); }
  // Chat notifications the database and the sender's app both missed (should be rare: each one is logged)
  try {
    await registerNotifyUrl(sb);
    const missed = await sweepNotifications(sb);
    out.notified = missed;
    if (missed) await auditSystem("Sent missed chat notifications", `${missed} message${missed > 1 ? "s" : ""} hadn't been notified within 90 seconds, so the 10-minute check sent ${missed > 1 ? "them" : "it"}.`, { ok: true });
  } catch (e) { out.errors.push(`notifications: ${(e as Error).message}`); }
  try { await watchDirectEdits(sb); } catch (e) { out.errors.push(`direct edits: ${(e as Error).message}`); }
  try { const inv = await autoInviteClients(sb); out.invited = inv.invited; out.errors.push(...inv.errors.map((x) => `invite: ${x}`)); } catch (e) { out.errors.push(`invite: ${(e as Error).message}`); }

  // Bookings per chat (a chat's key is the HubSpot deal id, or the booking id)
  const keys = chats.map((c) => c.deal_key);
  const spans = new Map<string, Span[]>();
  if (keys.length) {
    const [a, b] = await Promise.all([
      sb.from("bookings").select("id, hubspot_deal_id, start_date, end_date, status").in("hubspot_deal_id", keys),
      sb.from("bookings").select("id, hubspot_deal_id, start_date, end_date, status").in("id", keys.filter((k) => /^[0-9a-f-]{36}$/i.test(k)))
    ]);
    for (const bk of [...(a.data || []), ...(b.data || [])] as (Span & { id: string; hubspot_deal_id: string | null })[]) {
      const k = bk.hubspot_deal_id && keys.includes(bk.hubspot_deal_id) ? bk.hubspot_deal_id : bk.id;
      spans.set(k, [...(spans.get(k) || []), bk]);
    }
  }

  // Only the chat incidents: form, booking and HubSpot incidents are opened and cleared elsewhere (lib/incidents.ts, lib/hubspotSync.ts)
  const { data: incRows } = await sb.from("chat_incidents").select("id, chat_id, kind, status, opened_at, last_alert_at").neq("status", "resolved").in("kind", CHAT_KINDS);
  const live = (incRows || []) as Incident[];
  const fresh: { chat: ChatRow; kind: IncidentKind; detail: string }[] = [];

  for (const c of chats) {
    try {
      const bs = spans.get(c.deal_key) || [];
      const lastReply = ms(c.last_trainer_at) > ms(c.last_admin_at) ? c.last_trainer_at : c.last_admin_at;
      const want = new Map<IncidentKind, string>();
      if (trainerSilent(now, bs, c.last_trainer_at)) want.set("trainer_silent", `No update from ${c.trainer_name || "the trainer"} today`);
      const waiting = clientWaiting(now, c.last_client_at, lastReply);
      if (waiting !== null) want.set("client_waiting", `${c.client_name || "The client"} has been waiting ${waiting} waking hours for a reply`);
      if (c.last_client_at && ms(c.last_client_at) > ms(lastReply)) {
        const { data: unanswered } = await sb.from("chat_messages").select("created_at").eq("chat_id", c.id).eq("sender_role", "client").gt("created_at", lastReply || "1970-01-01").order("created_at", { ascending: false }).limit(20);
        const n = pileUp(now, (unanswered || []).map((x: { created_at: string }) => x.created_at));
        if (n !== null) want.set("client_pileup", `${n} unanswered messages from ${c.client_name || "the client"} in the last ${RULES.pileUpWithinHours} hours`);
      }
      const quiet = readyToClose(now, c.last_message_at, c.created_at, bs);
      if (quiet !== null) want.set("ready_to_close", `No messages for ${quiet} days and no dog in care`);

      for (const [kind, detail] of want) if (!live.some((i) => i.chat_id === c.id && i.kind === kind)) fresh.push({ chat: c, kind, detail });

      // Clear what has been dealt with. (Not by the clock: a missed update stays flagged until the trainer posts or an admin resolves it.)
      for (const i of live.filter((x) => x.chat_id === c.id)) {
        const opened = ms(i.opened_at);
        const done = i.kind === "trainer_silent" ? ms(c.last_trainer_at) > opened
          : i.kind === "client_waiting" || i.kind === "client_pileup" || i.kind === "reopened" ? Math.max(ms(c.last_trainer_at), ms(c.last_admin_at)) > opened
          : i.kind === "ready_to_close" ? ms(c.last_message_at) > opened : false;
        if (done) { await sb.from("chat_incidents").update({ status: "resolved", resolved_at: now.toISOString(), resolved_by: "automatic", auto_resolved: true }).eq("id", i.id); out.cleared++; }
      }
    } catch (e) { out.errors.push(`${c.id}: ${(e as Error).message}`); }
  }
  // Incidents on chats that have since been closed
  const openIds = new Set(chats.map((c) => c.id));
  for (const i of live.filter((x) => !openIds.has(x.chat_id))) await sb.from("chat_incidents").update({ status: "resolved", resolved_at: now.toISOString(), resolved_by: "automatic", auto_resolved: true }).eq("id", i.id);

  const created: { chat: ChatRow; kind: IncidentKind; detail: string }[] = [];
  for (const f of fresh) {
    const urgent = URGENT_CHAT.includes(f.kind);
    const { error } = await sb.from("chat_incidents").insert({ chat_id: f.chat.id, kind: f.kind, detail: f.detail, opened_at: now.toISOString(), last_alert_at: urgent ? now.toISOString() : null });
    if (!error) { if (urgent) created.push(f); out.opened++; }
  }
  // Only a waiting client is emailed straight away (and again if still waiting). Everything else is in To do and the daily summary.
  const stale = live.filter((i) => i.status === "open" && URGENT_CHAT.includes(i.kind) && openIds.has(i.chat_id) && now.getTime() - ms(i.last_alert_at || i.opened_at) > RULES.realertHours * 3600000);
  if (created.length || stale.length) {
    try {
      const staleLines = stale.map((i) => { const c = chats.find((x) => x.id === i.chat_id)!; return { text: `Still open: ${INCIDENT_LABEL[i.kind]} (${c.title || "dog"}, ${c.client_name || "client"})`, link: `${site()}/a/chats/${c.id}` }; });
      const lines = [...created.map((f) => ({ text: `${INCIDENT_LABEL[f.kind]}: ${f.chat.title || "dog"}, ${f.chat.client_name || "client"}. ${f.detail}.`, link: `${site()}/a/chats/${f.chat.id}` })), ...staleLines];
      await alertAdmins(`${lines.length} chat incident${lines.length > 1 ? "s" : ""} need attention`, `${lines.length} chat thing${lines.length > 1 ? "s" : ""} for the Dogwise team to look at.`, lines, { label: "Open To do", link: `${site()}/a` });
      for (const i of stale) { await sb.from("chat_incidents").update({ last_alert_at: now.toISOString() }).eq("id", i.id); out.realerted++; }
    } catch (e) { out.errors.push(`alert: ${(e as Error).message}`); }
  }

  // Client "you have updates" emails: rare by design (see RULES)
  if (process.env.CHAT_CLIENT_EMAILS !== "off" && mailConfigured()) {
    const cands = chats.filter((c) => c.client_user_id && c.client_email && c.invited_at && c.client_emails !== false);
    const { data: reads } = cands.length ? await sb.from("chat_reads").select("chat_id, user_id, last_read_at").in("chat_id", cands.map((c) => c.id)) : { data: [] };
    for (const c of cands) {
      const latest = ms(c.last_trainer_at) > ms(c.last_admin_at) ? c.last_trainer_at : c.last_admin_at;
      const read = (reads || []).find((r: { chat_id: string; user_id: string }) => r.chat_id === c.id && r.user_id === c.client_user_id) as { last_read_at: string } | undefined;
      if (!clientDigestDue(now, { latestFromOthers: latest, clientReadAt: read?.last_read_at || null, notifiedAt: c.notified_client_at ?? null })) continue;
      try {
        const link = `${site()}/c/${c.id}`, stop = `${site()}/api/chat/mute?c=${c.id}&t=${muteToken(c.id)}`, first = (c.client_name || "").split(" ")[0] || "there";
        await sendMail({
          to: c.client_email!, subject: `New updates for ${c.title || "your dog"}`,
          text: `Hi ${first}, there are new updates from ${c.trainer_name || "your trainer"} in your Dogwise chat: ${link}\n\nTo stop these emails: ${stop}`,
          html: `<div style="background:#f4f5f8;padding:24px 12px;font-family:Arial,sans-serif"><div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E7E3F3;border-radius:16px;padding:24px"><img src="cid:dogwise-logo" width="130" alt="Dogwise Academy" style="display:block;margin-bottom:14px"><p style="font-size:16px;font-weight:bold;color:#281870;margin:0 0 8px">New updates for ${esc(c.title || "your dog")}</p><p style="font-size:15px;color:#333;line-height:1.5;margin:0 0 18px">Hi ${esc(first)}, there are new messages, photos or videos from ${esc(c.trainer_name || "your trainer")} waiting for you.</p><a href="${link}" style="background:#281870;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:bold;display:inline-block">Open the chat</a><p style="font-size:12px;color:#8796AD;margin:20px 0 0">We email you at most once a day. <a href="${stop}" style="color:#8796AD">Stop these emails</a></p></div></div>`,
          attachments: [logo]
        });
        await sb.from("chats").update({ notified_client_at: now.toISOString() }).eq("id", c.id);
        await auditSystem("Emailed a client about new chat updates", `${c.title || "Dog"} (${c.client_name || "client"}): unread updates, emailed to ${c.client_email}.`, { link: `/a/chats/${c.id}` });
        out.digests++;
      } catch (e) { out.errors.push(`digest ${c.id}: ${(e as Error).message}`); }
    }
  }
  return out;
}

// ── Closing ─────────────────────────────────────────────────────────────
/** Saves the transcript to Drive, emails the client, then clears the messages out of the app. */
export async function closeChat(chatId: string): Promise<{ ok: boolean; message: string }> {
  const sb = serviceClient();
  const { data: chat } = await sb.from("chats").select("*").eq("id", chatId).maybeSingle();
  if (!chat) return { ok: false, message: "Chat not found." };
  if (chat.status === "closed") return { ok: true, message: "Already closed." };
  const msgs: ChatMsg[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data } = await sb.from("chat_messages").select("*").eq("chat_id", chatId).order("created_at").range(from, from + 999);
    msgs.push(...((data || []) as ChatMsg[]));
    if (!data || data.length < 1000) break;
  }
  const view = buildTranscript(chat, msgs);
  const pdf = await reportPdf(view);
  const title = chat.title || "your dog";
  let transcriptUrl: string | null = null, archived = false, folderUrl = chat.drive_folder_url as string | null;
  if (driveConfigured()) {
    try {
      let folderId = chat.drive_folder_id as string | null;
      if (!folderId) { const f = await ensureChatFolder(chat); folderId = f.id; folderUrl = f.url; await sb.from("chats").update({ drive_folder_id: f.id, drive_folder_url: f.url }).eq("id", chatId); }
      const id = await uploadFile(folderId, `Chat transcript - ${title} - ${new Date().toISOString().slice(0, 10)}.pdf`, "application/pdf", pdf);
      transcriptUrl = driveView(id); archived = true;
    } catch (e) { return { ok: false, message: `Nothing was closed: couldn't save the transcript to Drive (${(e as Error).message}).` }; }
  }
  let emailNote = "";
  if (chat.client_email && chat.invited_at) {
    try { await sendClosingEmail(chat, transcriptUrl, folderUrl, archived ? null : pdf); emailNote = ` Emailed to ${chat.client_email}.`; }
    catch (e) { emailNote = ` The email to the client failed (${(e as Error).message}); use "Send summary again".`; }
  }
  await sb.from("chats").update({ status: "closed", closed_at: new Date().toISOString(), transcript_url: transcriptUrl, ...(archived ? { archived_at: new Date().toISOString() } : {}) }).eq("id", chatId);
  if (archived) {
    const { count } = await sb.from("chat_messages").select("id", { count: "exact", head: true }).eq("chat_id", chatId);
    await sb.from("chat_messages").delete().eq("chat_id", chatId); // safe: the transcript is in Drive
    await auditSystem("Archived a closed chat to Drive", `${chat.title || "Dog"} (${chat.client_name || "client"}): ${count ?? "all"} messages saved to the transcript in Drive and removed from the app.`, { link: transcriptUrl });
  }
  // Only the chat's own incidents: a booking or money incident linked to this chat stays open until someone deals with it
  await sb.from("chat_incidents").update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: "chat closed", auto_resolved: true }).eq("chat_id", chatId).neq("status", "resolved").in("kind", [...CHAT_KINDS, "intake_media_missing", "handover_photo_missing"]);
  return { ok: true, message: `Chat closed${archived ? " and archived to Drive" : ""}.${emailNote}` };
}

export async function sendClosingEmail(chat: ChatRow, transcriptUrl: string | null, folderUrl: string | null, attach: Uint8Array | null) {
  if (!mailConfigured()) throw new Error("Email isn't set up");
  const first = (chat.client_name || "").split(" ")[0] || "there";
  const btn = (label: string, url: string) => `<a href="${url}" style="background:#281870;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:bold;display:inline-block;margin:0 8px 8px 0">${esc(label)}</a>`;
  await sendMail({
    to: chat.client_email!, subject: `Your Dogwise chat for ${chat.title || "your dog"}`,
    text: `Hi ${first}, we've closed your chat for ${chat.title || "your dog"}. Everything is saved for you.\n${transcriptUrl ? `Transcript: ${transcriptUrl}\n` : ""}${folderUrl ? `All photos and videos: ${folderUrl}\n` : ""}\nNeed us again? Sign in at ${site()}/login and start a new chat any time.`,
    html: `<div style="background:#f4f5f8;padding:24px 12px;font-family:Arial,sans-serif"><div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E7E3F3;border-radius:16px;padding:24px"><img src="cid:dogwise-logo" width="130" alt="Dogwise Academy" style="display:block;margin-bottom:14px"><p style="font-size:18px;font-weight:bold;color:#281870;margin:0 0 8px">Your chat for ${esc(chat.title || "your dog")} is closed</p><p style="font-size:15px;color:#333;line-height:1.5;margin:0 0 16px">Hi ${esc(first)}, everything from the chat is saved for you.</p>${transcriptUrl ? btn("Read the chat", transcriptUrl) : ""}${folderUrl ? btn("All photos and videos", folderUrl) : ""}<p style="font-size:14px;color:#555;line-height:1.5;margin:14px 0 0">Need us again? <a href="${site()}/login" style="color:#6E4FE0;font-weight:bold">Sign in</a> with this email address and start a new chat any time.</p></div></div>`,
    attachments: [logo, ...(attach ? [{ filename: "Chat transcript.pdf", content: attach, contentType: "application/pdf" }] : [])]
  });
}

// ── Reopening ───────────────────────────────────────────────────────────
/** A fresh chat for the same deal: same client and media folder, no old messages. The trainer joins only if still active. */
export async function reopenChat(oldId: string, by: "client" | "admin"): Promise<{ ok: boolean; message: string; chatId?: string }> {
  const sb = serviceClient();
  const { data: old } = await sb.from("chats").select("*").eq("id", oldId).maybeSingle();
  if (!old) return { ok: false, message: "Chat not found." };
  const { data: existing } = await sb.from("chats").select("id").eq("deal_key", old.deal_key).eq("status", "open").maybeSingle();
  if (existing) return { ok: true, message: "There's already an open chat.", chatId: existing.id };
  let trainerId: string | null = null, trainerName: string | null = null;
  if (old.trainer_id) {
    const { data: t } = await sb.from("trainers").select("name, active").eq("id", old.trainer_id).maybeSingle();
    if (t?.active) { trainerId = old.trainer_id; trainerName = t.name; }
  }
  const { data: nc, error } = await sb.from("chats").insert({
    deal_key: old.deal_key, trainer_id: trainerId, trainer_name: trainerName, client_user_id: old.client_user_id, client_name: old.client_name, client_email: old.client_email,
    title: old.title, drive_folder_id: old.drive_folder_id, drive_folder_url: old.drive_folder_url, previous_chat_id: old.id, invited_at: old.invited_at, client_emails: old.client_emails
  }).select("*").single();
  if (error || !nc) return { ok: false, message: error?.message || "Couldn't start a new chat." };
  await sb.from("chat_messages").insert({ chat_id: nc.id, sender_role: "system", sender_name: "Dogwise", kind: "system", body: trainerId ? "New chat started. Welcome back!" : "New chat started. Your previous trainer isn't available, so the Dogwise team will reply." });
  if (by === "client") {
    await sb.from("chat_incidents").insert({ chat_id: nc.id, kind: "reopened", detail: `${old.client_name || "The client"} started a new chat${trainerId ? "" : ". Their trainer isn't available any more"}`, last_alert_at: new Date().toISOString() });
    await alertAdmins(`${old.client_name || "A client"} started a new chat`, `${old.client_name || "A client"} came back and started a new chat about ${old.title || "their dog"}.${trainerId ? "" : " Their previous trainer is no longer available, so only the Dogwise team is in it."}`, [{ text: `${old.title || "Dog"}, ${old.client_name || "client"}`, link: `${site()}/a/chats/${nc.id}` }]).catch(() => {});
  }
  return { ok: true, message: "New chat started.", chatId: nc.id };
}
