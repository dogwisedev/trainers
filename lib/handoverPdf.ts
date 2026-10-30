import "server-only";
import { PDFDocument, PDFFont, PDFImage, PDFPage, PDFString, rgb, RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { BRAND_LOGO_PNG_BASE64 } from "./brandLogo";
import { BRICOLAGE_400, BRICOLAGE_600, BRICOLAGE_800, CEO_SIGNATURE_PNG } from "./pdfAssets";
import { ABOUT, CEO_MESSAGE, CEO_NAME, CLIENT_RESPONSIBILITIES, Program, TRAINER_RESPONSIBILITIES } from "./programs";

// The client's handover report: a designed, multi-page US Letter PDF in the Dogwise style.
// Cover (photo of the dog with the trainer + the key facts), then homework (with video links), focus points, training,
// health check and the trainer's review, then the standard text: the program, responsibilities and a message from the CEO.

export type HandoverData = {
  dog: string; client: string; trainer: string; program: Program | string; location: string; contact: string;
  start: string; end: string; date: string;                       // "October 21, 2026"
  goals: string; training: { title: string; text: string }[]; homework: { title: string; text: string }[];
  trainingVideos: { label: string; url: string }[]; homeworkVideos: { label: string; url: string }[];
  health: string; extra: string; review: string; photo: Uint8Array | null; chatUrl: string;
};

const C = {
  ink: rgb(0.157, 0.094, 0.439), lav: rgb(0.596, 0.471, 0.973), lavDeep: rgb(0.482, 0.357, 0.918), wash: rgb(0.941, 0.910, 0.973),
  canvas: rgb(0.973, 0.965, 0.992), plum: rgb(0.247, 0.145, 0.471), soft: rgb(0.365, 0.345, 0.502), faint: rgb(0.553, 0.533, 0.659),
  white: rgb(1, 1, 1), line: rgb(0.890, 0.871, 0.949), sand: rgb(0.788, 0.710, 0.620)
};
const W = 612, H = 792, M = 56, CW = W - M * 2;
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

export async function handoverPdf(d: HandoverData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [reg, semi, bold] = await Promise.all([BRICOLAGE_400, BRICOLAGE_600, BRICOLAGE_800].map((f) => pdf.embedFont(b64(f), { subset: true })));
  const logo = await pdf.embedPng(b64(BRAND_LOGO_PNG_BASE64));
  const sig = await pdf.embedPng(b64(CEO_SIGNATURE_PNG));
  let photo: PDFImage | null = null;
  if (d.photo) { try { photo = await pdf.embedJpg(d.photo); } catch { try { photo = await pdf.embedPng(d.photo); } catch { photo = null; } } }
  pdf.setTitle(`Handover Report - ${d.dog}`); pdf.setAuthor("Dogwise Academy"); pdf.setCreator("Dogwise Academy");

  // Only characters the fonts can draw (emoji and other scripts are dropped)
  const charset = new Set(reg.getCharacterSet());
  const clean = (t: string) => [...String(t || "").replace(/\r/g, "").replace(/\t/g, " ")].filter((ch) => ch === "\n" || charset.has(ch.codePointAt(0)!)).join("");
  const widthOf = (t: string, f: PDFFont, size: number) => f.widthOfTextAtSize(t, size);
  function wrap(text: string, f: PDFFont, size: number, max: number): string[] {
    const out: string[] = [];
    for (const para of clean(text).split("\n")) {
      if (!para.trim()) { out.push(""); continue; }
      let line = "";
      for (const word of para.split(/\s+/)) {
        const tryLine = line ? `${line} ${word}` : word;
        if (widthOf(tryLine, f, size) <= max) { line = tryLine; continue; }
        if (line) out.push(line);
        let w = word;
        while (widthOf(w, f, size) > max) { let i = w.length; while (i > 1 && widthOf(w.slice(0, i), f, size) > max) i--; out.push(w.slice(0, i)); w = w.slice(i); }
        line = w;
      }
      out.push(line);
    }
    while (out.length && !out[out.length - 1]) out.pop();
    return out;
  }
  const roundRect = (p: PDFPage, x: number, yTop: number, w: number, h: number, r: number, color: RGB, opts: { border?: RGB; opacity?: number } = {}) =>
    p.drawSvgPath(`M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`,
      { x, y: yTop, color, opacity: opts.opacity, borderColor: opts.border, borderWidth: opts.border ? 1 : 0 });
  const link = (p: PDFPage, x: number, y: number, w: number, h: number, url: string) => {
    const annot = pdf.context.obj({ Type: "Annot", Subtype: "Link", Rect: [x, y, x + w, y + h], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(url) } });
    p.node.addAnnot(pdf.context.register(annot));
  };

  // ── Cover ──
  const cover = pdf.addPage([W, H]);
  cover.drawRectangle({ x: 0, y: H - 360, width: W, height: 360, color: C.ink });
  cover.drawEllipse({ x: W - 40, y: H - 40, xScale: 170, yScale: 170, color: C.lav, opacity: 0.35 });
  cover.drawEllipse({ x: 60, y: H - 360, xScale: 120, yScale: 120, color: C.lavDeep, opacity: 0.3 });
  roundRect(cover, M, H - 44, 132, 44, 14, C.white);
  const lw = 112, lh = (logo.height / logo.width) * lw;
  cover.drawImage(logo, { x: M + 10, y: H - 44 - (44 + lh) / 2 + 0, width: lw, height: lh });
  cover.drawText("Handover Report", { x: M, y: H - 150, size: 46, font: bold, color: C.white });
  const fit = (t: string, f: PDFFont, size: number, max: number, min = 10) => { let z = size; while (z > min && widthOf(t, f, z) > max) z -= 0.5; return z; };
  const journey = clean(`${d.dog}'s training journey`);
  cover.drawText(journey, { x: M, y: H - 186, size: fit(journey, semi, 20, W - 2 * M, 12), font: semi, color: C.lav });
  cover.drawText(clean(d.date), { x: M, y: H - 212, size: 12, font: reg, color: rgb(0.85, 0.82, 0.97) });
  // Photo card, overlapping the band
  const cardTop = H - 250;
  if (photo) {
    const maxW = CW, maxH = 300;
    let pw = maxW, ph = (photo.height / photo.width) * pw;
    if (ph > maxH) { ph = maxH; pw = (photo.width / photo.height) * ph; }
    const px = (W - pw) / 2;
    roundRect(cover, px - 8, cardTop + 8, pw + 16, ph + 16, 18, C.white);
    cover.drawImage(photo, { x: px, y: cardTop - ph, width: pw, height: ph });
    const cap = clean(`${d.dog} and ${d.trainer}`);
    cover.drawText(cap, { x: px, y: cardTop - ph - 26, size: fit(cap, semi, 11, Math.max(pw, 200), 8), font: semi, color: C.soft });
  }
  // Facts
  const factsTop = photo ? Math.min(cardTop - 330, 300) : cardTop - 20;
  roundRect(cover, M, factsTop, CW, 214, 18, C.canvas, { border: C.line });
  const facts: [string, string][][] = [
    [["Client", d.client], ["Dog", d.dog], ["Location", d.location || "-"], ["Contact", d.contact || "-"]],
    [["Program", String(d.program || "-")], ["Start", d.start], ["End", d.end], ["Trainer", d.trainer]]
  ];
  facts.forEach((col, ci) => col.forEach(([k, v], ri) => {
    const x = M + 22 + ci * (CW / 2), y = factsTop - 34 - ri * 40;
    cover.drawText(k.toUpperCase(), { x, y: y + 13, size: 7.5, font: semi, color: C.faint });
    const one = wrap(v, semi, 11.5, CW / 2 - 40);
    const lines = one.length <= 1 ? one : wrap(v, semi, 9.5, CW / 2 - 40).slice(0, 2);
    const sz = one.length <= 1 ? 11.5 : 9.5;
    (lines.length ? lines : ["-"]).forEach((ln, i) => cover.drawText(ln, { x, y: y - 2 - i * 11.5, size: sz, font: semi, color: C.ink }));
  }));
  cover.drawText("Point of contact", { x: M + 22, y: factsTop - 196 + 8, size: 8.5, font: semi, color: C.faint });
  const poc = "Your Dogwise chat in the app: message us any time";
  cover.drawText(clean(poc), { x: M + 110, y: factsTop - 196 + 8, size: 9.5, font: semi, color: C.lavDeep });
  link(cover, M + 110, factsTop - 196 + 4, widthOf(poc, semi, 9.5), 14, d.chatUrl);

  // ── Flowing content pages ──
  let page: PDFPage = cover, y = 0, pageNo = 1;
  const newPage = () => {
    page = pdf.addPage([W, H]); pageNo++;
    page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: C.lav });
    const w = 78, h = (logo.height / logo.width) * w;
    page.drawImage(logo, { x: M, y: H - 30 - h, width: w, height: h });
    const tag = clean(`Handover Report  ·  ${d.dog}`);
    page.drawText(tag, { x: W - M - widthOf(tag, reg, 9), y: H - 42, size: 9, font: reg, color: C.faint });
    page.drawLine({ start: { x: M, y: 44 }, end: { x: W - M, y: 44 }, thickness: 0.6, color: C.line });
    page.drawText("dogwiseacademy.com", { x: M, y: 28, size: 8.5, font: reg, color: C.faint });
    const n = String(pageNo);
    page.drawText(n, { x: W - M - widthOf(n, semi, 9), y: 28, size: 9, font: semi, color: C.lavDeep });
    y = H - 92;
  };
  const room = (h: number) => { if (y - h < 64) newPage(); };
  let sectionNo = 0;
  const heading = (title: string, sub?: string, keep = 120) => {
    room(70 + keep); // keep the heading with what follows it
    sectionNo++;
    const num = String(sectionNo).padStart(2, "0");
    page.drawText(num, { x: M, y: y - 18, size: 12, font: bold, color: C.lav });
    page.drawText(clean(title), { x: M + 30, y: y - 22, size: 22, font: bold, color: C.ink });
    page.drawRectangle({ x: M + 30, y: y - 32, width: 36, height: 3, color: C.lav });
    y -= 48;
    if (sub) { page.drawText(clean(sub), { x: M + 30, y: y - 6, size: 13, font: semi, color: C.lavDeep }); y -= 26; }
  };
  const body = (text: string, opts: { size?: number; color?: RGB; indent?: number; font?: PDFFont; gap?: number } = {}) => {
    const size = opts.size ?? 10.5, lh = size * 1.55, x = M + (opts.indent ?? 30), max = CW - (opts.indent ?? 30);
    for (const ln of wrap(text, opts.font ?? reg, size, max)) {
      room(lh);
      if (ln) page.drawText(ln, { x, y: y - size, size, font: opts.font ?? reg, color: opts.color ?? C.soft });
      y -= ln ? lh : lh * 0.6;
    }
    y -= opts.gap ?? 10;
  };
  /** A soft card around a block of text; breaks across pages by drawing the text plainly when it's too tall. */
  const card = (title: string, text: string, tone: RGB = C.wash) => {
    const lines = wrap(text, reg, 10.5, CW - 30 - 32);
    const tLines = title ? wrap(title, bold, 12, CW - 30 - 32) : []; // long titles wrap inside the card
    const hgt = 28 + (tLines.length ? tLines.length * 16 + 6 : 0) + lines.length * 16.3;
    if (hgt < H - 160) {
      room(hgt + 12);
      roundRect(page, M + 30, y, CW - 30, hgt, 14, tone);
      let yy = y - 22;
      for (const t of tLines) { page.drawText(t, { x: M + 46, y: yy - 4, size: 12, font: bold, color: C.ink }); yy -= 16; }
      if (tLines.length) yy -= 6;
      for (const ln of lines) { if (ln) page.drawText(ln, { x: M + 46, y: yy - 6, size: 10.5, font: reg, color: C.soft }); yy -= ln ? 16.3 : 9; }
      y -= hgt + 14;
    } else { if (title) body(title, { font: bold, color: C.ink, size: 12, gap: 2 }); body(text); }
  };
  const videoButtons = (videos: { label: string; url: string }[], heading: string) => {
    if (!videos.length) return;
    room(40);
    page.drawText(clean(heading), { x: M + 30, y: y - 10, size: 11, font: bold, color: C.ink }); y -= 24;
    for (const v of videos) {
      const label = wrap(v.label || "Video", reg, 10, CW - 30 - 120);
      const hgt = Math.max(34, 14 + label.length * 14);
      room(hgt + 8);
      roundRect(page, M + 30, y, CW - 30, hgt, 12, C.canvas, { border: C.line });
      label.forEach((ln, i) => page.drawText(ln, { x: M + 44, y: y - 20 - i * 14, size: 10, font: reg, color: C.soft }));
      const bx = W - M - 100, by = y - hgt / 2 - 11;
      roundRect(page, bx, by + 22, 88, 22, 11, C.ink);
      page.drawSvgPath("M 0 0 L 7 4.5 L 0 9 Z", { x: bx + 12, y: by + 15.5, color: C.white });
      page.drawText("Watch", { x: bx + 26, y: by + 7, size: 10, font: semi, color: C.white });
      link(page, bx, by, 88, 22, v.url);
      y -= hgt + 8;
    }
    y -= 8;
  };

  newPage();
  // Homework and its videos first: it's what the client uses at home. The standard text goes at the back.
  if (d.homework.length || d.homeworkVideos.length) {
    heading("Homework", "Keep practicing at home");
    d.homework.forEach((t) => card(t.title, t.text, C.canvas));
    videoButtons(d.homeworkVideos, "Homework videos");
  }
  if (d.goals) {
    heading("Training focus points");
    const parts = d.goals.split(/[;\n]|,(?=\s*[a-z])/i).map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1 && parts.every((p) => p.length <= 40)) {
      let x = M + 30; room(34);
      for (const ptxt of parts) {
        const t = clean(ptxt), w = widthOf(t, semi, 10.5) + 28;
        if (x + w > W - M) { x = M + 30; y -= 34; room(34); }
        roundRect(page, x, y, w, 26, 13, C.wash);
        page.drawText(t, { x: x + 14, y: y - 17, size: 10.5, font: semi, color: C.plum });
        x += w + 8;
      }
      y -= 46;
    } else body(d.goals, { size: 11.5 });
  }
  if (d.training.length || d.trainingVideos.length) {
    heading("Training", "What we worked on together");
    d.training.forEach((t) => card(t.title, t.text));
    videoButtons(d.trainingVideos, "Training videos");
  }
  if (d.health) { heading("Snout to tail health check"); body(d.health, { size: 11 }); }
  if (d.extra) { heading("Anything else"); body(d.extra, { size: 11 }); }
  if (d.review) {
    heading("Overall trainer's review", `From ${d.trainer}`);
    room(60);
    page.drawText("\u201C", { x: M + 26, y: y - 46, size: 64, font: bold, color: C.lav, opacity: 0.5 });
    y -= 18;
    body(d.review, { size: 11.5, indent: 58, color: C.ink });
  }
  const about = ABOUT[d.program as Program];
  if (about?.length) { heading("About the program", String(d.program)); about.forEach((p) => body(p, { size: 11.5, color: C.soft })); }
  heading("Responsibilities");
  card("The trainer", TRAINER_RESPONSIBILITIES);
  card("You, at home", CLIENT_RESPONSIBILITIES, C.canvas);
  // Message from the CEO
  const msgLines = CEO_MESSAGE.flatMap((p, i) => [...wrap(p, reg, 10.5, CW - 30 - 40), ...(i < CEO_MESSAGE.length - 1 ? [""] : [])]);
  const msgH = 40 + msgLines.length * 15.5 + 90;
  heading("A message from our CEO", undefined, msgH);
  roundRect(page, M + 30, y, CW - 30, msgH, 18, C.wash);
  let yy = y - 26;
  for (const ln of msgLines) { if (ln) page.drawText(ln, { x: M + 50, y: yy - 6, size: 10.5, font: reg, color: C.soft }); yy -= ln ? 15.5 : 8; }
  page.drawText("Warmest regards,", { x: M + 50, y: yy - 14, size: 10.5, font: reg, color: C.soft });
  const sw = 110, sh = (sig.height / sig.width) * sw;
  page.drawImage(sig, { x: M + 46, y: yy - 22 - sh, width: sw, height: sh });
  page.drawText(clean(`${CEO_NAME}, CEO`), { x: M + 50, y: yy - 38 - sh, size: 10.5, font: bold, color: C.ink });
  y -= msgH + 20;
  // Closing
  room(70);
  roundRect(page, M + 30, y, CW - 30, 56, 16, C.ink);
  page.drawText(clean(`Questions about ${d.dog}? We're always here.`), { x: M + 50, y: y - 24, size: 12, font: bold, color: C.white });
  const cta = "Message us in your Dogwise chat";
  page.drawText(cta, { x: M + 50, y: y - 42, size: 10, font: semi, color: C.lav });
  link(page, M + 50, y - 46, widthOf(cta, semi, 10), 14, d.chatUrl);
  y -= 70;

  return pdf.save();
}
