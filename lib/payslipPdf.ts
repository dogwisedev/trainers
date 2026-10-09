import "server-only";
import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage } from "pdf-lib";
import { BRAND_LOGO_PNG_BASE64 } from "./brandLogo";
import { SlipData, lineClient, lineLead, lineProgram, splitAddress } from "./payslipDoc";
import { money, periodLabel, usDate } from "./payroll";

// US Letter payslip in the Dogwise style (navy + violet, lavender panels). Same content as the email.
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const NAVY = hex("#2A1971"), VIOLET = hex("#6B4FE0"), LAVENDER = hex("#F4F1FF"), LINE = hex("#E7E3F3"), MUTED = hex("#6B6880"), ROSE = hex("#C2415D"), INK = hex("#1C1734"), ROSEWASH = hex("#FCE8EC"), FOOT = hex("#FAF9FD"), SOFT = hex("#CFC6FF");

function roundRect(page: PDFPage, x: number, y: number, w: number, h: number, r: number, color: ReturnType<typeof rgb>) {
  const k = 0.5523 * r;
  const path = `M ${x + r} ${y} H ${x + w - r} C ${x + w - r + k} ${y} ${x + w} ${y + r - k} ${x + w} ${y + r} V ${y + h - r} C ${x + w} ${y + h - r + k} ${x + w - r + k} ${y + h} ${x + w - r} ${y + h} H ${x + r} C ${x + r - k} ${y + h} ${x} ${y + h - r + k} ${x} ${y + h - r} V ${y + r} C ${x} ${y + r - k} ${x + r - k} ${y} ${x + r} ${y} Z`;
  // pdf-lib's SVG path origin is top-left of the page; flip y.
  page.drawSvgPath(path, { x: 0, y: page.getHeight(), color, borderWidth: 0, scale: 1 } as never);
}

export async function payslipPdf(d: SlipData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Payslip ${d.trainer_name} ${usDate(d.paid_date)}`); pdf.setAuthor("Dogwise Academy");
  const page = pdf.addPage([612, 792]);
  const H = 792;
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Buffer.from(BRAND_LOGO_PNG_BASE64, "base64"));
  const L = 54, R = 558, W = R - L;
  const text = (s: string, x: number, y: number, size: number, font: PDFFont = reg, color = INK) => page.drawText(s, { x, y, size, font, color });
  const right = (s: string, xr: number, y: number, size: number, font: PDFFont = reg, color = INK) => text(s, xr - font.widthOfTextAtSize(s, size), y, size, font, color);
  const fit = (s: string, width: number, size: number, font: PDFFont = reg) => { let t = s; while (t && font.widthOfTextAtSize(t, size) > width) t = t.slice(0, -1); return t.length < s.length ? t.slice(0, -1) + "…" : t; };
  // rounded rect with bottom-left at (x, y) in PDF coordinates
  const box = (x: number, y: number, w: number, h: number, r: number, color: ReturnType<typeof rgb>) => roundRect(page, x, H - y - h, w, h, r, color);

  // Top bar: navy → violet in 24 steps
  for (let i = 0; i < 24; i++) {
    const t = i / 23;
    page.drawRectangle({ x: (612 / 24) * i, y: H - 6, width: 612 / 24 + 1, height: 6, color: rgb(0x2A / 255 + t * (0x6B - 0x2A) / 255, 0x19 / 255 + t * (0x4F - 0x19) / 255, 0x71 / 255 + t * (0xE0 - 0x71) / 255) });
  }

  // Header
  const lw = 150, lh = (logo.height / logo.width) * lw;
  page.drawImage(logo, { x: L, y: 718 - lh / 2, width: lw, height: lh });
  right("Payslip", R, 718, 26, bold, NAVY);
  right(`Paid ${usDate(d.paid_date)}`, R, 702, 10.5, reg, MUTED);

  // Info panel
  const py = 600, ph = 78;
  box(L, py, W, ph, 12, LAVENDER);
  text("Paid to", L + 16, py + ph - 20, 9, reg, MUTED);
  text(fit(d.trainer_name, 190, 12, bold), L + 16, py + ph - 36, 12, bold);
  splitAddress(d.trainer_address).slice(0, 2).forEach((a, i) => text(fit(a, 190, 9.5), L + 16, py + ph - 51 - i * 12, 9.5, reg, MUTED));
  const c2 = L + 240;
  text("Pay period", c2, py + ph - 20, 9, reg, MUTED);
  text(periodLabel(d.period_start, d.period_end), c2, py + ph - 36, 12, bold);
  text("Submitted", c2, py + ph - 54, 9, reg, MUTED);
  text(usDate(d.submit_date), c2, py + ph - 66, 9.5);
  right("Amount", R - 16, py + ph - 20, 9, reg, MUTED);
  right(money(d.total), R - 16, py + ph - 40, 18, bold, VIOLET);

  // Lines
  const cols = { lead: L + 8, dog: L + 88, program: L + 300, amountR: R - 8 };
  let y = 570;
  text("Weeks", cols.lead, y, 9, bold, MUTED); text("Dog and client", cols.dog, y, 9, bold, MUTED);
  text("Program", cols.program, y, 9, bold, MUTED); right("Amount", cols.amountR, y, 9, bold, MUTED);
  y -= 8;
  page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.8, color: LINE });
  const lines = d.lines.length ? d.lines : null;
  (lines || []).forEach((l) => {
    if (y < 200) return;
    const neg = Number(l.amount) < 0, wide = l.kind === "deduction" || l.kind === "other";
    const rowH = !wide && l.client ? 34 : 26;
    const top = y - 8;
    const leadV = lineLead(l), lead = leadV === "" ? "" : typeof leadV === "number" ? `${leadV} wk${leadV === 1 ? "" : "s"}` : String(leadV);
    if (lead) {
      const pw = bold.widthOfTextAtSize(lead, 8.5) + 14;
      box(cols.lead, top - 15, pw, 15, 7.5, neg ? ROSEWASH : LAVENDER);
      text(lead, cols.lead + 7, top - 11, 8.5, bold, neg ? ROSE : NAVY);
    }
    if (wide) text(fit(lineClient(l), 330, 10), cols.dog, top - 11, 10, reg, neg ? ROSE : INK);
    else {
      text(fit(l.dog || "", 200, 10.5, bold), cols.dog, top - 11, 10.5, bold);
      if (l.client) text(fit(l.client, 200, 9), cols.dog, top - 24, 9, reg, MUTED);
      text(fit(lineProgram(l), 150, 10), cols.program, top - 11, 10, reg, MUTED);
    }
    right(money(l.amount), cols.amountR, top - 11, 10.5, bold, neg ? ROSE : INK);
    y -= rowH;
    page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.6, color: LINE });
  });
  if (!lines) { text("Nothing this period.", cols.dog, y - 18, 10, reg, MUTED); y -= 26; }

  // Totals + notes
  y -= 24;
  const tx = R - 230;
  text("Subtotal", tx, y, 10, reg, MUTED); right(money(d.subtotal), R, y, 10.5);
  text("Adjustments", tx, y - 18, 10, reg, MUTED); right(money(d.adjustments), R, y - 18, 10.5);
  box(tx - 4, y - 66, 234, 36, 10, NAVY);
  text("Total paid", tx + 10, y - 53, 10, reg, SOFT);
  right(money(d.total), R - 12, y - 55, 17, bold, rgb(1, 1, 1));
  if (d.notes) {
    text("Notes", L, y, 9, reg, MUTED);
    const out: string[] = [];
    for (const para of d.notes.split(/\n/)) { let cur = ""; for (const w of para.split(" ")) { if (reg.widthOfTextAtSize(cur ? `${cur} ${w}` : w, 10) > tx - L - 24) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; } out.push(cur); }
    out.slice(0, 7).forEach((n, i) => text(n, L, y - 15 - i * 13, 10));
  }

  // Footer
  page.drawRectangle({ x: 0, y: 0, width: 612, height: 40, color: FOOT });
  page.drawLine({ start: { x: 0, y: 40 }, end: { x: 612, y: 40 }, thickness: 0.6, color: LINE });
  text("Dogwise Academy, 30 N Gould St, Sheridan, WY 82801. Questions about this payslip? Email info@dogwiseacademy.com", L, 16, 8.5, reg, MUTED);
  return pdf.save();
}
