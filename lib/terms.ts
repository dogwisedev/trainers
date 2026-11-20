import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib";
import { serviceClient } from "./supabase";
import { auditSystem } from "./audit";
import { mailConfigured, sendMail } from "./mail";
import { fileBytes } from "./drive";
import { claim } from "./announce";

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
export async function agreementPdf(o: { name: string; email: string; dogs: string; at: string; ip?: string | null; source: string; terms: Terms }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 56, ink = rgb(0.16, 0.09, 0.44), soft = rgb(0.35, 0.35, 0.42);
  let page = pdf.addPage([W, H]), y = H - M;
  const write = (text: string, f = font, size = 10.5, color = rgb(0.1, 0.1, 0.15), gap = 4) => {
    for (const l of wrap(text, f, size, W - 2 * M)) {
      if (y < M + size) { page = pdf.addPage([W, H]); y = H - M; }
      if (l) page.drawText(l, { x: M, y: y - size, size, font: f, color });
      y -= size + gap;
    }
  };
  const when = new Date(o.at).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "long", timeStyle: "short" });
  write("Dogwise Academy", bold, 20, ink, 6); y -= 4;
  write("Your agreement, for your records", bold, 13, ink, 10);
  write(`Agreed by: ${o.name} (typed name)`); write(`Email: ${o.email || "-"}`); write(`Dog(s): ${o.dogs || "-"}`);
  write(`Date and time: ${when} (US Eastern)`); write(`How: ${o.source === "hubspot" ? "our before-training form" : "the Dogwise Academy app, before-training details"}${o.ip ? `, from ${o.ip}` : ""}`);
  write(`Terms & Conditions: ${o.terms.url} (version: ${o.terms.version})`, font, 10.5, soft, 14);
  if (o.terms.text.trim()) { write("Terms & Conditions", bold, 13, ink, 8); write(o.terms.text, font, 9.5, rgb(0.1, 0.1, 0.15), 3); y -= 10; }
  else write(`The full Terms & Conditions are at ${o.terms.url}.`, font, 10.5, soft, 14);
  if (o.terms.data.trim()) { write(o.terms.data.split("\n")[0], bold, 13, ink, 8); write(o.terms.data.split("\n").slice(1).join("\n"), font, 9.5, rgb(0.1, 0.1, 0.15), 3); }
  return pdf.save();
}

// ── The record and the welcome ──
type Contact = Record<string, unknown>;
/** A client has just agreed (typed their name). Records it, and sends the welcome once per deal. Never throws. */
export async function onSigned(o: { dealId: string; name: string; source: "app" | "hubspot" | "admin"; ip?: string | null; userAgent?: string | null; contact?: Contact }, sb: SupabaseClient = serviceClient()) {
  try {
    const name = o.name.replace(/\s+/g, " ").trim().slice(0, 120);
    if (name.length < 2) return;
    const terms = await getTerms(sb);
    const { data: row } = await sb.from("pretraining_deals").select("contact").eq("deal_id", o.dealId).maybeSingle();
    const c = { ...((row?.contact || {}) as Contact), ...(o.contact || {}) };
    const email = String(c.email || "").trim();
    const { data: rec, error } = await sb.from("terms_acceptances").insert({ deal_id: o.dealId, contact_email: email || null, name, source: o.source, ip: o.ip || null, user_agent: (o.userAgent || "").slice(0, 300) || null, terms_url: terms.url, terms_version: terms.version }).select("id, at").maybeSingle();
    if (error) return; // migration 063 not run yet
    await auditSystem("Terms & Conditions agreed", `${name} (${email || "no email"}), deal ${o.dealId}, via ${o.source}.`).catch(() => null);
    if (!email || !mailConfigured()) return;
    const { data: bks } = await sb.from("bookings").select("dog_name, start_date, end_date, trainers(name)").eq("hubspot_deal_id", o.dealId).neq("status", "cancelled").order("start_date");
    const dogs = ((bks || []) as unknown as { dog_name: string | null; start_date: string; end_date: string; trainers: { name: string } | null }[]);
    // A welcome only before training starts: an older client whose signature turns up late gets the record, not an email
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    if (dogs.length && dogs.every((d) => d.start_date < today)) return;
    if (!(await claim(`welcome:${o.dealId}`))) return; // one welcome per client deal
    const dogNames = dogs.map((d) => d.dog_name).filter(Boolean).join(" & ") || "your dog";
    const first = String(c.firstname || name.split(" ")[0] || "there");
    const start = dogs[0]?.start_date, trainer = dogs[0]?.trainers?.name?.split(" ")[0];
    const day = (iso?: string) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }) : "");
    const pdf = await agreementPdf({ name, email, dogs: dogNames, at: rec?.at || new Date().toISOString(), ip: o.ip, source: o.source, terms });
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
