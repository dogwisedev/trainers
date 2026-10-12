// How a report reads: one set of "blocks" feeds the email, the in-app view and the PDF.
import { Answers, HANDOVER_AFTER, HANDOVER_SIMPLE, Kind, MediaItem, WEEKLY_SECTIONS, Field, arr, items, s } from "./reports";
import { usDate } from "./payroll";
import { LAVENDER, LINE, MUTED, NAVY, VIOLET, INK } from "./payslipDoc";

export type Block = {
  heading: string;
  rows?: { label: string; value: string }[];
  items?: { title: string; text: string }[];
  media?: { label: string; url: string; kind: "video" | "photo" }[];
};
export type ReportView = {
  kind: Kind; title: string; dog: string; client: string; trainer: string;
  facts: { label: string; value: string }[]; blocks: Block[]; sentOn?: string;
};
export const driveUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

function fieldValue(f: Field, a: Answers): string {
  if (f.type === "multi") return [...arr(a[f.key]), ...(f.type === "multi" && s(a[`${f.key}_other`]) ? [s(a[`${f.key}_other`])] : [])].join(", ");
  if (f.type === "yesno") return a[f.key] === "yes" ? `Yes: ${s(a[`${f.key}_detail`])}` : a[f.key] === "no" ? "No" : "";
  return s(a[f.key]);
}
const rowsOf = (fields: Field[], a: Answers) => fields.map((f) => ({ label: f.label.replace(/[?]$/, ""), value: fieldValue(f, a) })).filter((r) => r.value);
const mediaOf = (m: MediaItem[], slot: MediaItem["slot"]) => m.filter((x) => x.slot === slot).map((x) => ({ label: x.description || x.name, url: driveUrl(x.id), kind: x.kind }));

export function buildReport(kind: Kind, a: Answers, media: MediaItem[], extra: { startDate?: string; endDate?: string; submittedAt?: string | null } = {}): ReportView {
  const dog = s(a.dogName), client = s(a.clientName), trainer = s(a.trainerName);
  const week = Number(a.weekNumber) || 0;
  if (kind === "weekly") {
    return {
      kind, dog, client, trainer, title: `Week ${week} report`,
      facts: [{ label: "Dog", value: dog }, { label: "Client", value: client }, { label: "Trainer", value: trainer }, { label: "Training week", value: String(week) }, ...(extra.submittedAt ? [{ label: "Submitted", value: usDate(extra.submittedAt.slice(0, 10)) }] : [])],
      blocks: WEEKLY_SECTIONS.map((sec) => ({ heading: sec.title, rows: rowsOf(sec.fields, a) }))
    };
  }
  const t = items(a.training).filter((i) => i.title || i.text), h = items(a.homework).filter((i) => i.title || i.text);
  const blocks: Block[] = [
    { heading: "Program", rows: [{ label: "Program type", value: s(a.programType) }, { label: "Location", value: s(a.clientLocation) }, ...(extra.startDate ? [{ label: "Dates", value: `${usDate(extra.startDate)} to ${usDate(extra.endDate || extra.startDate)}` }] : [])].filter((r) => r.value) },
    { heading: "Main goals and focus", rows: rowsOf([HANDOVER_SIMPLE[2]], a).map((r) => ({ label: "", value: r.value })) },
    { heading: "Training details", items: t, media: mediaOf(media, "training") },
    { heading: "Homework details", items: h, media: mediaOf(media, "homework") },
    { heading: "Additional details", rows: rowsOf([HANDOVER_AFTER[0], HANDOVER_AFTER[1]], a) },
    { heading: "Overall trainer review", rows: rowsOf([HANDOVER_AFTER[2]], a).map((r) => ({ label: "", value: r.value })) },
    { heading: "Snout to tail health check", media: mediaOf(media, "health") }
  ].filter((b) => (b.rows?.length || b.items?.length || b.media?.length)) as Block[];
  return { kind, dog, client, trainer, title: "Handover report", facts: [{ label: "Dog", value: dog }, { label: "Client", value: client }, { label: "Trainer", value: trainer }], blocks };
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const para = (t: string) => esc(t).replace(/\n/g, "<br>");

export function reportHtml(r: ReportView, logoSrc: string, opts: { forEmail?: boolean } = {}) {
  const blocks = r.blocks.map((b) => `
    <div style="margin-top:14px;border:1px solid ${LINE};border-radius:14px;overflow:hidden">
      <div style="background:${LAVENDER};padding:9px 16px;font-size:13px;font-weight:700;color:${NAVY};letter-spacing:.02em">${esc(b.heading)}</div>
      <div style="padding:6px 16px 10px">
        ${(b.rows || []).map((x) => `<div style="padding:8px 0;border-bottom:1px solid ${LINE}">${x.label ? `<div style="font-size:12px;color:${MUTED}">${esc(x.label)}</div>` : ""}<div style="font-size:15px;color:${INK};line-height:1.5">${para(x.value)}</div></div>`).join("")}
        ${(b.items || []).map((x, i) => `<div style="padding:9px 0;border-bottom:1px solid ${LINE}"><div style="font-size:14px;font-weight:700;color:${INK}">${i + 1}. ${esc(x.title)}</div><div style="font-size:15px;color:${INK};line-height:1.5;margin-top:2px">${para(x.text)}</div></div>`).join("")}
        ${(b.media || []).map((x) => `<div style="padding:9px 0"><a href="${x.url}" style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:8px 14px;border-radius:9px">${x.kind === "video" ? "Watch video" : "View photo"}</a><span style="font-size:14px;color:${INK};margin-left:10px">${esc(x.label)}</span></div>`).join("")}
      </div>
    </div>`).join("");
  return `
<div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};border:1px solid ${LINE}">
  <div style="height:6px;background:linear-gradient(90deg,${NAVY},${VIOLET})"></div>
  <div style="padding:26px 28px 22px">
    <table role="presentation" width="100%" style="border-collapse:collapse"><tr>
      <td style="vertical-align:middle"><img src="${logoSrc}" alt="Dogwise Academy" width="160" style="display:block;height:auto;max-width:160px"></td>
      <td style="vertical-align:middle;text-align:right"><div style="font-size:24px;font-weight:800;color:${NAVY};letter-spacing:-0.02em">${esc(r.title)}</div><div style="font-size:14px;color:${MUTED};margin-top:2px">${esc(r.dog)}</div></td>
    </tr></table>
    <table role="presentation" width="100%" style="border-collapse:separate;margin-top:18px;background:${LAVENDER};border-radius:14px"><tr>
      ${r.facts.map((f) => `<td style="padding:12px 14px;vertical-align:top"><div style="font-size:12px;color:${MUTED}">${esc(f.label)}</div><div style="font-size:15px;font-weight:700;margin-top:2px">${esc(f.value)}</div></td>`).join("")}
    </tr></table>
    ${blocks}
  </div>
  <div style="padding:14px 28px;background:#FAF9FD;border-top:1px solid ${LINE};font-size:12px;color:${MUTED}">Dogwise Academy, 30 N Gould St, Sheridan, WY 82801. Questions? Email info@dogwiseacademy.com</div>
</div>`;
}

export function reportText(r: ReportView) {
  const lines = [`${r.title}: ${r.dog}`, `Client: ${r.client}. Trainer: ${r.trainer}`, ""];
  for (const b of r.blocks) {
    lines.push(b.heading.toUpperCase());
    (b.rows || []).forEach((x) => lines.push(x.label ? `${x.label}: ${x.value}` : x.value));
    (b.items || []).forEach((x, i) => lines.push(`${i + 1}. ${x.title}: ${x.text}`));
    (b.media || []).forEach((x) => lines.push(`${x.kind === "video" ? "Video" : "Photo"}: ${x.label} ${x.url}`));
    lines.push("");
  }
  return lines.join("\n");
}
