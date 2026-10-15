import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mailConfigured, sendMail } from "./mail";
import { BRAND_LOGO_PNG_BASE64 } from "./brandLogo";
import { addDays, toDate } from "./dates";
import { usDate } from "./payroll";

// Booking emails to trainers, from info@: new / changed / cancelled, with a calendar invite (.ics)
// and a button into the app. Never blocks a booking: failures are returned, not thrown.

export type BookingMailKind = "new" | "changed" | "cancelled";
type B = { id: string; trainer_id: string; client_name: string; dog_name: string | null; program: string | null; start_date: string; end_date: string; weeks: number | null; extra_days?: number | null; rehab?: boolean | null; notes: string | null; status: string };

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (iso: string) => iso.replace(/-/g, "");
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
// RFC 5545: lines over 75 octets are folded
const fold = (line: string) => line.length <= 74 ? line : line.match(/.{1,73}/g)!.map((p, i) => (i ? " " + p : p)).join("\r\n");
const long = (iso: string) => toDate(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function bookingIcs(b: B, trainer: { name: string; email: string }, kind: BookingMailKind, site: string) {
  const organizer = process.env.SMTP_USER || "info@dogwiseacademy.com";
  const title = `${b.dog_name || "Dog"} (${b.client_name}) with Dogwise`;
  const lines = [
    "BEGIN:VCALENDAR", "PRODID:-//Dogwise Academy//Trainers//EN", "VERSION:2.0", "CALSCALE:GREGORIAN",
    `METHOD:${kind === "cancelled" ? "CANCEL" : "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:booking-${b.id}@dogwisetrainers`,
    `SEQUENCE:${Math.floor(Date.now() / 1000)}`,
    `DTSTAMP:${stamp()}`,
    `DTSTART;VALUE=DATE:${icsDate(b.start_date)}`,
    `DTEND;VALUE=DATE:${icsDate(addDays(b.end_date, 1))}`,
    `SUMMARY:${icsText(kind === "cancelled" ? `Cancelled: ${title}` : title)}`,
    `DESCRIPTION:${icsText(`${b.program || `${b.weeks}-week`}${b.extra_days ? ` + ${b.extra_days} days` : ""}. ${b.notes ? `Notes: ${b.notes}. ` : ""}Open in the Dogwise Academy app: ${site}/t`)}`,
    `URL:${site}/t`,
    `ORGANIZER;CN=Dogwise Academy:mailto:${organizer}`,
    `ATTENDEE;CN=${icsText(trainer.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${trainer.email}`,
    `STATUS:${kind === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:TRANSPARENT",
    ...(kind === "cancelled" ? [] : ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(title)} starts tomorrow`, "TRIGGER:-P1D", "END:VALARM"]),
    "END:VEVENT", "END:VCALENDAR"
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function bookingEmailHtml(b: B, trainerName: string, kind: BookingMailKind, site: string) {
  const first = trainerName.replace(/".*?"\s*/, "").split(" ")[0];
  const head = { new: "New booking", changed: "Booking updated", cancelled: "Booking cancelled" }[kind];
  const intro = {
    new: `Hi ${esc(first)}, you've got a new dog booked in.`,
    changed: `Hi ${esc(first)}, one of your bookings has changed. Here are the latest details.`,
    cancelled: `Hi ${esc(first)}, this booking has been cancelled. The kennel is free again.`
  }[kind];
  const color = kind === "cancelled" ? "#C2415D" : "#2A1971";
  const row = (k: string, v: string) => `<tr><td style="padding:8px 0;color:#6B6880;font-size:13px;width:110px;vertical-align:top">${k}</td><td style="padding:8px 0;font-size:15px;color:#1C1734">${v}</td></tr>`;
  return `<div style="background:#f4f5f8;padding:24px 12px;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #E7E3F3">
    <div style="height:6px;background:${kind === "cancelled" ? "#C2415D" : "linear-gradient(90deg,#2A1971,#6B4FE0)"}"></div>
    <div style="padding:24px 26px">
      <img src="cid:dogwise-logo" alt="Dogwise Academy" width="140" style="display:block;height:auto">
      <div style="font-size:22px;font-weight:800;color:${color};margin-top:18px">${head}</div>
      <p style="font-size:15px;color:#41395E;margin:6px 0 16px">${intro}</p>
      <table role="presentation" width="100%" style="border-collapse:collapse;background:#F4F1FF;border-radius:12px"><tr><td style="padding:6px 16px">
        <table role="presentation" width="100%" style="border-collapse:collapse">
          ${row("Dog", `<b>${esc(b.dog_name || "Not named yet")}</b>`)}
          ${row("Client", esc(b.client_name))}
          ${row("Program", `${esc(b.program || `${b.weeks}-week`)}${b.extra_days ? ` + ${b.extra_days} day${b.extra_days > 1 ? "s" : ""}` : ""}${b.rehab ? " (rehab)" : ""}`)}
          ${row("Dates", `${long(b.start_date)} to ${long(b.end_date)}`)}
          ${b.notes ? row("Notes", esc(b.notes).replace(/\n/g, "<br>")) : ""}
        </table>
      </td></tr></table>
      ${kind === "cancelled" ? "" : `<p style="font-size:13px;color:#6B6880;margin:14px 0 0">The calendar invite is attached: accept it to add the dates to your calendar, with a reminder the day before.</p>`}
      <a href="${site}/t" style="display:inline-block;margin-top:18px;background:#2A1971;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">Open my bookings</a>
    </div>
    <div style="padding:12px 26px;background:#FAF9FD;border-top:1px solid #E7E3F3;font-size:12px;color:#6B6880">Questions? Reply to this email or message the team in the app.</div>
  </div></div>`;
}

/** Email the trainer about bookings. Returns a short status for the admin, never throws. */
export async function notifyBookings(sb: SupabaseClient, bookingIds: string[], kind: BookingMailKind): Promise<{ sent: number; skipped?: string; errors: string[] }> {
  if (!bookingIds.length) return { sent: 0, errors: [] };
  if (!mailConfigured()) return { sent: 0, skipped: "Email isn't set up yet, so the trainer wasn't emailed.", errors: [] };
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  const { data: rows } = await sb.from("bookings").select("*, trainers(name, email, dogwise_email)").in("id", bookingIds);
  let sent = 0; const errors: string[] = [];
  for (const r of (rows || []) as (B & { trainers: { name: string; email: string | null; dogwise_email: string | null } | null })[]) {
    const t = r.trainers, to = t?.email || t?.dogwise_email;
    if (!t || !to) { errors.push(`${t?.name || "Trainer"} has no email on their profile`); continue; }
    const subject = { new: "New booking", changed: "Booking updated", cancelled: "Booking cancelled" }[kind] +
      `: ${r.dog_name || "dog"} (${r.client_name}), ${usDate(r.start_date)} to ${usDate(r.end_date)}`;
    const text = `${subject}\n\nDog: ${r.dog_name || "Not named yet"}\nClient: ${r.client_name}\nProgram: ${r.program || `${r.weeks}-week`}${r.extra_days ? ` + ${r.extra_days} days` : ""}\nDates: ${usDate(r.start_date)} to ${usDate(r.end_date)}${r.notes ? `\nNotes: ${r.notes}` : ""}\n\nOpen my bookings: ${site}/t`;
    try {
      await sendMail({
        to, subject, text, html: bookingEmailHtml(r, t.name, kind, site),
        attachments: [
          { filename: "dogwise.png", content: Buffer.from(BRAND_LOGO_PNG_BASE64, "base64"), contentType: "image/png", cid: "dogwise-logo" },
          { filename: kind === "cancelled" ? "cancel.ics" : "invite.ics", content: Buffer.from(bookingIcs(r, { name: t.name, email: to }, kind, site)), contentType: `text/calendar; charset=utf-8; method=${kind === "cancelled" ? "CANCEL" : "REQUEST"}` }
        ]
      });
      sent++;
      if (kind === "new") await sb.from("bookings").update({ notified_at: new Date().toISOString() }).eq("id", r.id); // the safety net skips it
    } catch (e) { errors.push(`${t.name}: ${(e as Error).message}`); }
  }
  return { sent, errors };
}

export const notifySummary = (n: { sent: number; skipped?: string; errors: string[] }) =>
  n.skipped ? ` ${n.skipped}` : n.errors.length ? ` Email to trainer failed: ${n.errors[0]}` : n.sent ? " Trainer emailed." : "";
