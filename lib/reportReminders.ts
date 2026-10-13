import "server-only";
import { serviceClient } from "./supabase";
import { mailConfigured, sendMail } from "./mail";
import { BRAND_LOGO_PNG_BASE64 } from "./brandLogo";
import { etParts } from "./chatRules";
import { addDays } from "./dates";
import { BookingForReports, Kind, expectedReports, kindName } from "./reports";

// "Your form is open" when a form becomes available, and "due today" on its last day if it still isn't done.
// One email per trainer per run (several dogs = one email). Each reminder is recorded, so nobody gets it twice.
const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const dayName = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

type Item = { bookingId: string; kind: Kind; week: number; stage: "open" | "due"; dog: string; deadline: string };

export async function runReportReminders(now = new Date()) {
  const out = { trainers: 0, items: 0, errors: [] as string[], skipped: "" };
  const { date: today, hour } = etParts(now);
  if (hour < 8 || hour >= 20) { out.skipped = "outside 8 am to 8 pm Eastern"; return out; }
  if (!mailConfigured()) { out.skipped = "email isn't set up"; return out; }
  const sb = serviceClient();
  const { data: bks } = await sb.from("bookings").select("id, trainer_id, client_name, dog_name, start_date, end_date, status, weeks, reports_enabled").eq("reports_enabled", true).neq("status", "cancelled").gte("end_date", addDays(today, -5)).lte("start_date", addDays(today, 1));
  const bookings = (bks || []) as (BookingForReports & { dog_name: string | null })[];
  if (!bookings.length) return out;
  const ids = bookings.map((b) => b.id);
  const [{ data: reps }, { data: sent }] = await Promise.all([
    sb.from("reports").select("booking_id, kind, week_number, status").in("booking_id", ids),
    sb.from("report_reminders").select("booking_id, kind, week_number, stage").in("booking_id", ids)
  ]);

  const byTrainer = new Map<string, Item[]>();
  for (const b of bookings) for (const w of expectedReports(b)) {
    const done = (reps || []).some((r: { booking_id: string; kind: string; week_number: number; status: string }) => r.booking_id === b.id && r.kind === w.kind && r.week_number === w.week && (r.status === "submitted" || r.status === "approved"));
    if (done) continue;
    const wasSent = (stage: string) => (sent || []).some((r: { booking_id: string; kind: string; week_number: number; stage: string }) => r.booking_id === b.id && r.kind === w.kind && r.week_number === w.week && r.stage === stage);
    const stages: ("open" | "due")[] = [];
    if (today >= w.opens && today <= w.deadline && !wasSent("open")) stages.push("open");                 // opened (or opened while we weren't looking)
    if (today === w.deadline && w.opens !== w.deadline && !wasSent("due")) stages.push("due");            // last day, still not done
    if (stages.length) byTrainer.set(b.trainer_id, [...(byTrainer.get(b.trainer_id) || []), { bookingId: b.id, kind: w.kind, week: w.week, stage: stages.includes("due") ? "due" : "open", dog: b.dog_name || "the dog", deadline: w.deadline }]);
  }
  if (!byTrainer.size) return out;

  const { data: ts } = await sb.from("trainers").select("id, name, email, dogwise_email").in("id", [...byTrainer.keys()]);
  for (const t of (ts || []) as { id: string; name: string; email: string | null; dogwise_email: string | null }[]) {
    const to = t.email || t.dogwise_email, list = byTrainer.get(t.id) || [];
    if (!to || !list.length) continue;
    try {
      const due = list.filter((i) => i.stage === "due"), open = list.filter((i) => i.stage === "open");
      const line = (i: Item) => `${kindName(i.kind)} for ${i.dog}: ${i.kind === "weekly" ? `by Friday (${dayName(i.deadline)})` : i.kind === "intake" ? "on pickup day, today" : `by ${dayName(i.deadline)}`}`;
      const penalty = list.some((i) => i.kind === "weekly") ? "Weekly health checks sent late (after Friday) or missed carry a $100 penalty." : "";
      const first = t.name.replace(/".*?"\s*/, "").split(" ")[0];
      const subject = due.length ? `Due today: ${due.map((i) => `${kindName(i.kind).toLowerCase()} for ${i.dog}`).join(", ")}` : `${list.length === 1 ? "A form is" : `${list.length} forms are`} ready for you`;
      const link = `${site()}/t/reports`;
      await sendMail({
        to, subject,
        text: `Hi ${first},\n${due.length ? `\nDue today:\n${due.map(line).join("\n")}\n` : ""}${open.length ? `\nNow open:\n${open.map(line).join("\n")}\n` : ""}\n${penalty}\nOpen your forms: ${link}`,
        html: `<div style="background:#f4f5f8;padding:24px 12px;font-family:Arial,sans-serif"><div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E7E3F3;border-radius:16px;padding:24px"><img src="cid:dogwise-logo" width="130" alt="Dogwise Academy" style="display:block;margin-bottom:14px"><p style="font-size:16px;font-weight:bold;color:#2A1971;margin:0 0 10px">Hi ${esc(first)}, ${due.length ? "something is due today" : "a form is ready for you"}</p>
          ${due.length ? `<p style="font-size:14px;font-weight:bold;color:#C2415D;margin:0 0 4px">Due today</p>${due.map((i) => `<p style="font-size:15px;margin:0 0 6px">${esc(line(i))}</p>`).join("")}` : ""}
          ${open.length ? `<p style="font-size:14px;font-weight:bold;color:#2A1971;margin:12px 0 4px">Now open</p>${open.map((i) => `<p style="font-size:15px;margin:0 0 6px">${esc(line(i))}</p>`).join("")}` : ""}
          ${penalty ? `<p style="font-size:13px;color:#6B6880;margin:14px 0 0">${esc(penalty)}</p>` : ""}
          <p style="margin:18px 0 0"><a href="${link}" style="background:#2A1971;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:bold;display:inline-block">Open my forms</a></p></div></div>`,
        attachments: [{ filename: "dogwise.png", content: Buffer.from(BRAND_LOGO_PNG_BASE64, "base64"), contentType: "image/png", cid: "dogwise-logo" }]
      });
      // record every reminder this email covered ("due" implies "open" too, so they don't get both later)
      for (const i of list) for (const stage of i.stage === "due" ? (["open", "due"] as const) : (["open"] as const)) await sb.from("report_reminders").insert({ booking_id: i.bookingId, kind: i.kind, week_number: i.week, stage });
      out.trainers++; out.items += list.length;
    } catch (e) { out.errors.push(`${t.name}: ${(e as Error).message}`); }
  }
  return out;
}
