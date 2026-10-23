import "server-only";
import { PDFDocument, PDFFont, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { BRAND_LOGO_PNG_BASE64 } from "./brandLogo";
import { ABRIL_400, CERT_BADGE_PNG, CEO_SIGNATURE_PNG, JOSEFIN_300, JOSEFIN_600 } from "./pdfAssets";
import { CEO_NAME } from "./programs";

// The graduation certificate (landscape US Letter), matching the Dogwise certificate design.
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));
const W = 792, H = 612;
const TEAL = rgb(0.239, 0.38, 0.435), DARK = rgb(0.13, 0.15, 0.2), WHITE = rgb(1, 1, 1);

export async function certificatePdf(o: { dog: string; program: string; trainer: string; date: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [serif, light, semi] = await Promise.all([ABRIL_400, JOSEFIN_300, JOSEFIN_600].map((f) => pdf.embedFont(b64(f), { subset: true })));
  const [logo, badge, sig] = await Promise.all([pdf.embedPng(b64(BRAND_LOGO_PNG_BASE64)), pdf.embedPng(b64(CERT_BADGE_PNG)), pdf.embedPng(b64(CEO_SIGNATURE_PNG))]);
  pdf.setTitle(`Certificate - ${o.dog} - ${o.program}`); pdf.setAuthor("Dogwise Academy");
  const charset = new Set(light.getCharacterSet());
  const clean = (t: string) => [...String(t || "")].filter((ch) => charset.has(ch.codePointAt(0)!)).join("");
  const page = pdf.addPage([W, H]);
  const center = (t: string, y: number, size: number, f: PDFFont, color = DARK) => { const s = clean(t); page.drawText(s, { x: (W - f.widthOfTextAtSize(s, size)) / 2, y, size, font: f, color }); };

  page.drawRectangle({ x: 28, y: 28, width: W - 56, height: H - 56, borderColor: DARK, borderWidth: 1.6 });
  const lw = 150, lh = (logo.height / logo.width) * lw;
  page.drawImage(logo, { x: (W - lw) / 2, y: H - 62 - lh, width: lw, height: lh });
  center("CERTIFICATE", H - 165, 44, serif, TEAL);
  center("of completion", H - 198, 21, semi, TEAL);
  // The band
  const bandTop = H - 218, bandH = 150;
  page.drawRectangle({ x: 0, y: bandTop - bandH, width: W, height: bandH, color: TEAL });
  center("This certificate is hereby awarded to", bandTop - 34, 14, light, WHITE);
  let size = 38; const name = clean(o.dog);
  while (serif.widthOfTextAtSize(name, size) > W - 200 && size > 20) size -= 2;
  center(name, bandTop - 82, size, serif, WHITE);
  page.drawLine({ start: { x: 120, y: bandTop - 92 }, end: { x: W - 120, y: bandTop - 92 }, thickness: 1.4, color: WHITE });
  // "for completing the <b>Program,</b> given by trainer Name"
  const parts: [string, PDFFont][] = [["for completing the ", light], [`${clean(o.program)},`, semi], [` given by trainer ${clean(o.trainer)}`, light]];
  let fs = 14; const total = () => parts.reduce((n, [t, f]) => n + f.widthOfTextAtSize(t, fs), 0);
  while (total() > W - 80 && fs > 9) fs -= 0.5;
  let x = (W - total()) / 2;
  for (const [t, f] of parts) { page.drawText(t, { x, y: bandTop - 120, size: fs, font: f, color: WHITE }); x += f.widthOfTextAtSize(t, fs); }
  center("CONGRATULATIONS! Your dog is now", bandTop - bandH - 38, 15, light);
  center("a graduate of Dogwise Academy.", bandTop - bandH - 58, 15, light);
  // Signature and badge
  const sw = 120, sh = (sig.height / sig.width) * sw;
  page.drawImage(sig, { x: 92, y: 118, width: sw, height: sh });
  page.drawText(clean(`${CEO_NAME}, CEO`), { x: 86, y: 100, size: 12, font: semi, color: DARK });
  page.drawText(clean(o.date), { x: 110, y: 84, size: 11, font: semi, color: DARK });
  const bw = 132, bh = (badge.height / badge.width) * bw;
  page.drawImage(badge, { x: W - 92 - bw, y: 62, width: bw, height: bh });
  return pdf.save();
}
