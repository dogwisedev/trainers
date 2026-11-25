// Flagged parts of a trainer's form (intake, weekly health check, handover): what the app's check said to look at, and the
// health answers that aren't "all fine". Pure, so the form (to show them) and the server (to insist on them) agree.
// A flagged form can't be approved until the person approving has ticked every flag and written what they did about it
// (migration 069, report_flag_acks): it was too easy to read "look at this first" and press Approve anyway.
import { Answers, Kind, healthFlags } from "./reports";

export type FormFlag = { key: string; source: "ai" | "health"; text: string; quote?: string };
export type FlagAck = { key: string; note: string };
export const ACK_MIN = 5;

const keyOf = (source: string, text: string) => `${source}:${text.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200)}`;

export function formFlags(kind: Kind, a: Answers, check?: { verdict: string; points?: { point: string; quote?: string }[] | null } | null): FormFlag[] {
  const out: FormFlag[] = [];
  if (check?.verdict === "check") for (const p of check.points || []) if (p?.point) out.push({ key: keyOf("ai", p.point), source: "ai", text: p.point, quote: p.quote });
  for (const h of healthFlags(kind, a)) out.push({ key: keyOf("health", h), source: "health", text: h });
  return out.filter((f, i) => out.findIndex((x) => x.key === f.key) === i);
}

/** The flags still without a tick and a note of what was done. Empty = it can be approved. */
export function unacked(flags: FormFlag[], acks: FlagAck[] | undefined | null): FormFlag[] {
  const by = new Map((acks || []).map((x) => [x.key, String(x.note || "").trim()]));
  return flags.filter((f) => (by.get(f.key) || "").length < ACK_MIN);
}
