import "server-only";
import { PDFDocument, PDFFont, PDFPage, PDFString, StandardFonts, rgb } from "pdf-lib";
import { BRAND_LOGO_PNG_BASE64 } from "./brandLogo";
import { ReportView } from "./reportDoc";

// A4-ish US Letter report, any length: wraps text, breaks pages, clickable video links. Same look as the payslip.
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const NAVY = hex("#281870"), VIOLET = hex("#6E4FE0"), LAVENDER = hex("#F4F1FF"), LINE = hex("#E7E3F3"), MUTED = hex("#6B6880"), INK = hex("#1C1734");

// Standard PDF fonts only cover Latin-1: swap curly quotes and dashes, drop anything else (emoji, other alphabets).
export const pdfSafe = (t: string) => t
  .replace(/[\u2018\u2019\u201A]/g, "'").replace(/[\u201C\u201D\u201E]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...")
  .replace(/[\u00A0\u202F\u2009]/g, " ").replace(/\u2022/g, "-").replace(/\r/g, "")
  .replace(/[^\n\x20-\x7E\xA1-\xFF]/g, "");

export async function reportPdf(r: ReportView): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${r.title} ${r.dog}`); pdf.setAuthor("Dogwise Academy");
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Buffer.from(BRAND_LOGO_PNG_BASE64, "base64"));
  const W = 612, H = 792, L = 54, R = 558, CW = R - L, TOP = H - 40, BOTTOM = 62;
  let page: PDFPage, y = 0;
  const pages: PDFPage[] = [];

  const newPage = () => {
    page = pdf.addPage([W, H]); pages.push(page);
    for (let i = 0; i < 24; i++) { const t = i / 23; page.drawRectangle({ x: (W / 24) * i, y: H - 6, width: W / 24 + 1, height: 6, color: rgb(0x2A / 255 + t * (0x6B - 0x2A) / 255, 0x19 / 255 + t * (0x4F - 0x19) / 255, 0x71 / 255 + t * (0xE0 - 0x71) / 255) }); }
    y = TOP;
  };
  const room = (h: number) => { if (y - h < BOTTOM) newPage(); };
  const wrap = (text: string, font: PDFFont, size: number, width: number) => {
    const out: string[] = [];
    for (const para of pdfSafe(text).split("\n")) {
      let cur = "";
      for (const word of para.split(" ")) {
        let w = word;
        while (font.widthOfTextAtSize(w, size) > width) { // a single very long word (a URL): hard-split it
          let n = w.length; while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > width) n--;
          if (cur) { out.push(cur); cur = ""; }
          out.push(w.slice(0, n)); w = w.slice(n);
        }
        const next = cur ? `${cur} ${w}` : w;
        if (font.widthOfTextAtSize(next, size) > width && cur) { out.push(cur); cur = w; } else cur = next;
      }
      out.push(cur);
    }
    return out;
  };
  const text = (t: string, x: number, yy: number, size: number, font = reg, color = INK) => page.drawText(pdfSafe(t), { x, y: yy, size, font, color });
  const paragraph = (t: string, x: number, width: number, size = 10.5, font = reg, color = INK, lh = size * 1.45) => {
    for (const line of wrap(t, font, size, width)) { room(lh); y -= lh; text(line, x, y, size, font, color); }
  };
  const link = (x: number, yy: number, w: number, h: number, url: string) => {
    const annot = pdf.context.obj({ Type: "Annot", Subtype: "Link", Rect: [x, yy, x + w, yy + h], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(url) } });
    page.node.addAnnot(pdf.context.register(annot));
  };

  newPage();
  // Header
  const lw = 140, lh = (logo.height / logo.width) * lw;
  page!.drawImage(logo, { x: L, y: y - lh + 6, width: lw, height: lh });
  const title = pdfSafe(r.title);
  text(title, R - bold.widthOfTextAtSize(title, 22), y - 16, 22, bold, NAVY);
  const dog = pdfSafe(r.dog); text(dog, R - reg.widthOfTextAtSize(dog, 12), y - 34, 12, reg, MUTED);
  y -= lh + 14;
  // Facts panel
  const colW = CW / Math.max(1, r.facts.length), ph = 46;
  page!.drawRectangle({ x: L, y: y - ph, width: CW, height: ph, color: LAVENDER, borderWidth: 0 });
  r.facts.forEach((f, i) => { text(f.label, L + 12 + i * colW, y - 16, 8.5, reg, MUTED); text(f.value.slice(0, 22), L + 12 + i * colW, y - 33, 11, bold, INK); });
  y -= ph + 8;

  for (const b of r.blocks) {
    room(60);
    y -= 14;
    page!.drawRectangle({ x: L, y: y - 20, width: CW, height: 22, color: LAVENDER });
    text(b.heading, L + 12, y - 14, 10, bold, NAVY);
    y -= 26;
    for (const row of b.rows || []) {
      if (row.label) { room(28); y -= 12; text(row.label, L + 4, y, 8.5, reg, MUTED); }
      paragraph(row.value, L + 4, CW - 8);
      y -= 4; page!.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.5, color: LINE });
    }
    (b.items || []).forEach((it, i) => {
      room(40); y -= 4;
      paragraph(`${i + 1}. ${it.title}`, L + 4, CW - 8, 11, bold);
      paragraph(it.text, L + 14, CW - 18);
      y -= 4; page!.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.5, color: LINE });
    });
    for (const m of b.media || []) {
      room(34); y -= 8;
      const label = m.kind === "video" ? "Watch video" : m.kind === "photo" ? "View photo" : "Open file", bw = bold.widthOfTextAtSize(label, 9) + 18;
      page!.drawRectangle({ x: L + 4, y: y - 14, width: bw, height: 18, color: NAVY });
      text(label, L + 13, y - 9, 9, bold, rgb(1, 1, 1)); link(L + 4, y - 14, bw, 18, m.url);
      const desc = wrap(m.label, reg, 10, CW - bw - 24)[0] || ""; text(desc, L + bw + 14, y - 9, 10, reg, INK);
      y -= 20;
    }
  }
  // Footers with page numbers
  pages.forEach((p, i) => {
    p.drawRectangle({ x: 0, y: 0, width: W, height: 38, color: hex("#FAF9FD") });
    p.drawLine({ start: { x: 0, y: 38 }, end: { x: W, y: 38 }, thickness: 0.6, color: LINE });
    p.drawText("Dogwise Academy, 30 N Gould St, Sheridan, WY 82801. Questions? Email info@dogwiseacademy.com", { x: L, y: 15, size: 8, font: reg, color: MUTED });
    const pn = `${i + 1} / ${pages.length}`; p.drawText(pn, { x: R - reg.widthOfTextAtSize(pn, 8), y: 15, size: 8, font: reg, color: MUTED });
  });
  return pdf.save();
}
