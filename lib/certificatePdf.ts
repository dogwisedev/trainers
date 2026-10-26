import "server-only";
import { PDFDocument, PDFFont, PDFPage, rgb, RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { BRAND_LOGO_PNG_BASE64 } from "./brandLogo";
import { BRICOLAGE_400, BRICOLAGE_600, BRICOLAGE_800, CEO_SIGNATURE_PNG } from "./pdfAssets";
import { CEO_NAME } from "./programs";

// The graduation certificate (landscape US Letter), in the same look as the handover report:
// deep purple band with lavender circles and the logo, Bricolage type, lilac wash, a purple graduate seal.
const C = {
  ink: rgb(0.157, 0.094, 0.439), lav: rgb(0.596, 0.471, 0.973), lavDeep: rgb(0.431, 0.31, 0.878), wash: rgb(0.941, 0.910, 0.973),
  canvas: rgb(0.973, 0.965, 0.992), soft: rgb(0.365, 0.345, 0.502), white: rgb(1, 1, 1), line: rgb(0.890, 0.871, 0.949)
};
const W = 792, H = 612, M = 54;
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

/** "Big Puppy" → "Big Puppy program" (left alone if the name already says program). */
export const programPhrase = (p: string) => (/\bprogram$/i.test(p.trim()) ? p.trim() : `${p.trim()} program`);

export async function certificatePdf(o: { dog: string; program: string; trainer: string; date: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [reg, semi, bold] = await Promise.all([BRICOLAGE_400, BRICOLAGE_600, BRICOLAGE_800].map((f) => pdf.embedFont(b64(f), { subset: true })));
  const [logo, sig] = await Promise.all([pdf.embedPng(b64(BRAND_LOGO_PNG_BASE64)), pdf.embedPng(b64(CEO_SIGNATURE_PNG))]);
  pdf.setTitle(`Certificate - ${o.dog} - ${o.program}`); pdf.setAuthor("Dogwise Academy"); pdf.setCreator("Dogwise Academy");
  const charset = new Set(reg.getCharacterSet());
  const clean = (t: string) => [...String(t || "")].filter((ch) => charset.has(ch.codePointAt(0)!)).join("");
  const page = pdf.addPage([W, H]);
  const roundRect = (p: PDFPage, x: number, yTop: number, w: number, h: number, r: number, color: RGB, border?: RGB) =>
    p.drawSvgPath(`M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`,
      { x, y: yTop, color, borderColor: border, borderWidth: border ? 1 : 0 });
  const center = (t: string, y: number, size: number, f: PDFFont, color: RGB) => { const s = clean(t); page.drawText(s, { x: (W - f.widthOfTextAtSize(s, size)) / 2, y, size, font: f, color }); };
  /** One centred line made of differently styled parts, shrunk to fit. */
  const mixed = (parts: [string, PDFFont, RGB][], y: number, size: number, max: number) => {
    let fs = size; const width = () => parts.reduce((n, [t, f]) => n + f.widthOfTextAtSize(clean(t), fs), 0);
    while (width() > max && fs > 9) fs -= 0.5;
    let x = (W - width()) / 2;
    for (const [t, f, c] of parts) { const s = clean(t); page.drawText(s, { x, y, size: fs, font: f, color: c }); x += f.widthOfTextAtSize(s, fs); }
  };

  // Page and band
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.canvas });
  const bandH = 214;
  page.drawRectangle({ x: 0, y: H - bandH, width: W, height: bandH, color: C.ink });
  page.drawEllipse({ x: W - 50, y: H - 30, xScale: 190, yScale: 190, color: C.lav, opacity: 0.35 });
  page.drawEllipse({ x: 70, y: H - bandH, xScale: 120, yScale: 120, color: C.lavDeep, opacity: 0.3 });
  // White card the content sits on, overlapping the band
  const cardX = M, cardW = W - M * 2, cardTop = H - 150, cardH = cardTop - 40;
  roundRect(page, cardX, cardTop, cardW, cardH, 22, C.white, C.line);
  // Logo chip and title in the band
  roundRect(page, M, H - 34, 132, 44, 14, C.white);
  const lw = 112, lh = (logo.height / logo.width) * lw;
  page.drawImage(logo, { x: M + 10, y: H - 34 - (44 + lh) / 2, width: lw, height: lh });
  const title = "Certificate of Completion";
  page.drawText(title, { x: W - M - bold.widthOfTextAtSize(title, 30), y: H - 70, size: 30, font: bold, color: C.white });
  const sub = "Dogwise Academy graduate";
  page.drawText(sub, { x: W - M - semi.widthOfTextAtSize(sub, 15), y: H - 94, size: 15, font: semi, color: C.lav });

  // Who it's for
  center("This certificate is awarded to", cardTop - 62, 15, reg, C.soft);
  let size = 52; const name = clean(o.dog);
  while (bold.widthOfTextAtSize(name, size) > cardW - 120 && size > 24) size -= 2;
  center(name, cardTop - 126, size, bold, C.ink);
  const ulW = Math.min(cardW - 160, Math.max(220, bold.widthOfTextAtSize(name, size) + 60));
  page.drawRectangle({ x: (W - ulW) / 2, y: cardTop - 144, width: ulW, height: 3, color: C.lav });
  const line: [string, PDFFont, RGB][] = [["for completing the ", reg, C.soft], [programPhrase(o.program), semi, C.ink], [", given by trainer ", reg, C.soft], [o.trainer, semi, C.ink]];
  const oneLine = line.reduce((n, [t, f]) => n + f.widthOfTextAtSize(clean(t), 17), 0) <= cardW - 80;
  if (oneLine) mixed(line, cardTop - 182, 17, cardW - 80);
  else { // long program or trainer name: two lines rather than tiny type
    mixed([["for completing the ", reg, C.soft], [`${programPhrase(o.program)},`, semi, C.ink]], cardTop - 178, 17, cardW - 80);
    mixed([["given by trainer ", reg, C.soft], [o.trainer, semi, C.ink]], cardTop - 202, 17, cardW - 80);
  }
  center("Congratulations! Your dog is now a graduate of Dogwise Academy.", cardTop - (oneLine ? 214 : 236), 14, reg, C.soft);

  // Signature, name and date (left)
  const baseY = 70;
  const sw = 118, sh = (sig.height / sig.width) * sw;
  page.drawImage(sig, { x: cardX + 44, y: baseY + 40, width: sw, height: sh });
  page.drawRectangle({ x: cardX + 40, y: baseY + 36, width: 190, height: 1.2, color: C.line });
  page.drawText(clean(`${CEO_NAME}, CEO`), { x: cardX + 44, y: baseY + 18, size: 12, font: semi, color: C.ink });
  page.drawText(clean(o.date), { x: cardX + 44, y: baseY + 2, size: 11, font: reg, color: C.soft });

  // Graduate seal (right)
  const sx = cardX + cardW - 110, sy = baseY + 58;
  page.drawCircle({ x: sx, y: sy, size: 58, color: C.lavDeep });
  page.drawCircle({ x: sx, y: sy, size: 50, borderColor: C.white, borderWidth: 1.4, opacity: 0, borderOpacity: 0.7 });
  page.drawCircle({ x: sx, y: sy, size: 44, color: C.ink });
  const s1 = "GRADUATE", s2 = (o.date.match(/\b(20\d\d)\b/) || [])[1] || "", s3 = "DOGWISE";
  page.drawText(s3, { x: sx - semi.widthOfTextAtSize(s3, 8.5) / 2, y: sy + 14, size: 8.5, font: semi, color: C.lav });
  page.drawText(s1, { x: sx - bold.widthOfTextAtSize(s1, 12) / 2, y: sy - 3, size: 12, font: bold, color: C.white });
  if (s2) page.drawText(s2, { x: sx - semi.widthOfTextAtSize(s2, 10) / 2, y: sy - 19, size: 10, font: semi, color: C.lav });
  return pdf.save();
}
