import "server-only";
import { pushToAdmins } from "./push";
import { mailConfigured, sendMail } from "./mail";
import { BRAND_LOGO_PNG_BASE64 } from "./brandLogo";

/** The office inbox for money matters (refunds, partial pay). OFFICE_EMAIL overrides it. */
export const officeEmail = () => (process.env.OFFICE_EMAIL || "info@dogwiseacademy.com").trim();

/** Tells the admins: a phone notification always; an EMAIL only when `email: true`. Admin emails are one a day: the 8 AM
 *  Eastern "To do today" summary (lib/digest.ts), plus a trainer's incident report (injury, bite, escape) straight away.
 *  Everything else is on To do and in that summary. ADMIN_NOTIFY_EMAIL can hold several addresses, separated by commas. */
export async function alertAdmins(subject: string, intro: string, lines: { text: string; link: string }[], button?: { label: string; link: string }, opts: { alsoTo?: string[]; email?: boolean } = {}) {
  const list = [...(process.env.ADMIN_NOTIFY_EMAIL || process.env.PAYROLL_NOTIFY_EMAIL || "").split(","), ...(opts.alsoTo || [])].map((s) => s.trim()).filter(Boolean);
  const to = [...new Map(list.map((a) => [a.toLowerCase(), a])).values()];
  // Admins' phones too (anyone who turned notifications on)
  await pushToAdmins({ title: subject, body: intro, url: (lines[0]?.link || button?.link || "/a").replace(/^https?:\/\/[^/]+/, ""), tag: subject.slice(0, 60) });
  if (!opts.email || !to.length || !mailConfigured()) return false;
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  await sendMail({
    to: to.join(", "), subject,
    text: `${intro}\n\n${lines.map((l) => `- ${l.text}\n  ${l.link}`).join("\n")}${button ? `\n\n${button.label}: ${button.link}` : ""}`,
    html: `<div style="background:#f4f5f8;padding:24px 12px;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E7E3F3;border-radius:16px;padding:24px">
      <img src="cid:dogwise-logo" width="130" alt="Dogwise Academy" style="display:block;margin-bottom:14px">
      <p style="font-size:16px;font-weight:bold;color:#281870;margin:0 0 12px">${esc(intro)}</p>
      ${lines.map((l) => `<p style="font-size:15px;color:#333;margin:0 0 8px;line-height:1.45">${esc(l.text)} <a href="${l.link}" style="color:#6E4FE0;font-weight:bold">Open</a></p>`).join("")}
      ${button ? `<p style="margin:18px 0 0"><a href="${button.link}" style="background:#281870;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:bold;display:inline-block">${esc(button.label)}</a></p>` : ""}
    </div></div>`,
    attachments: [{ filename: "dogwise.png", content: Buffer.from(BRAND_LOGO_PNG_BASE64, "base64"), contentType: "image/png", cid: "dogwise-logo" }]
  });
  return true;
}
