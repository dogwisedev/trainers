"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/data";
import { isDemo, serverClient } from "@/lib/supabase";
import { Answers, Kind, MediaItem, Status, reportTitle, s, validate } from "@/lib/reports";
import { getReport } from "@/lib/reportData";
import { buildReport, reportHtml, reportText } from "@/lib/reportDoc";
import { reportPdf } from "@/lib/reportPdf";
import { mailConfigured, sendMail } from "@/lib/mail";
import { BRAND_LOGO_PNG_BASE64 } from "@/lib/brandLogo";
import { verifyMedia } from "@/lib/mediaSig";
import { usDate } from "@/lib/payroll";

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
    const can = v.role === "admin" ? st !== "approved" || editingApproved : v.trainerId === b.report.trainer_id && (st === "draft" || st === "changes_requested");
    if (!can) return { ok: false, message: st === "submitted" ? "It's with the Dogwise team for review now." : "This report can't be edited." };
    const { error } = await serverClient().from("reports").update({ answers: cleanAnswers(answers), media: cleanMedia(media, b.report.media, b.booking.id) }).eq("id", id);
    return error ? { ok: false, message: error.message } : { ok: true, message: "Saved" };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

export async function submitReportAction(id: string, answers: Answers, media: MediaItem[]): Promise<ReportResult> {
  if (isDemo()) return DEMO;
  try {
    const v = await who();
    const b = await getReport(id);
    if (!b || v.role !== "trainer" || v.trainerId !== b.report.trainer_id) return { ok: false, message: "Report not found." };
    if (b.report.status !== "draft" && b.report.status !== "changes_requested") return { ok: false, message: "Already submitted." };
    const a = cleanAnswers(answers), m = cleanMedia(media, b.report.media, b.booking.id);
    const missing = validate(b.report.kind, a, m);
    if (missing.length) return { ok: false, message: "A few things are still needed.", missing };
    const { error } = await serverClient().from("reports").update({ answers: a, media: m, status: "submitted", submitted_at: new Date().toISOString(), review_note: null }).eq("id", id);
    if (error) return { ok: false, message: error.message };
    const dog = s(a.dogName);
    await adminNotify(`Report to review: ${dog}`, `${b.trainer.name} submitted ${b.report.kind === "weekly" ? `the week ${b.report.week_number} report` : "the handover report"} for ${dog} (${s(a.clientName)}).`, `${site()}/a/reports/${id}`);
    revalidatePath("/", "layout");
    return { ok: true, message: "Submitted. The Dogwise team will review it and send it to the client." };
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
    return { ok: true, message: `${corrected ? "Corrected report" : "Approved"} and sent to ${to}.` };
  } catch (e) {
    await sb.from("reports").update({ send_error: (e as Error).message }).eq("id", id);
    return { ok: false, message: `Approved, but the email failed: ${(e as Error).message}` };
  }
}

export async function approveReportAction(id: string, answers: Answers, media: MediaItem[]): Promise<ReportResult> {
  if (isDemo()) return DEMO;
  try {
    const v = await who();
    if (v.role !== "admin") return { ok: false, message: "Admins only." };
    const b = await getReport(id);
    if (!b) return { ok: false, message: "Report not found." };
    const corrected = b.report.status === "approved";
    const a = cleanAnswers(answers), m = cleanMedia(media, b.report.media, b.booking.id);
    const missing = validate(b.report.kind, a, m);
    if (missing.length) return { ok: false, message: "A few things are still needed before it can go to the client.", missing };
    const sb = serverClient();
    const { error } = await sb.from("reports").update({
      answers: a, media: m, status: "approved", approved_by: v.userId, approved_by_name: v.name, approved_at: new Date().toISOString(),
      submitted_at: b.report.submitted_at || new Date().toISOString(), review_note: null
    }).eq("id", id);
    if (error) return { ok: false, message: error.message };
    if (s(a.clientEmail) && s(a.clientEmail) !== (b.booking.client_email || "")) await sb.from("bookings").update({ client_email: s(a.clientEmail) }).eq("id", b.booking.id);
    const sent = await deliver(id, corrected);
    const { data: next } = await sb.from("reports").select("id").eq("status", "submitted").neq("id", id).order("submitted_at", { ascending: true }).limit(1);
    revalidatePath("/", "layout");
    return { ...sent, nextId: next?.[0]?.id || null };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

export async function sendBackAction(id: string, note: string): Promise<ReportResult> {
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
      await sendMail({ to: b.trainer.email, subject: `Changes needed: ${s(b.report.answers.dogName)}'s report`, text: `${s(note)}\n\nFix it here: ${link}`,
        html: `<p style="font-family:Arial,sans-serif;font-size:15px">Hi ${b.trainer.name.split(" ")[0]}, the team sent ${s(b.report.answers.dogName)}'s report back:</p><blockquote style="font-family:Arial,sans-serif;font-size:15px;border-left:4px solid #6B4FE0;margin:10px 0;padding:4px 14px;color:#333">${s(note).replace(/</g, "&lt;").replace(/\n/g, "<br>")}</blockquote><p><a href="${link}" style="background:#2A1971;color:#fff;padding:10px 18px;border-radius:9px;text-decoration:none;font-weight:bold">Open the report</a></p>` }).catch(() => {});
    }
    const { data: next } = await sb.from("reports").select("id").eq("status", "submitted").neq("id", id).order("submitted_at", { ascending: true }).limit(1);
    revalidatePath("/", "layout");
    return { ok: true, message: "Sent back to the trainer.", nextId: next?.[0]?.id || null };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

export async function resendReportAction(id: string): Promise<ReportResult> {
  if (isDemo()) return DEMO;
  try { if ((await who()).role !== "admin") return { ok: false, message: "Admins only." }; } catch (e) { return { ok: false, message: (e as Error).message }; }
  const r = await deliver(id, false);
  revalidatePath(`/a/reports/${id}`);
  return r.ok ? { ...r, message: r.message.replace("Approved and sent", "Sent again") } : r;
}

export async function setReportsEnabledAction(bookingId: string, on: boolean): Promise<ReportResult> {
  if (isDemo()) return DEMO;
  try {
    if ((await who()).role !== "admin") return { ok: false, message: "Admins only." };
    const { error } = await serverClient().from("bookings").update({ reports_enabled: on }).eq("id", bookingId);
    revalidatePath("/", "layout");
    return error ? { ok: false, message: error.message } : { ok: true, message: on ? "Reports are on for this booking." : "Reports are off for this booking." };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}
export type { Status, Kind };
