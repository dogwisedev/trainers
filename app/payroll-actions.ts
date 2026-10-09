"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/data";
import { isDemo, serverClient } from "@/lib/supabase";
import { buildDrafts, getPayslip, recalc, toSlipData } from "@/lib/payrollData";
import { RATE_FIELDS } from "@/lib/payroll";
import { payslipHtml, payslipText } from "@/lib/payslipDoc";
import { payslipPdf } from "@/lib/payslipPdf";
import { sendMail } from "@/lib/mail";
import { BRAND_LOGO_PNG_BASE64 } from "@/lib/brandLogo";
import { usDate, periodLabel } from "@/lib/payroll";
import type { Result } from "./actions";

const DEMO: Result = { ok: false, message: "Demo mode: connect Supabase to save payroll." };
async function admin() {
  const v = await getViewer();
  if (!v || v.role !== "admin") throw new Error("Admins only.");
  return v;
}

export async function buildDraftsAction(submitDate: string): Promise<Result> {
  if (isDemo()) return DEMO;
  await admin();
  try {
    const r = await buildDrafts(serverClient(), submitDate);
    revalidatePath("/a/payroll");
    return { ok: true, message: `${r.built} draft${r.built === 1 ? "" : "s"} built from bookings${r.skipped ? `, ${r.skipped} approved left as they are` : ""}${r.missingRates ? `. ${r.missingRates} line${r.missingRates === 1 ? "" : "s"} need a pay rate.` : "."}` };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

export type EditLine = { kind: string; booking_id?: string | null; weeks_completed?: number | null; days?: number | null; week_from?: number | null; pct?: number | null;
  client?: string | null; dog?: string | null; program?: string | null; description?: string | null; amount: number; auto?: boolean };

async function saveDraft(id: string, edit: { lines: EditLine[]; adjustments: number; notes: string }, allowApproved = false) {
  const sb = serverClient();
  const { data: slip } = await sb.from("payslips").select("status").eq("id", id).single();
  if (slip?.status === "approved" && !allowApproved) throw new Error("This payslip is approved. Use Edit to correct it.");
  await sb.from("payslip_lines").delete().eq("payslip_id", id);
  const rows = edit.lines.map((l, i) => ({
    payslip_id: id, kind: l.kind, booking_id: l.booking_id || null, weeks_completed: l.weeks_completed ?? null, days: l.days ?? null, week_from: l.week_from ?? null,
    pct: l.pct ?? null, client: l.client || null, dog: l.dog || null, program: l.program || null, description: l.description || null,
    amount: Math.round(Number(l.amount || 0) * 100) / 100, auto: !!l.auto, sort: i
  }));
  if (rows.length) { const { error } = await sb.from("payslip_lines").insert(rows); if (error) throw new Error(error.message); }
  await sb.from("payslips").update({ adjustments: Math.round(Number(edit.adjustments || 0) * 100) / 100, notes: edit.notes?.trim() || null }).eq("id", id);
  await recalc(sb, id);
}

export async function savePayslipAction(id: string, edit: { lines: EditLine[]; adjustments: number; notes: string }): Promise<Result> {
  if (isDemo()) return DEMO;
  await admin();
  try { await saveDraft(id, edit); revalidatePath(`/a/payroll/${id}`); return { ok: true, message: "Draft saved." }; }
  catch (e) { return { ok: false, message: (e as Error).message }; }
}

async function email(id: string, opts: { correctedFrom?: string | null } = {}): Promise<Result> {
  const p = await getPayslip(id);
  if (!p) return { ok: false, message: "Payslip not found." };
  const to = p.trainer?.email || p.trainer?.dogwise_email;
  const sb = serverClient();
  if (!to) { await sb.from("payslips").update({ send_error: "No email on the trainer's profile" }).eq("id", id); return { ok: false, message: "Approved, but the trainer has no email on their profile." }; }
  const d = toSlipData(p.slip, p.run, p.lines, p.trainer);
  try {
    const pdf = await payslipPdf(d);
    const site = process.env.NEXT_PUBLIC_SITE_URL || "";
    const html = `<div style="background:#f4f5f8;padding:24px 12px">
      ${opts.correctedFrom !== undefined ? `<p style="max-width:640px;margin:0 auto 12px;font-family:Arial,sans-serif;font-size:15px;color:#C2415D;font-weight:bold">Corrected payslip: this replaces the one we sent${opts.correctedFrom ? ` on ${new Date(opts.correctedFrom).toLocaleDateString("en-US")}` : ""}.</p>` : ""}
      <p style="max-width:640px;margin:0 auto 16px;font-family:Arial,sans-serif;font-size:15px;color:#333">Hi ${d.trainer_name.replace(/".*?"\s*/, "").split(" ")[0]}, here's your payslip for ${periodLabel(d.period_start, d.period_end)}. It will be paid on ${usDate(d.paid_date)}. The PDF is attached${site ? `, and it's in the app under <a href="${site}/t/pay">Pay</a>` : ""}.</p>
      ${payslipHtml(d, "cid:dogwise-logo")}
      <p style="max-width:640px;margin:16px auto 0;font-family:Arial,sans-serif;font-size:12px;color:#888">Questions? Reply to this email.</p></div>`;
    await sendMail({
      to, subject: `${opts.correctedFrom !== undefined ? "Corrected: " : ""}Your Dogwise payslip, paid ${usDate(d.paid_date)}`, html,
      text: (opts.correctedFrom !== undefined ? "CORRECTED PAYSLIP: this replaces the one we sent earlier.\n\n" : "") + payslipText(d),
      attachments: [
        { filename: `Payslip ${d.trainer_name.replace(/["\/]/g, "")} ${d.paid_date}.pdf`, content: pdf, contentType: "application/pdf" },
        { filename: "dogwise.png", content: Buffer.from(BRAND_LOGO_PNG_BASE64, "base64"), contentType: "image/png", cid: "dogwise-logo" }
      ]
    });
    await sb.from("payslips").update({ sent_at: new Date().toISOString(), sent_to: to, send_error: null }).eq("id", id);
    return { ok: true, message: opts.correctedFrom !== undefined ? `Corrected payslip sent to ${to}.` : `Approved and sent to ${to}.` };
  } catch (e) {
    await sb.from("payslips").update({ send_error: (e as Error).message }).eq("id", id);
    return { ok: false, message: `Approved, but the email failed: ${(e as Error).message}` };
  }
}

export async function approveAndSendAction(id: string, edit: { lines: EditLine[]; adjustments: number; notes: string }): Promise<Result> {
  if (isDemo()) return DEMO;
  const v = await admin();
  try {
    await saveDraft(id, edit);
    const sb = serverClient();
    const { data: slip } = await sb.from("payslips").select("trainer_id").eq("id", id).single();
    const { data: t } = await sb.from("trainers").select("name, address").eq("id", slip!.trainer_id).single();
    await sb.from("payslips").update({ status: "approved", approved_by: v.userId, approved_by_name: v.name, approved_at: new Date().toISOString(), trainer_name: t?.name, trainer_address: t?.address }).eq("id", id);
  } catch (e) { return { ok: false, message: (e as Error).message }; }
  const r = await email(id);
  revalidatePath("/a/payroll"); revalidatePath(`/a/payroll/${id}`);
  return r;
}

/** Approve the saved draft as it is (from the list) and email it. */
export async function approveAction(id: string): Promise<Result> {
  if (isDemo()) return DEMO;
  const v = await admin();
  const sb = serverClient();
  const { data: slip } = await sb.from("payslips").select("trainer_id, status, payslip_lines(kind, description)").eq("id", id).single();
  if (!slip) return { ok: false, message: "Payslip not found." };
  if (slip.status === "approved") return { ok: true, message: "Already approved." };
  if ((slip.payslip_lines || []).some((l: { kind: string; description: string | null }) => l.kind === "training" && /^No pay rate/.test(l.description || ""))) return { ok: false, message: "A line has no pay rate. Open it and fix the amount first." };
  const { data: t } = await sb.from("trainers").select("name, address").eq("id", slip.trainer_id).single();
  const { error } = await sb.from("payslips").update({ status: "approved", approved_by: v.userId, approved_by_name: v.name, approved_at: new Date().toISOString(), trainer_name: t?.name, trainer_address: t?.address }).eq("id", id);
  if (error) return { ok: false, message: error.message };
  const r = await email(id);
  revalidatePath("/a/trainers");
  return r;
}

export async function approveManyAction(ids: string[]): Promise<{ ok: boolean; message: string; results: Record<string, Result> }> {
  if (isDemo()) return { ...DEMO, results: {} };
  await admin();
  const results: Record<string, Result> = {};
  for (const id of ids.slice(0, 80)) results[id] = await approveAction(id);
  const good = Object.values(results).filter((r) => r.ok).length;
  return { ok: good === ids.length, message: `${good} of ${ids.length} approved and sent.`, results };
}

/** Fix an approved payslip and email the corrected version. It stays approved, so the trainer always sees a payslip. */
export async function correctAndResendAction(id: string, edit: { lines: EditLine[]; adjustments: number; notes: string }): Promise<Result> {
  if (isDemo()) return DEMO;
  const v = await admin();
  const sb = serverClient();
  const { data: before } = await sb.from("payslips").select("status, sent_at").eq("id", id).single();
  if (!before) return { ok: false, message: "Payslip not found." };
  try {
    await saveDraft(id, edit, true);
    await sb.from("payslips").update({ status: "approved", approved_by: v.userId, approved_by_name: v.name, approved_at: new Date().toISOString() }).eq("id", id);
  } catch (e) { return { ok: false, message: (e as Error).message }; }
  const r = await email(id, { correctedFrom: before.sent_at });
  revalidatePath("/a/trainers"); revalidatePath(`/a/payroll/${id}`);
  return r;
}

export async function resendAction(id: string): Promise<Result> {
  if (isDemo()) return DEMO;
  await admin();
  const r = await email(id);
  revalidatePath(`/a/payroll/${id}`);
  return r.ok ? { ok: true, message: r.message.replace("Approved and sent", "Sent again") } : r;
}

export async function reopenAction(id: string): Promise<Result> {
  if (isDemo()) return DEMO;
  await admin();
  const { error } = await serverClient().from("payslips").update({ status: "draft" }).eq("id", id);
  revalidatePath(`/a/payroll/${id}`); revalidatePath("/a/payroll");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Reopened. The trainer can't see it until you approve it again." };
}

export async function saveRatesAction(_: Result | null, f: FormData): Promise<Result> {
  if (isDemo()) return DEMO;
  await admin();
  const trainer_id = String(f.get("trainer_id") || "");
  const row: Record<string, unknown> = { trainer_id, updated_at: new Date().toISOString() };
  for (const [k] of RATE_FIELDS) { const v = String(f.get(k) ?? "").replace(/[$,\s]/g, ""); row[k] = v === "" ? null : Number(v); }
  const d = String(f.get("report_deduction") ?? "").replace(/[$,\s]/g, "");
  row.report_deduction = d === "" ? 100 : Number(d);
  const { error } = await serverClient().from("trainer_rates").upsert(row, { onConflict: "trainer_id" });
  revalidatePath(`/a/trainers/${trainer_id}`);
  return error ? { ok: false, message: error.message } : { ok: true, message: "Pay rates saved. Rebuild drafts to apply them." };
}
