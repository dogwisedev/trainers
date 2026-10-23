"use server";
import { auditCall } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/data";
import { isDemo, serverClient, serviceClient } from "@/lib/supabase";
import { Answers, Kind, MediaItem, Status, hasTrainerPhoto, healthFlags, items, kindName, reportTitle, s, validate } from "@/lib/reports";
import { dealKey } from "@/lib/chatTypes";
import { ensureReport, getReport, pickupMedia } from "@/lib/reportData";
import type { Booking } from "@/lib/types";
import { messageTrainer, raiseIncident, resolveIncidents } from "@/lib/incidents";
import { saveFormTrip } from "@/lib/trips";
import { pushToTrainer } from "@/lib/push";
import { buildReport, driveUrl, reportHtml, reportText } from "@/lib/reportDoc";
import { reportPdf } from "@/lib/reportPdf";
import { handoverPdf } from "@/lib/handoverPdf";
import { certificatePdf } from "@/lib/certificatePdf";
import { programFor } from "@/lib/programs";
import { photoBytes } from "@/lib/drive";
import { mailConfigured, sendMail } from "@/lib/mail";
import { BRAND_LOGO_PNG_BASE64 } from "@/lib/brandLogo";
import { signMedia, verifyMedia } from "@/lib/mediaSig";
import { usDate } from "@/lib/payroll";
import { postReportToChat } from "@/lib/chat";

export type ReportResult = { ok: boolean; message: string; missing?: string[]; nextId?: string | null };
const DEMO: ReportResult = { ok: false, message: "Demo mode: connect Supabase to save reports." };
const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const logo = { filename: "dogwise.png", content: Buffer.from(BRAND_LOGO_PNG_BASE64, "base64"), contentType: "image/png", cid: "dogwise-logo" };

async function who() {
  const v = await getViewer();
  if (!v) throw new Error("Sign in again.");
  return v;
}

/** Keep answers plain and bounded; keep only media the server confirmed (or that was already on the report). */
function cleanAnswers(a: Answers): Answers {
  const json = JSON.stringify(a || {});
  if (json.length > 120_000) throw new Error("That report is too long to save.");
  return JSON.parse(json);
}
function cleanMedia(incoming: MediaItem[], existing: MediaItem[], bookingId: string): MediaItem[] {
  const have = new Set(existing.map((m) => m.id));
  return (Array.isArray(incoming) ? incoming : []).filter((m) => m && typeof m.id === "string" && (have.has(m.id) || verifyMedia(m.id, bookingId, m.sig)))
    .map((m) => ({ id: m.id, name: String(m.name || "").slice(0, 160), kind: (m.kind === "photo" ? "photo" : "video") as MediaItem["kind"], slot: (["training", "homework", "health"].includes(m.slot) ? m.slot : "training") as MediaItem["slot"], description: s(m.description).slice(0, 400), sig: m.sig, size: Number(m.size) || undefined })).slice(0, 60);
}

async function adminNotify(subject: string, text: string, link: string) {
  const to = process.env.ADMIN_NOTIFY_EMAIL || process.env.PAYROLL_NOTIFY_EMAIL;
  if (!to || !mailConfigured()) return;
  await sendMail({ to, subject, text: `${text}\n${link}`, html: `<p style="font-family:Arial,sans-serif;font-size:15px">${text}</p><p><a href="${link}" style="background:#2A1971;color:#fff;padding:10px 18px;border-radius:9px;text-decoration:none;font-weight:bold">Review it</a></p>` }).catch(() => {});
}

// ── Saving ────────────────────────────────────────────────────────────
export async function saveReportAction(id: string, answers: Answers, media: MediaItem[], editingApproved = false): Promise<ReportResult> {
  if (isDemo()) return DEMO;
  try {
    const v = await who();
    const b = await getReport(id);
    if (!b) return { ok: false, message: "Report not found." };
    const st = b.report.status;
    if (st === "waived") return { ok: false, message: "This form is marked not needed. Bring it back first." };
    const can = v.role === "admin" ? st !== "approved" || editingApproved : v.trainerId === b.report.trainer_id && (st === "draft" || st === "changes_requested");
    if (!can) return { ok: false, message: st === "submitted" ? "It's with the Dogwise team for review now." : "This report can't be edited." };
    const { error } = await serverClient().from("reports").update({ answers: cleanAnswers(answers), media: cleanMedia(media, b.report.media, b.booking.id) }).eq("id", id);
    return error ? { ok: false, message: error.message } : { ok: true, message: "Saved" };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

export async function submitReportAction(id: string, answers: Answers, media: MediaItem[]): Promise<ReportResult> {
  await auditCall("submitReportAction", { id, answers, media });
  if (isDemo()) return DEMO;
  try {
    const v = await who();
    const b = await getReport(id);
    if (!b || v.role !== "trainer" || v.trainerId !== b.report.trainer_id) return { ok: false, message: "Report not found." };
    if (b.report.status !== "draft" && b.report.status !== "changes_requested") return { ok: false, message: "Already submitted." };
    const a = cleanAnswers(answers), m = cleanMedia(media, b.report.media, b.booking.id);
    const missing = validate(b.report.kind, a, m);
    if (missing.length) return { ok: false, message: "A few things are still needed.", missing };
    // Photos and videos never block a form any more: the trainer is reminded, and admins get an incident if they're missing.
    const pickup = b.report.kind === "intake" ? await pickupMedia(b.booking, s(a.pickupDate) || b.booking.start_date) : null;
    const { error } = await serverClient().from("reports").update({ answers: a, media: m, status: "submitted", submitted_at: new Date().toISOString(), review_note: null }).eq("id", id);
    if (error) return { ok: false, message: error.message };
    const dog = s(a.dogName), flags = healthFlags(b.report.kind, a);
    const label = `${dog || "Dog"} (${s(a.clientName) || b.booking.client_name}), ${b.trainer.name}`;
    let mediaNote = "";
    // Miles from the pickup / drop-off form become a trip, for mileage pay
    if (b.report.kind === "intake" || b.report.kind === "handover") await saveFormTrip({ reportId: id, trainerId: b.trainer.id, bookingId: b.booking.id, kind: b.report.kind === "intake" ? "pickup" : "dropoff",
      date: b.report.kind === "intake" ? s(a.pickupDate) || b.booking.start_date : b.booking.end_date, miles: a.mileage, route: s(a.route), by: b.trainer.name });
    if (pickup && pickup.count === 0) {
      await raiseIncident({ kind: "intake_media_missing", title: label, chatId: pickup.chatId, bookingId: b.booking.id, reportId: id, ref: `report:${id}`,
        detail: `${b.trainer.name} submitted the intake form for ${dog || "the dog"} with no pickup photos or video in the chat${pickup.chatId ? "" : " (the dog has no chat yet)"}.`,
        link: pickup.chatId ? `${site()}/a/chats/${pickup.chatId}` : `${site()}/a/reports/${id}` });
      mediaNote = " Please update video on chat: post the pickup photos and a video in the dog's chat.";
    }
    if (b.report.kind === "handover" && !hasTrainerPhoto(m)) {
      await raiseIncident({ kind: "handover_photo_missing", title: label, chatId: b.chat?.id || null, bookingId: b.booking.id, reportId: id, ref: `report:${id}`,
        detail: `${b.trainer.name} submitted the handover report for ${dog || "the dog"} without a photo of the dog with the trainer. They've been asked to post one in the chat: pick it into the report when you review it.`,
        link: `${site()}/a/reports/${id}` });
      await messageTrainer(b.trainer.id, `Your handover report for ${dog || "the dog"} went in without a photo of you with ${dog || "the dog"}. Please post one in ${dog ? `${dog}'s` : "the dog's"} chat today, so we can add it before it goes to the client.`);
      mediaNote = " Please post a photo of you with the dog in the chat: the team will add it to the report.";
    }
    // Admins are emailed only when it matters: a handover to send to the client, or a health check with something to look at.
    if (b.report.kind === "handover") await adminNotify(`Handover to review: ${dog}`, `${b.trainer.name} submitted the handover report for ${dog} (${s(a.clientName)}).`, `${site()}/a/reports/${id}`);
    else if (b.report.kind === "weekly" && flags.length) await adminNotify(`Health check needs a look: ${dog}`, `${b.trainer.name}'s weekly health check for ${dog} has: ${flags.join(", ")}.`, `${site()}/a/reports/${id}`);
    revalidatePath("/", "layout");
    return { ok: true, message: (b.report.kind === "handover" ? "Submitted. The Dogwise team will review it and send it to the client." : "Submitted. Thank you.") + mediaNote };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

// ── Review ────────────────────────────────────────────────────────────
async function deliver(id: string, corrected: boolean): Promise<ReportResult> {
  const b = await getReport(id);
  if (!b) return { ok: false, message: "Report not found." };
  const sb = serverClient();
  const a = b.report.answers, to = s(a.clientEmail);
  if (!to) { await sb.from("reports").update({ send_error: "No client email" }).eq("id", id); return { ok: false, message: "Approved, but there's no client email. Add it and use Email again." }; }
  try {
    if (b.report.kind === "handover") return await deliverHandover(id, b, to, corrected);
    const view = buildReport(b.report.kind, a, b.report.media, { startDate: b.booking.start_date, endDate: b.booking.end_date, submittedAt: b.report.submitted_at });
    const pdf = await reportPdf(view);
    const first = s(a.clientName).split(" ")[0] || "there";
    const title = reportTitle(b.report.kind, b.report.week_number, view.dog);
    const html = `<div style="background:#f4f5f8;padding:24px 12px">
      ${corrected ? `<p style="max-width:640px;margin:0 auto 10px;font-family:Arial,sans-serif;font-size:15px;color:#C2415D;font-weight:bold">Corrected report: this replaces the one we sent earlier.</p>` : ""}
      <p style="max-width:640px;margin:0 auto 16px;font-family:Arial,sans-serif;font-size:15px;color:#333">Hi ${first}, here is ${title.charAt(0).toLowerCase() + title.slice(1)} from the Dogwise team. A PDF copy is attached.</p>
      ${reportHtml(view, "cid:dogwise-logo")}</div>`;
    await sendMail({
      to, subject: `${corrected ? "Corrected: " : ""}${title}`, html, text: reportText(view),
      attachments: [{ filename: `${title}.pdf`, content: pdf, contentType: "application/pdf" }, logo]
    });
    await sb.from("reports").update({ sent_at: new Date().toISOString(), sent_to: to, send_error: null }).eq("id", id);
    await postReportToChat(b.booking, { id, title: `${corrected ? "Corrected: " : ""}${title}` }, pdf);
    return { ok: true, message: `${corrected ? "Corrected report" : "Approved"} and sent to ${to}.` };
  } catch (e) {
    await sb.from("reports").update({ send_error: (e as Error).message }).eq("id", id);
    return { ok: false, message: `Approved, but the email failed: ${(e as Error).message}` };
  }
}

export async function approveReportAction(id: string, answers: Answers, media: MediaItem[]): Promise<ReportResult> {
  await auditCall("approveReportAction", { id, answers, media });
  if (isDemo()) return DEMO;
  try {
    const v = await who();
    if (v.role !== "admin") return { ok: false, message: "Admins only." };
    const b = await getReport(id);
    if (!b) return { ok: false, message: "Report not found." };
    const corrected = b.report.status === "approved";
    const a = cleanAnswers(answers), m = cleanMedia(media, b.report.media, b.booking.id);
    const missing = validate(b.report.kind, a, m, { skip: ["mileage"] }); // forms sent before miles were asked can still be approved
    if (missing.length) return { ok: false, message: b.report.kind === "handover" ? "A few things are still needed before it can go to the client." : "A few things are still needed.", missing };
    const sb = serverClient();
    const { error } = await sb.from("reports").update({
      answers: a, media: m, status: "approved", approved_by: v.userId, approved_by_name: v.name, approved_at: new Date().toISOString(),
      submitted_at: b.report.submitted_at || new Date().toISOString(), review_note: null
    }).eq("id", id);
    if (error) return { ok: false, message: error.message };
    if (b.report.kind === "intake" || b.report.kind === "handover") await saveFormTrip({ reportId: id, trainerId: b.trainer.id, bookingId: b.booking.id, kind: b.report.kind === "intake" ? "pickup" : "dropoff",
      date: b.report.kind === "intake" ? s(a.pickupDate) || b.booking.start_date : b.booking.end_date, miles: a.mileage, route: s(a.route), by: v.name }); // admin may have corrected the miles
    if (b.report.kind !== "handover") {
      // Intake forms and weekly health checks stay internal: "approve" just means an admin has looked at it.
      const { data: nxt } = await sb.from("reports").select("id").eq("status", "submitted").neq("id", id).order("submitted_at", { ascending: true }).limit(1);
      revalidatePath("/", "layout");
      return { ok: true, message: "Marked as reviewed.", nextId: nxt?.[0]?.id || null };
    }
    if (s(a.clientEmail) && s(a.clientEmail) !== (b.booking.client_email || "")) await sb.from("bookings").update({ client_email: s(a.clientEmail) }).eq("id", b.booking.id);
    await resolveIncidents({ kinds: ["handover_photo_missing"], reportId: id }, v.name, hasTrainerPhoto(m) ? "Photo added" : "Approved without the photo");
    const sent = await deliver(id, corrected);
    const { data: next } = await sb.from("reports").select("id").eq("status", "submitted").neq("id", id).order("submitted_at", { ascending: true }).limit(1);
    revalidatePath("/", "layout");
    return { ...sent, nextId: next?.[0]?.id || null };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

export async function sendBackAction(id: string, note: string): Promise<ReportResult> {
  await auditCall("sendBackAction", { id, note });
  if (isDemo()) return DEMO;
  try {
    const v = await who();
    if (v.role !== "admin") return { ok: false, message: "Admins only." };
    if (!s(note)) return { ok: false, message: "Say what needs changing, so the trainer knows." };
    const b = await getReport(id);
    if (!b) return { ok: false, message: "Report not found." };
    const sb = serverClient();
    const { error } = await sb.from("reports").update({ status: "changes_requested", review_note: s(note) }).eq("id", id);
    if (error) return { ok: false, message: error.message };
    if (b.trainer.email && mailConfigured()) {
      const link = `${site()}/t/reports/${id}`;
      await pushToTrainer(b.trainer.id, { title: `Changes needed: ${s(b.report.answers.dogName)}'s form`, body: s(note), url: `/t/reports/${id}`, tag: `report-${id}` });
      await sendMail({ to: b.trainer.email, subject: `Changes needed: ${s(b.report.answers.dogName)}'s report`, text: `${s(note)}\n\nFix it here: ${link}`,
        html: `<p style="font-family:Arial,sans-serif;font-size:15px">Hi ${b.trainer.name.split(" ")[0]}, the team sent ${s(b.report.answers.dogName)}'s report back:</p><blockquote style="font-family:Arial,sans-serif;font-size:15px;border-left:4px solid #6B4FE0;margin:10px 0;padding:4px 14px;color:#333">${s(note).replace(/</g, "&lt;").replace(/\n/g, "<br>")}</blockquote><p><a href="${link}" style="background:#2A1971;color:#fff;padding:10px 18px;border-radius:9px;text-decoration:none;font-weight:bold">Open the report</a></p>` }).catch(() => {});
    }
    const { data: next } = await sb.from("reports").select("id").eq("status", "submitted").neq("id", id).order("submitted_at", { ascending: true }).limit(1);
    revalidatePath("/", "layout");
    return { ok: true, message: "Sent back to the trainer.", nextId: next?.[0]?.id || null };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

export async function resendReportAction(id: string): Promise<ReportResult> {
  await auditCall("resendReportAction", { id });
  if (isDemo()) return DEMO;
  try { if ((await who()).role !== "admin") return { ok: false, message: "Admins only." }; } catch (e) { return { ok: false, message: (e as Error).message }; }
  const r = await deliver(id, false);
  revalidatePath(`/a/reports/${id}`);
  return r.ok ? { ...r, message: r.message.replace("Approved and sent", "Sent again") } : r;
}

export async function setReportsEnabledAction(bookingId: string, on: boolean): Promise<ReportResult> {
  await auditCall("setReportsEnabledAction", { bookingId, on });
  if (isDemo()) return DEMO;
  try {
    if ((await who()).role !== "admin") return { ok: false, message: "Admins only." };
    const { error } = await serverClient().from("bookings").update({ reports_enabled: on }).eq("id", bookingId);
    revalidatePath("/", "layout");
    return error ? { ok: false, message: error.message } : { ok: true, message: on ? "Reports are on for this booking." : "Reports are off for this booking." };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}
export type { Status, Kind };

// ── Not needed (admin): a form made by mistake, or for days the dog wasn't in care ──
/** Marks a form "not needed": it leaves every to-do list (admin and trainer), reminders and late counts. Works whether or not it was started. */
export async function waiveReportAction(bookingId: string, kind: Kind, week: number, reportId?: string | null): Promise<ReportResult> {
  await auditCall("waiveReportAction", { bookingId, kind, week, reportId });
  if (isDemo()) return DEMO;
  try {
    const v = await who();
    if (v.role !== "admin") return { ok: false, message: "Admins only." };
    const sb = serverClient();
    let id = reportId || null;
    if (!id) {
      const { data: b } = await sb.from("bookings").select("*").eq("id", bookingId).maybeSingle();
      const { data: t } = b ? await sb.from("trainers").select("name").eq("id", b.trainer_id).maybeSingle() : { data: null };
      if (!b || !t) return { ok: false, message: "Booking not found." };
      id = await ensureReport(sb, b as Booking, t.name, kind, week, true);
    }
    const { data: r } = await sb.from("reports").select("status").eq("id", id).maybeSingle();
    if (!r) return { ok: false, message: "Form not found." };
    if (r.status === "submitted" || r.status === "approved") return { ok: false, message: "The trainer already submitted this one: review it instead." };
    const { error } = await sb.from("reports").update({ status: "waived", waived_by: v.name === "Dogwise team" ? v.email || v.name : v.name, waived_at: new Date().toISOString() }).eq("id", id);
    if (error) return { ok: false, message: error.message };
    await resolveIncidents({ kinds: ["intake_media_missing", "handover_photo_missing"], reportId: id }, v.name, "Form marked not needed");
    revalidatePath("/", "layout");
    return { ok: true, message: "Marked not needed. It's gone from the trainer's list too." };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

/** Undo "not needed": back to a draft the trainer can fill in. */
export async function unwaiveReportAction(id: string): Promise<ReportResult> {
  await auditCall("unwaiveReportAction", { id });
  if (isDemo()) return DEMO;
  try {
    const v = await who();
    if (v.role !== "admin") return { ok: false, message: "Admins only." };
    const { error } = await serverClient().from("reports").update({ status: "draft", waived_by: null, waived_at: null }).eq("id", id).eq("status", "waived");
    revalidatePath("/", "layout");
    return error ? { ok: false, message: error.message } : { ok: true, message: "Back on the trainer's list." };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

// ── Choose photos and videos from the dog's chat (nothing is uploaded again: it's all in Drive already) ──
export type ChatMediaOption = { id: string; name: string; kind: "video" | "photo"; size?: number; at: string; by: string; sig: string };
export async function listChatMediaAction(bookingId: string): Promise<{ items: ChatMediaOption[]; message?: string }> {
  if (isDemo()) return { items: [
    { id: "DEMO1", name: "heel-practice.mp4", kind: "video", at: new Date(Date.now() - 86400000).toISOString(), by: "You", sig: "demo" },
    { id: "DEMO2", name: "recall-long-line.mp4", kind: "video", at: new Date(Date.now() - 3 * 86400000).toISOString(), by: "You", sig: "demo" },
    { id: "DEMO3", name: "kya-with-trainer.jpg", kind: "photo", at: new Date(Date.now() - 3600000).toISOString(), by: "You", sig: "demo" }] };
  try {
    await who();
    const sb = serverClient();
    const { data: booking } = await sb.from("bookings").select("id, hubspot_deal_id").eq("id", bookingId).maybeSingle(); // row level security: only your own
    if (!booking) return { items: [], message: "Booking not found." };
    const { data: chat } = await sb.from("chats").select("id").eq("deal_key", dealKey(booking)).eq("status", "open").maybeSingle();
    if (!chat) return { items: [], message: "This dog has no chat yet. Ask the team to start one, then post the photos and videos there." };
    const { data } = await sb.from("chat_messages").select("media, sender_name, created_at").eq("chat_id", chat.id).eq("kind", "media").order("created_at", { ascending: false }).limit(300);
    const out: ChatMediaOption[] = [];
    for (const m of (data || []) as { media: { id: string; name: string; kind: string; size?: number }[]; sender_name: string | null; created_at: string }[])
      for (const x of m.media || []) if (x.kind === "video" || x.kind === "photo") out.push({ id: x.id, name: x.name, kind: x.kind, size: x.size, at: m.created_at, by: m.sender_name || "", sig: signMedia(x.id, booking.id) });
    return { items: out };
  } catch (e) { return { items: [], message: (e as Error).message }; }
}

/** Handover: the designed report PDF and the graduation certificate, emailed together and posted in the chat. Only after an admin approves. */
async function deliverHandover(id: string, b: NonNullable<Awaited<ReturnType<typeof getReport>>>, to: string, corrected: boolean): Promise<ReportResult> {
  const sb = serverClient(), svc = serviceClient(), a = b.report.answers, m = b.report.media || [];
  const long = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
  const today = new Date().toISOString().slice(0, 10);
  const dog = s(a.dogName) || b.booking.dog_name || "your dog", trainer = s(a.trainerName) || b.trainer.name;
  const program = programFor(s(a.program)) || programFor(b.booking.program) || s(a.program) || b.booking.program || "Dogwise program";
  const { data: chat } = await svc.from("chats").select("id").eq("deal_key", b.booking.hubspot_deal_id || b.booking.id).maybeSingle();
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  const chatUrl = chat ? `${site}/c/${chat.id}` : `${site}/c`;
  const videos = (slot: "training" | "homework") => m.filter((x) => x.slot === slot && x.kind === "video").map((x) => ({ label: x.description || x.name, url: driveUrl(x.id) }));
  const ph = m.find((x) => x.slot === "health" && x.kind === "photo");
  const pdf = await handoverPdf({
    dog, client: s(a.clientName), trainer, program, location: s(a.clientLocation), contact: to,
    start: long(b.booking.start_date), end: long(b.booking.end_date), date: long(today),
    goals: s(a.goals), training: items(a.training).filter((i) => i.title || i.text), homework: items(a.homework).filter((i) => i.title || i.text),
    trainingVideos: videos("training"), homeworkVideos: videos("homework"),
    health: s(a.healthAtHandover), extra: s(a.extra), review: s(a.overall), photo: ph ? await photoBytes(ph.id) : null, chatUrl
  });
  const [yy, mm, dd] = today.split("-");
  const cert = await certificatePdf({ dog, program, trainer, date: `${mm}/${dd}/${yy}` });
  const first = s(a.clientName).split(" ")[0] || "there";
  const reportName = `Handover Report - ${dog}.pdf`, certName = `Certificate - ${dog} - ${program}.pdf`;
  const html = `<div style="background:#f8f6fd;padding:28px 12px;font-family:Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;border:1px solid #E3DEF2;overflow:hidden">
      <div style="height:6px;background:#9878F8"></div>
      <div style="padding:26px">
        <img src="cid:dogwise-logo" alt="Dogwise Academy" width="140" style="display:block;margin-bottom:18px">
        ${corrected ? `<p style="margin:0 0 12px;color:#904B27;font-weight:bold">Corrected: this replaces the report we sent earlier.</p>` : ""}
        <h1 style="margin:0 0 10px;font-size:24px;color:#281870">Congratulations, ${esc(dog)} has graduated! 🎓</h1>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#5D5880">Hi ${esc(first)}, ${esc(dog)} has completed the <b>${esc(program)}</b> program with ${esc(trainer)}. Attached are ${esc(dog)}'s <b>handover report</b>, with everything we worked on, the homework and the training videos, and ${esc(dog)}'s <b>graduation certificate</b>.</p>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#5D5880">Both are also in your Dogwise chat, where you can message us any time.</p>
        <a href="${chatUrl}" style="display:inline-block;background:#281870;color:#fff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:12px">Open ${esc(dog)}'s chat</a>
      </div>
    </div></div>`;
  await sendMail({
    to, subject: `${corrected ? "Corrected: " : ""}${dog}'s handover report and certificate`, html,
    text: `Hi ${first}, ${dog} has completed the ${program} program with ${trainer}. ${dog}'s handover report and graduation certificate are attached, and in your Dogwise chat: ${chatUrl}`,
    attachments: [{ filename: reportName, content: pdf, contentType: "application/pdf" }, { filename: certName, content: cert, contentType: "application/pdf" }, logo]
  });
  await sb.from("reports").update({ sent_at: new Date().toISOString(), sent_to: to, send_error: null }).eq("id", id);
  await postReportToChat(b.booking, { id, title: `${corrected ? "Corrected: " : ""}${dog}'s handover report and certificate` }, pdf, [{ name: certName, pdf: cert }]);
  return { ok: true, message: `${corrected ? "Corrected report" : "Approved"}: handover report and certificate sent to ${to}.` };
}
const esc = (x: string) => String(x || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
