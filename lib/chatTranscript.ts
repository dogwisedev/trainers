import { ChatMsg, ChatRow, driveView } from "./chatTypes";
import { ReportView } from "./reportDoc";
import { etParts } from "./chatRules";

// A chat's whole history as a document (same look as the reports), saved to Drive when a chat is closed.
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
const md = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const yr = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", timeZone: "America/New_York" });
/** "Oct 12 - Oct 14, 2026" (short enough for the facts box) */
const period = (a: string, b: string) => (md(a) === md(b) && yr(a) === yr(b) ? `${md(a)}, ${yr(a)}` : yr(a) === yr(b) ? `${md(a)} - ${md(b)}, ${yr(a)}` : `${md(a)} ${yr(a)} - ${md(b)} ${yr(b)}`);

export function buildTranscript(chat: Pick<ChatRow, "title" | "client_name" | "trainer_name">, msgs: ChatMsg[]): ReportView {
  const byDay = new Map<string, ChatMsg[]>();
  for (const m of msgs) { const k = etParts(new Date(m.created_at)).date; byDay.set(k, [...(byDay.get(k) || []), m]); }
  const first = msgs[0]?.created_at, last = msgs[msgs.length - 1]?.created_at;
  return {
    kind: "handover", title: "Chat transcript", dog: chat.title || "", client: chat.client_name || "", trainer: chat.trainer_name || "",
    facts: [{ label: "Dog", value: chat.title || "" }, { label: "Client", value: chat.client_name || "" }, { label: "Trainer", value: chat.trainer_name || "" }, ...(first && last ? [{ label: "Period", value: period(first, last) }] : [])],
    blocks: [...byDay.values()].map((list) => ({
      heading: dayLabel(list[0].created_at),
      rows: list.map((m) => ({
        label: `${clock(m.created_at)}  ${m.sender_role === "system" ? "Dogwise" : m.sender_name || m.sender_role}`,
        value: m.kind === "report" ? `Report: ${m.body}` : [m.body, ...m.media.map((x) => `[${x.kind === "video" ? "Video" : x.kind === "photo" ? "Photo" : "File"}] ${x.name}`)].filter(Boolean).join("\n")
      })).filter((r) => r.value),
      media: list.flatMap((m) => m.media.map((x) => ({ label: x.name, url: driveView(x.id), kind: x.kind })))
    }))
  };
}
