import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { alertAdmins, officeEmail } from "./adminAlert";
import { INCIDENT_LABEL, IncidentKind } from "./chatRules";

// Incidents that aren't opened by the chat check: forms, bookings and HubSpot.
// They show on the admin To do list (/a) next to the chat ones.
const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");

export type NewIncident = {
  kind: IncidentKind; title: string; detail: string;
  chatId?: string | null; bookingId?: string | null; reportId?: string | null;
  ref?: string | null;    // what it's about ('deal:123', 'booking:<id>', 'report:<id>'): one live incident per thing and kind
  office?: boolean;       // money involved: copy the office (info@) and ask them to sort out refund / partial pay
  link?: string;          // where "Open" goes in the email
};

/** Opens an incident and emails admins straight away. If the same one is already open, nothing happens. Never throws. */
export async function raiseIncident(i: NewIncident, sb: SupabaseClient = serviceClient()): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    const { error } = await sb.from("chat_incidents").insert({
      chat_id: i.chatId || null, booking_id: i.bookingId || null, report_id: i.reportId || null, ref: i.ref || null,
      kind: i.kind, detail: i.detail.slice(0, 1000), opened_at: now, last_alert_at: now
    });
    if (error) { if (error.code !== "23505") console.error("incident", i.kind, error.message); return false; } // 23505 = already open
    const link = i.link || (i.chatId ? `${site()}/a/chats/${i.chatId}` : i.bookingId ? `${site()}/a/dogs/${i.bookingId}` : `${site()}/a`);
    const intro = i.office ? `${i.detail} Please check whether a refund or partial pay is needed, and fix it.` : i.detail;
    await alertAdmins(`${INCIDENT_LABEL[i.kind]}: ${i.title}`, intro, [{ text: `${INCIDENT_LABEL[i.kind]}: ${i.title}`, link }],
      { label: "Open To do", link: `${site()}/a` }, i.office ? { alsoTo: [officeEmail()] } : {}).catch(() => {});
    return true;
  } catch (e) { console.error("incident", (e as Error).message); return false; }
}

/** Closes live incidents of these kinds for one thing (by ref, report or chat). */
export async function resolveIncidents(match: { kinds: IncidentKind[]; ref?: string; reportId?: string; chatId?: string }, by = "automatic", note?: string, sb: SupabaseClient = serviceClient()) {
  let q = sb.from("chat_incidents").update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: by, resolved_note: note || null, auto_resolved: by === "automatic" })
    .neq("status", "resolved").in("kind", match.kinds);
  if (match.ref) q = q.eq("ref", match.ref);
  if (match.reportId) q = q.eq("report_id", match.reportId);
  if (match.chatId) q = q.eq("chat_id", match.chatId);
  if (!match.ref && !match.reportId && !match.chatId) return;
  await q;
}

/** A message from the Dogwise team in the trainer's team thread (Chats → Dogwise team). Never throws. */
export async function messageTrainer(trainerId: string, body: string, sb: SupabaseClient = serviceClient()) {
  try { await sb.from("messages").insert({ trainer_id: trainerId, sender_id: null, sender_role: "admin", sender_name: "Dogwise team", body: body.slice(0, 4000) }); }
  catch { /* the incident is the important part */ }
}

/** Runs with the chat check: clears form incidents once the photo or video turns up. */
export async function clearFormIncidents(sb: SupabaseClient = serviceClient()) {
  let cleared = 0;
  const { data } = await sb.from("chat_incidents").select("id, kind, chat_id, report_id, opened_at").in("kind", ["intake_media_missing", "handover_photo_missing"]).neq("status", "resolved");
  for (const i of (data || []) as { id: string; kind: string; chat_id: string | null; report_id: string | null; opened_at: string }[]) {
    let done = false;
    if (i.kind === "intake_media_missing" && i.chat_id) {
      const { data: m } = await sb.from("chat_messages").select("id").eq("chat_id", i.chat_id).eq("kind", "media").eq("sender_role", "trainer").gt("created_at", i.opened_at).limit(1);
      done = !!m?.length;
    }
    if (i.kind === "handover_photo_missing" && i.report_id) {
      const { data: r } = await sb.from("reports").select("media, status").eq("id", i.report_id).maybeSingle();
      done = !r || r.status === "approved" || ((r.media || []) as { slot?: string; kind?: string }[]).some((x) => x.slot === "health" && x.kind === "photo"); // in the report, or an admin approved it as it is
    }
    if (done) { await sb.from("chat_incidents").update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: "automatic", auto_resolved: true }).eq("id", i.id); cleared++; }
  }
  return cleared;
}
