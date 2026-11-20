import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib";
import { serviceClient } from "./supabase";
import { auditSystem } from "./audit";
import { mailConfigured, sendMail } from "./mail";
import { fileBytes } from "./drive";
import { claim } from "./announce";
import { BRAND_LOGO_PNG_BASE64 } from "./brandLogo";
import { createHash } from "crypto";

// Terms & Conditions (migration 063). When a client types their name to agree (the before-training form in the app, or the
// HubSpot form), the app keeps a record (who, when, from where, which version) and sends ONE warm welcome email: what
// happens next, what to pack, how updates work. At the very bottom, in small print, a line saying a copy of what they
// agreed to is attached. It is a welcome email first, so it doesn't send them back over the terms; the attachment is there
// for their records and ours. The terms' text lives in app_settings (terms.text, terms.data, terms.version), edited on
// /a/terms; until it's pasted in, the copy names the version on the website.

export const TERMS_URL = () => process.env.TERMS_URL || "https://www.dogwiseacademy.com/termsandconditions";
const PACKING_ID = () => process.env.PACKING_LIST_DRIVE_ID || "1cXvyOXDTJukhJpbQ8RN8tY8vaig7tq70";
export const PACKING_URL = () => process.env.PACKING_LIST_URL || `https://drive.google.com/file/d/${PACKING_ID()}/view`;

/** How we use their information and the app, when the terms don't already say it. A starting point: Sean or a lawyer
 *  should read it before it goes out (edit it on /a/terms). */
export const DEFAULT_DATA_TEXT = `How we use your information and the app

What we keep: your contact details, your dog's details and health information (including vaccine records), the answers you give us before training, and the messages, photos and videos shared in your dog's chat.

Why: to run your dog's program, keep you updated, keep your dog safe and healthy, take payment, and support you after training.

Who sees it: your trainer and the Dogwise Academy team. We use trusted service providers to run the app and our business (for example for hosting, email, text messages, payments, our customer records, file storage, and AI tools that help us read and summarise messages so nothing is missed). They only use your information to provide those services to us.

How long: for as long as we work with you, and afterwards only as long as we need to for records, follow-up support, or legal reasons.

Your choices: you can ask us for a copy of your information, to correct it, or to delete it, by replying to any of our emails.`;

export type Terms = { text: string; data: string; version: string; url: string };
export async function getTerms(sb: SupabaseClient = serviceClient()): Promise<Terms> {
  const { data } = await sb.from("app_settings").select("key, value").in("key", ["terms.text", "terms.data", "terms.version"]);
  const v = new Map(((data || []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  const str = (k: string) => (typeof v.get(k) === "string" ? String(v.get(k)) : "");
  return { text: str("terms.text"), data: str("terms.data") || DEFAULT_DATA_TEXT, version: str("terms.version") || "as published on the website", url: TERMS_URL() };
}

// ── The agreement PDF (Helvetica only takes plain Western characters, so anything else is swapped out) ──
const safe = (s: string) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...").replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/g, "");
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split(/\n/)) {
    if (!para.trim()) { out.push(""); continue; }
    let line = "";
    for (const w of para.split(/\s+/)) {
      const t = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) <= width) line = t; else { if (line) out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}
export type AgreementRecord = {
  id: string; name: string; email: string; dogs: string; program?: string; dates?: string; trainer?: string;
  at: string; ip?: string | null; userAgent?: string | null; source: string; readConfirmed: boolean; hash: string; terms: Terms;
};
const device = (ua?: string | null) => {
  const u = ua || ""; if (!u) return "";
  const os = /iPhone|iPad/.test(u) ? "iPhone / iPad" : /Android/.test(u) ? "Android" : /Mac OS X/.test(u) ? "Mac" : /Windows/.test(u) ? "Windows" : "";
  const br = /CriOS|Chrome\//.test(u) && !/Edg\//.test(u) ? "Chrome" : /Edg\//.test(u) ? "Edge" : /Firefox|FxiOS/.test(u) ? "Firefox" : /Safari\//.test(u) ? "Safari" : "";
  return [os, br].filter(Boolean).join(", ") || u.slice(0, 80);
};

/** A formal record of acceptance, then the terms and the information section: the copy a payment provider can be shown. */
export async function agreementPdf(r: AgreementRecord): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Record of acceptance: ${safe(r.name)}`); pdf.setAuthor("Dogwise Academy"); pdf.setCreationDate(new Date(r.at));
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold), sig = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const logo = await pdf.embedPng(Buffer.from(BRAND_LOGO_PNG_BASE64, "base64")).catch(() => null);
  const W = 612, H = 792, M = 54, ink = rgb(0.16, 0.09, 0.44), body = rgb(0.12, 0.12, 0.18), soft = rgb(0.42, 0.41, 0.5), rule = rgb(0.86, 0.85, 0.92);
  let page = pdf.addPage([W, H]), y = H - M;
  const newPage = () => { page = pdf.addPage([W, H]); y = H - M; };
  const text = (t: string, o: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; gap?: number; x?: number; width?: number } = {}) => {
    const f = o.f || font, size = o.size || 10, x = o.x ?? M;
    for (const l of wrap(t, f, size, o.width || W - M - x)) { if (y < M + 30) newPage(); if (l) page.drawText(l, { x, y: y - size, size, font: f, color: o.color || body }); y -= size + (o.gap ?? 4); }
  };
  // Header
  if (logo) { const w = 120, h = (logo.height / logo.width) * w; page.drawImage(logo, { x: M, y: y - h, width: w, height: h }); }
  page.drawText("RECORD OF ACCEPTANCE", { x: W - M - bold.widthOfTextAtSize("RECORD OF ACCEPTANCE", 9), y: y - 10, size: 9, font: bold, color: soft });
  page.drawText(`No. ${r.id.slice(0, 8).toUpperCase()}`, { x: W - M - font.widthOfTextAtSize(`No. ${r.id.slice(0, 8).toUpperCase()}`, 9), y: y - 23, size: 9, font, color: soft });
  y -= 62;
  text("Terms & Conditions: record of client acceptance", { f: bold, size: 16, color: ink, gap: 10 });
  const when = new Date(r.at);
  const local = when.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
  text(`On ${local}, ${safe(r.name)} accepted the Dogwise Academy Terms & Conditions set out in full in this document, by ${r.readConfirmed ? "ticking the box \"I have read and agree to the Dogwise Academy Terms & Conditions\" and " : ""}typing their full name as their signature${r.source === "hubspot" ? " in the before-training form" : " in the Dogwise Academy app"}.`, { size: 10.5, gap: 5 });
  y -= 8;
  // The record, as a table
  const rows: [string, string][] = [
    ["Client", safe(r.name)], ["Email", r.email || "-"], ["Dog(s)", r.dogs || "-"],
    ...(r.program ? [["Program", r.program] as [string, string]] : []), ...(r.dates ? [["Program dates", r.dates] as [string, string]] : []), ...(r.trainer ? [["Trainer", r.trainer] as [string, string]] : []),
    ["Read the terms", r.readConfirmed ? "Yes: ticked \"I have read and agree to the Dogwise Academy Terms & Conditions\"" : "Not recorded (agreed by typing their name)"],
    ["Date and time", `${local}  (${when.toISOString().replace(".000Z", "Z")} UTC)`],
    ["Method", r.source === "hubspot" ? "Dogwise Academy before-training form" : r.source === "admin" ? "Entered by the Dogwise Academy office" : "Dogwise Academy app, before-training details"],
    ...(r.ip ? [["IP address", r.ip] as [string, string]] : []), ...(device(r.userAgent) ? [["Device", device(r.userAgent)] as [string, string]] : []),
    ["Terms version", r.terms.version], ["Terms published at", r.terms.url], ["Terms fingerprint", `SHA-256 ${r.hash.slice(0, 32)}…`], ["Record ID", r.id]
  ];
  const labelW = 132;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: rule });
  for (const [k, v] of rows) {
    const lines = wrap(v, font, 10, W - 2 * M - labelW - 8), h = Math.max(1, lines.length) * 14 + 8;
    if (y - h < M + 30) newPage();
    page.drawText(k, { x: M, y: y - 15, size: 9.5, font: bold, color: soft });
    lines.forEach((l, n) => page.drawText(l, { x: M + labelW, y: y - 15 - n * 14, size: 10, font, color: body }));
    y -= h; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rule });
  }
  // Signature block
  y -= 26; if (y < M + 90) newPage();
  page.drawText(safe(r.name), { x: M, y: y - 22, size: 22, font: sig, color: ink });
  y -= 30; page.drawLine({ start: { x: M, y }, end: { x: M + 260, y }, thickness: 0.8, color: body });
  page.drawText("Signed electronically (typed name)", { x: M, y: y - 12, size: 8.5, font, color: soft });
  page.drawText(when.toLocaleDateString("en-US", { timeZone: "America/New_York", year: "numeric", month: "long", day: "numeric" }), { x: M + 300, y: y + 6, size: 11, font, color: body });
  page.drawLine({ start: { x: M + 300, y }, end: { x: W - M, y }, thickness: 0.8, color: body });
  page.drawText("Date", { x: M + 300, y: y - 12, size: 8.5, font, color: soft });
  y -= 36;
  text("This record was created automatically by the Dogwise Academy app at the moment of acceptance and has not been edited. A copy was emailed to the client at the address above. The fingerprint identifies the exact text of the terms that follow.", { size: 8.5, color: soft, gap: 3 });
  // The terms, then how information is used
  newPage();
  text(`Dogwise Academy Terms & Conditions`, { f: bold, size: 14, color: ink, gap: 4 });
  text(`Version: ${r.terms.version} · ${r.terms.url}`, { size: 9, color: soft, gap: 12 });
  if (r.terms.text.trim()) text(r.terms.text, { size: 9.5, gap: 3 });
  else text(`The full Terms & Conditions are published at ${r.terms.url}.`, { size: 10 });
  if (r.terms.data.trim()) { y -= 14; text(r.terms.data.split("\n")[0], { f: bold, size: 12, color: ink, gap: 6 }); text(r.terms.data.split("\n").slice(1).join("\n"), { size: 9.5, gap: 3 }); }
  // Footer on every page
  const pages = pdf.getPages();
  pages.forEach((p, n) => { const f = `Dogwise Academy · Record of acceptance ${r.id.slice(0, 8).toUpperCase()} · Page ${n + 1} of ${pages.length}`; p.drawText(f, { x: (W - font.widthOfTextAtSize(f, 8)) / 2, y: 26, size: 8, font, color: soft }); });
  return pdf.save();
}

// ── The record and the welcome ──
type Contact = Record<string, unknown>;
/** A client has just agreed (typed their name). Records it, and sends the welcome once per deal. Never throws. */
export async function onSigned(o: { dealId: string; name: string; source: "app" | "hubspot" | "admin"; ip?: string | null; userAgent?: string | null; contact?: Contact; readConfirmed?: boolean }, sb: SupabaseClient = serviceClient()) {
  try {
    const name = o.name.replace(/\s+/g, " ").trim().slice(0, 120);
    if (name.length < 2) return;
    const terms = await getTerms(sb);
    const { data: row } = await sb.from("pretraining_deals").select("contact").eq("deal_id", o.dealId).maybeSingle();
    const c = { ...((row?.contact || {}) as Contact), ...(o.contact || {}) };
    const email = String(c.email || "").trim();
    // The same agreement seen twice (the app, then the HubSpot sync): one record
    const { data: dup } = await sb.from("terms_acceptances").select("id").eq("deal_id", o.dealId).ilike("name", name).gte("at", new Date(Date.now() - 30 * 864e5).toISOString()).limit(1);
    if (dup?.length) return;
    const hash = createHash("sha256").update(`${terms.text}\n---\n${terms.data}`).digest("hex");
    const { data: bks } = await sb.from("bookings").select("dog_name, program, start_date, end_date, trainers(name)").eq("hubspot_deal_id", o.dealId).neq("status", "cancelled").order("start_date");
    const dogs = ((bks || []) as unknown as { dog_name: string | null; program: string | null; start_date: string; end_date: string; trainers: { name: string } | null }[]);
    const program = dogs[0]?.program || "";
    const base = { deal_id: o.dealId, contact_email: email || null, name, source: o.source, ip: o.ip || null, user_agent: (o.userAgent || "").slice(0, 300) || null, terms_url: terms.url, terms_version: terms.version };
    const first1 = await sb.from("terms_acceptances").insert({ ...base, read_confirmed: !!o.readConfirmed, terms_hash: hash, program: program || null }).select("id, at").maybeSingle();
    const res = first1.error && /read_confirmed|terms_hash|program/i.test(first1.error.message) ? await sb.from("terms_acceptances").insert(base).select("id, at").maybeSingle() : first1; // before migration 064
    const rec = res.data as { id: string; at: string } | null;
    if (res.error || !rec) return; // migration 063 not run yet
    await auditSystem("Terms & Conditions agreed", `${name} (${email || "no email"}), deal ${o.dealId}, via ${o.source}.`).catch(() => null);
    if (!email || !mailConfigured()) return;

    // A welcome only before training starts: an older client whose signature turns up late gets the record, not an email
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    if (dogs.length && dogs.every((d) => d.start_date < today)) return;
    if (!(await claim(`welcome:${o.dealId}`))) return; // one welcome per client deal
    const dogNames = dogs.map((d) => d.dog_name).filter(Boolean).join(" & ") || "your dog";
    const first = String(c.firstname || name.split(" ")[0] || "there");
    const start = dogs[0]?.start_date, trainer = dogs[0]?.trainers?.name?.split(" ")[0];
    const day = (iso?: string) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }) : "");
    const usDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
    const pdf = await agreementPdf({ id: rec.id, name, email, dogs: dogNames, program: program || undefined, dates: dogs[0] ? `${usDay(dogs[0].start_date)} to ${usDay(dogs[0].end_date)}` : undefined, trainer: dogs[0]?.trainers?.name,
      at: rec.at, ip: o.ip, userAgent: o.userAgent, source: o.source, readConfirmed: !!o.readConfirmed, hash, terms });
    const packing = await fileBytes(PACKING_ID(), 5_000_000).catch(() => null);
    const p = (t: string) => `<p style="margin:0 0 14px">${t}</p>`;
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1d1640;max-width:560px">
${p(`Hi ${first},`)}
${p(`Welcome to Dogwise Academy! We're so happy to have ${dogNames} with us, and we can't wait to get started.`)}
${start ? p(`<b>What happens next</b><br>${trainer ? `${trainer}, your trainer,` : "Your trainer"} will pick ${dogNames} up on ${day(start)}. From then on you'll get updates in your private chat with your trainer: photos, videos and notes on how ${dogNames.includes("&") ? "they're" : "it's"} going, at least every 24 hours. Message us any time between 9am and 10pm, and you'll hear back within about 3 hours.`) : ""}
${p(`At the end there's a handover session of about an hour or two, where your trainer shows you everything ${dogNames} has learned, and you have a month of support afterwards to keep it going at home.`)}
${p(`<b>What to pack</b><br>Everything ${dogNames} will need is in our packing list${packing ? " (attached)" : ""}: <a href="${PACKING_URL()}" style="color:#5b3fd0">open the packing list</a>. The short version: their usual food (plus 3 extra days), any medication with instructions, and keep them leashed or crated when your trainer arrives.`)}
${p(`If you have any questions at all, just reply to this email.`)}
${p(`See you soon,<br>The Dogwise Academy team 🐾`)}
<p style="margin:28px 0 0;font-size:12px;line-height:1.45;color:#8a86a0">For your records, a copy of the Terms &amp; Conditions you agreed to on ${new Date(rec?.at || Date.now()).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" })} is attached.</p>
</div>`;
    const text = `Hi ${first},\n\nWelcome to Dogwise Academy! We're so happy to have ${dogNames} with us.\n\n${start ? `${trainer || "Your trainer"} will pick ${dogNames} up on ${day(start)}. You'll get updates in your private chat at least every 24 hours; message us between 9am and 10pm and you'll hear back within about 3 hours.\n\n` : ""}At the end there's a handover session, and a month of support afterwards.\n\nWhat to pack: ${PACKING_URL()}\n\nAny questions, just reply.\n\nThe Dogwise Academy team\n\nFor your records, a copy of the Terms & Conditions you agreed to is attached.`;
    const slug = dogNames.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dog";
    try {
      await sendMail({ to: email, subject: `Welcome to Dogwise Academy, ${first}! 🐾`, html, text, attachments: [
        { filename: `Dogwise-Academy-agreement-${slug}.pdf`, content: pdf, contentType: "application/pdf" },
        ...(packing ? [{ filename: "Dogwise-Academy-packing-list.pdf", content: packing, contentType: "application/pdf" }] : [])
      ] });
      if (rec) await sb.from("terms_acceptances").update({ emailed_at: new Date().toISOString() }).eq("id", rec.id);
    } catch (e) { if (rec) await sb.from("terms_acceptances").update({ email_error: (e as Error).message.slice(0, 300) }).eq("id", rec.id); }
  } catch { /* never in the way of saving their answers */ }
}
