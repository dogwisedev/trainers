// One payslip layout, matching the Dogwise template: used for the web view and the email.
import { money, periodLabel, usDate } from "./payroll";

export type SlipLine = { kind: string; weeks_completed: number | null; days?: number | null; pct: number | null; client: string | null; dog: string | null; program: string | null; description: string | null; amount: number | string };
export type SlipData = {
  trainer_name: string; trainer_address: string | null; submit_date: string; paid_date: string; period_start: string; period_end: string;
  lines: SlipLine[]; subtotal: number | string; adjustments: number | string; total: number | string; notes: string | null;
};

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
// Dogwise brand, from the logo: deep navy + violet, with soft lavender surfaces.
export const NAVY = "#2A1971", VIOLET = "#6B4FE0", LAVENDER = "#F4F1FF", LINE = "#E7E3F3", MUTED = "#6B6880", ROSE = "#C2415D", INK = "#1C1734";

/** First column of a line: weeks completed, extra days, deduction %, or blank. */
export const lineLead = (l: SlipLine) => (l.kind === "deduction" ? (l.pct != null ? `${l.pct}%` : "") : l.days ? `${l.days} day${l.days === 1 ? "" : "s"}` : l.weeks_completed ?? "");
/** Client column: deductions and "other" lines put their description here. */
export const lineClient = (l: SlipLine) => (l.kind === "deduction" || l.kind === "other" ? l.description || "" : l.client || "");
export const lineProgram = (l: SlipLine) => (l.kind === "route" ? "Route" : l.kind === "training" ? l.program || "" : "");
export const splitAddress = (a: string | null) => String(a || "").split(/\s*,\s*(?=[^,]*,\s*[A-Z]{2}\b)|\n/).map((x) => x.trim()).filter(Boolean);
const leadText = (l: SlipLine) => { const v = lineLead(l); return v === "" ? "" : typeof v === "number" ? `${v} wk${v === 1 ? "" : "s"}` : v; };

export function payslipHtml(d: SlipData, logoSrc: string) {
  const td = "padding:12px 10px;border-bottom:1px solid " + LINE + ";font-size:14px;vertical-align:top";
  const rows = d.lines.map((l) => {
    const neg = Number(l.amount) < 0, wide = l.kind === "deduction" || l.kind === "other";
    const lead = leadText(l);
    return `<tr>
      <td style="${td};white-space:nowrap">${lead ? `<span style="display:inline-block;background:${neg ? "#FCE8EC" : LAVENDER};color:${neg ? ROSE : NAVY};font-weight:700;font-size:12px;border-radius:999px;padding:3px 9px">${esc(lead)}</span>` : ""}</td>
      ${wide
        ? `<td style="${td};color:${neg ? ROSE : INK}" colspan="2">${esc(lineClient(l))}</td>`
        : `<td style="${td};color:${INK}"><b>${esc(l.dog || "")}</b>${l.client ? `<br><span style="color:${MUTED};font-size:13px">${esc(l.client)}</span>` : ""}</td>
           <td style="${td};color:${MUTED}">${esc(lineProgram(l))}</td>`}
      <td style="${td};text-align:right;white-space:nowrap;font-weight:700;color:${neg ? ROSE : INK}">${money(l.amount)}</td>
    </tr>`;
  }).join("");
  const addr = splitAddress(d.trainer_address).map(esc).join("<br>");
  return `
<div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};border:1px solid ${LINE}">
  <div style="height:6px;background:linear-gradient(90deg,${NAVY},${VIOLET})"></div>
  <div style="padding:28px 30px 8px">
    <table role="presentation" width="100%" style="border-collapse:collapse"><tr>
      <td style="vertical-align:middle"><img src="${logoSrc}" alt="Dogwise Academy" width="170" style="display:block;height:auto;max-width:170px"></td>
      <td style="vertical-align:middle;text-align:right">
        <div style="font-size:26px;font-weight:800;color:${NAVY};letter-spacing:-0.02em">Payslip</div>
        <div style="font-size:13px;color:${MUTED};margin-top:2px">Paid ${usDate(d.paid_date)}</div>
      </td>
    </tr></table>

    <table role="presentation" width="100%" style="border-collapse:separate;border-spacing:0;margin-top:22px;background:${LAVENDER};border-radius:14px">
      <tr>
        <td style="padding:16px 18px;vertical-align:top;width:44%">
          <div style="font-size:12px;color:${MUTED}">Paid to</div>
          <div style="font-size:15px;font-weight:700;margin-top:3px">${esc(d.trainer_name)}</div>
          <div style="font-size:13px;color:${MUTED};line-height:1.5;margin-top:2px">${addr}</div>
        </td>
        <td style="padding:16px 18px;vertical-align:top">
          <div style="font-size:12px;color:${MUTED}">Pay period</div>
          <div style="font-size:15px;font-weight:700;margin-top:3px">${periodLabel(d.period_start, d.period_end)}</div>
          <div style="font-size:12px;color:${MUTED};margin-top:10px">Submitted</div>
          <div style="font-size:13px;margin-top:2px">${usDate(d.submit_date)}</div>
        </td>
        <td style="padding:16px 18px;vertical-align:top;text-align:right">
          <div style="font-size:12px;color:${MUTED}">Amount</div>
          <div style="font-size:22px;font-weight:800;color:${VIOLET};margin-top:1px;white-space:nowrap">${money(d.total)}</div>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:22px">
      <tr>
        <th style="padding:0 10px 8px;text-align:left;font-size:12px;font-weight:600;color:${MUTED};border-bottom:1px solid ${LINE};width:72px">Weeks</th>
        <th style="padding:0 10px 8px;text-align:left;font-size:12px;font-weight:600;color:${MUTED};border-bottom:1px solid ${LINE}">Dog and client</th>
        <th style="padding:0 10px 8px;text-align:left;font-size:12px;font-weight:600;color:${MUTED};border-bottom:1px solid ${LINE}">Program</th>
        <th style="padding:0 10px 8px;text-align:right;font-size:12px;font-weight:600;color:${MUTED};border-bottom:1px solid ${LINE}">Amount</th>
      </tr>
      ${rows || `<tr><td colspan="4" style="${td};color:${MUTED}">Nothing this period.</td></tr>`}
    </table>

    <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:18px"><tr>
      <td style="vertical-align:top;padding-right:16px">
        ${d.notes ? `<div style="font-size:12px;color:${MUTED}">Notes</div><div style="font-size:13px;line-height:1.55;margin-top:4px;white-space:pre-wrap">${esc(d.notes)}</div>` : ""}
      </td>
      <td style="vertical-align:top;width:250px">
        <table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px">
          <tr><td style="padding:4px 0;color:${MUTED}">Subtotal</td><td style="padding:4px 0;text-align:right">${money(d.subtotal)}</td></tr>
          <tr><td style="padding:4px 0;color:${MUTED}">Adjustments</td><td style="padding:4px 0;text-align:right">${money(d.adjustments)}</td></tr>
          <tr><td colspan="2" style="padding:0"><div style="margin-top:8px;background:${NAVY};color:#ffffff;border-radius:12px;padding:12px 14px">
            <table role="presentation" width="100%" style="border-collapse:collapse"><tr>
              <td style="font-size:13px;color:#CFC6FF">Total paid</td>
              <td style="text-align:right;font-size:22px;font-weight:800;white-space:nowrap;color:#ffffff">${money(d.total)}</td>
            </tr></table></div></td></tr>
        </table>
      </td>
    </tr></table>
  </div>
  <div style="margin-top:22px;padding:14px 30px;background:#FAF9FD;border-top:1px solid ${LINE};font-size:12px;color:${MUTED}">
    Dogwise Academy, 30 N Gould St, Sheridan, WY 82801. Questions about this payslip? Email info@dogwiseacademy.com
  </div>
</div>`;
}

export function payslipText(d: SlipData) {
  const lines = d.lines.map((l) => `  ${String(lineLead(l)).padEnd(4)} ${[lineClient(l), l.kind === "training" || l.kind === "route" ? l.dog : "", lineProgram(l)].filter(Boolean).join(" / ")}  ${money(l.amount)}`);
  return [`Dogwise Academy payslip for ${d.trainer_name}`, `Pay period: ${periodLabel(d.period_start, d.period_end)}`, `Submitted ${usDate(d.submit_date)}, paid ${usDate(d.paid_date)}`, "",
    ...lines, "", `Subtotal: ${money(d.subtotal)}`, `Adjustments: ${money(d.adjustments)}`, `Total: ${money(d.total)}`, d.notes ? `\nNotes: ${d.notes}` : ""].join("\n");
}
