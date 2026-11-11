import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase";
import { auditSystem } from "./audit";
import { saveAiSetting } from "./aiSettings";
import { pushToAdmins } from "./push";
import type { Change } from "./aiChange";

// Trust in the AI (migration 058). Every decision a person makes on something the AI did is logged (ai_decisions), so:
//  - each feature shows its approval rate: how often people agreed with the AI over the last 4 weeks (small edits count
//    as agreeing, see lib/aiChange.ts);
//  - "Auto" (let the AI decide on its own) can only be switched on once a feature has earned it: at least AUTO_MIN_RATE
//    agreement over at least AUTO_MIN_DECISIONS decisions in the last 4 weeks;
//  - while Auto is on, 1 in SPOT_EVERY items still goes to a person (a spot check), and if people disagree with more than
//    1 in 10 of the last 20 spot checks, Auto switches itself off and the admins are told;
//  - patterns worth a look are listed, neutrally: a decision changed back, many decisions seconds apart, one person
//    disagreeing far more than everyone else.

export type Feature = "vaccines" | "forms" | "messages" | "captions" | "speak" | "handover";
export const AUTO_FEATURES = ["vaccines", "forms"] as const;  // the ones where the AI can take a person's decision
export type AutoFeature = (typeof AUTO_FEATURES)[number];
export const AUTO_MIN_RATE = 95, AUTO_MIN_DECISIONS = 30, SPOT_EVERY = 10, WEEKS = 4;
const SPOT_WINDOW = 20, SPOT_MIN_RATE = 90;

/** Logs a person's (or, with auto, the app's) decision. Never throws: the decision itself already happened. */
export async function logDecision(d: { feature: Feature; itemId: string; label?: string; ai?: string | null; decision: string; agreed: boolean | null; change?: Change | null; by: string; spot?: boolean; auto?: boolean }, sb: SupabaseClient = serviceClient()) {
  try {
    await sb.from("ai_decisions").insert({ feature: d.feature, item_id: d.itemId, item_label: d.label || null, ai: d.ai ?? null, decision: d.decision, agreed: d.agreed, change: d.change ?? null, by: d.by, spot: !!d.spot, auto: !!d.auto });
    if (d.spot && !d.auto && (AUTO_FEATURES as readonly string[]).includes(d.feature)) await checkSpots(d.feature as AutoFeature, sb);
  } catch { /* never in the way */ }
}

/** Every SPOT_EVERY-th item (by a stable hash of its id) still goes to a person while Auto is on. */
export function isSpotCheck(itemId: string): boolean {
  let h = 0; for (const c of itemId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % SPOT_EVERY === 0;
}

type Row = { feature: string; item_id: string; item_label: string | null; ai: string | null; decision: string; agreed: boolean | null; change: string | null; by: string | null; at: string; spot: boolean; auto: boolean };
const since = () => new Date(Date.now() - WEEKS * 7 * 864e5).toISOString();

export type Rate = { feature: Feature; decided: number; agreed: number; rate: number | null; canAuto: boolean; need: string; what: string };
/** Each feature's approval rate over the last 4 weeks: how often people agreed with what the AI did (small edits count as
 *  agreeing). Vaccines and forms: decisions logged by people, where the AI took a side. The rest: from what was sent. */
export async function aiRates(sb: SupabaseClient = serviceClient()): Promise<Record<Feature, Rate> | null> {
  const from = since();
  const [dec, needs, caps, voice, drafts] = await Promise.all([
    sb.from("ai_decisions").select("feature, agreed, auto, spot").gte("at", from).in("feature", ["vaccines", "forms"]).limit(20000),
    sb.from("message_needs").select("needs, first, by").gte("sent_at", from).limit(20000),
    sb.from("ai_captions").select("suggested, final, used_at").gte("created_at", from).not("used_at", "is", null).limit(5000),
    sb.from("ai_voice").select("tidied, final, sent_at").gte("created_at", from).not("sent_at", "is", null).limit(5000),
    sb.from("reports").select("ai_draft").eq("kind", "handover").not("ai_draft", "is", null).gte("created_at", from).limit(2000)
  ]);
  if (dec.error) return null;
  const { textChange } = await import("./aiChange");
  const pair = (n: number, ok: number) => ({ decided: n, agreed: ok, rate: n ? Math.round((ok / n) * 100) : null });
  const people = ((dec.data || []) as { feature: string; agreed: boolean | null; auto: boolean }[]).filter((r) => !r.auto && r.agreed !== null);
  const fromLog = (f: Feature) => { const m = people.filter((r) => r.feature === f); return pair(m.length, m.filter((r) => r.agreed).length); };
  const n = (needs.data || []) as { needs: string; first: string | null; by: string }[];
  const changedByPeople = n.filter((r) => r.first && r.first !== r.needs && r.by !== "ai" && r.by !== "rules").length;
  const sent = (rows: { a: string | null; b: string | null }[]) => { const r = rows.filter((x) => x.a && x.b); return pair(r.length, r.filter((x) => textChange(x.a, x.b) !== "major").length); };
  const parts = ((drafts.data || []) as { ai_draft: { result?: Record<string, string> } }[]).flatMap((r) => Object.values(r.ai_draft?.result || {}));
  const raw: Record<Feature, { decided: number; agreed: number; rate: number | null; what: string }> = {
    vaccines: { ...fromLog("vaccines"), what: "decisions" },
    forms: { ...fromLog("forms"), what: "decisions" },
    messages: { ...pair(n.length, n.length - changedByPeople), what: "messages read" },
    captions: { ...sent(((caps.data || []) as { suggested: string; final: string | null }[]).map((x) => ({ a: x.suggested, b: x.final }))), what: "sent" },
    speak: { ...sent(((voice.data || []) as { tidied: string | null; final: string | null }[]).map((x) => ({ a: x.tidied, b: x.final }))), what: "sent" },
    handover: { ...pair(parts.length, parts.filter((p) => p === "kept").length), what: "parts sent in" }
  };
  const out = {} as Record<Feature, Rate>;
  for (const f of Object.keys(raw) as Feature[]) {
    const r = raw[f], autoable = (AUTO_FEATURES as readonly string[]).includes(f);
    const canAuto = autoable && r.decided >= AUTO_MIN_DECISIONS && (r.rate ?? 0) >= AUTO_MIN_RATE;
    const need = !autoable ? "" : r.decided < AUTO_MIN_DECISIONS ? `${AUTO_MIN_DECISIONS - r.decided} more decisions by people first` : (r.rate ?? 0) < AUTO_MIN_RATE ? `needs ${AUTO_MIN_RATE}% agreement (it's ${r.rate}%)` : "";
    out[f] = { feature: f, ...r, canAuto, need };
  }
  return out;
}

/** While Auto is on: if people disagree with more than 1 in 10 of the last 20 spot checks, Auto switches itself off. */
async function checkSpots(feature: AutoFeature, sb: SupabaseClient) {
  const { data } = await sb.from("ai_decisions").select("agreed").eq("feature", feature).eq("spot", true).eq("auto", false).not("agreed", "is", null).order("at", { ascending: false }).limit(SPOT_WINDOW);
  const rows = (data || []) as { agreed: boolean }[];
  if (rows.length < 10) return;
  const rate = Math.round((rows.filter((r) => r.agreed).length / rows.length) * 100);
  if (rate >= SPOT_MIN_RATE) return;
  const key = feature === "vaccines" ? "vaccineAuto" : "formCheck", value = feature === "vaccines" ? false : "suggest";
  const { data: cur } = await sb.from("app_settings").select("value").eq("key", `ai.${key}`).maybeSingle();
  if (cur?.value === value || (feature === "vaccines" && cur?.value !== true) || (feature === "forms" && cur?.value !== "auto")) return; // already off
  await saveAiSetting(key, value, "app (spot checks)", sb);
  const what = feature === "vaccines" ? "Vaccine checks" : "Form checks";
  await auditSystem(`${what}: Auto switched itself off`, `People agreed with only ${rate}% of the last ${rows.length} spot checks (it needs ${SPOT_MIN_RATE}%). Everything goes to a person again.`, { link: "/a/pulse?view=office" }).catch(() => null);
  await pushToAdmins({ title: `${what}: back to a person`, body: `Spot checks found the AI wrong too often (${rate}% agreed), so Auto is off again.`, url: "/a/pulse?view=office", tag: `ai-auto-off-${feature}` }).catch(() => 0);
}

export type Flag = { kind: "changed_back" | "fast" | "disagrees"; who: string; text: string; at: string };
/** Patterns worth a look over the last 4 weeks. Neutral: each one can be innocent; it's a reason to look, not a verdict. */
export async function aiFlags(sb: SupabaseClient = serviceClient()): Promise<Flag[] | null> {
  const { data, error } = await sb.from("ai_decisions").select("feature, item_id, item_label, ai, decision, agreed, change, by, at, spot, auto").gte("at", since()).eq("auto", false).order("at").limit(20000);
  if (error) return null;
  const rows = (data || []) as Row[];
  const flags: Flag[] = [];
  const nice = (f: string) => ({ vaccines: "vaccine check", forms: "form", messages: "client message", captions: "suggested update", speak: "spoken message", handover: "handover draft" } as Record<string, string>)[f] || f;
  // 1) A decision changed back on the same item within a day (rejected then accepted, or the other way)
  const byItem = new Map<string, Row[]>();
  for (const r of rows.filter((x) => x.feature === "vaccines" || x.feature === "forms")) byItem.set(`${r.feature}:${r.item_id}`, [...(byItem.get(`${r.feature}:${r.item_id}`) || []), r]);
  for (const list of byItem.values()) for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    if (a.decision !== b.decision && Date.parse(b.at) - Date.parse(a.at) < 864e5 && !(a.decision === "sent_back" && b.decision === "approved_after_fix")) {
      flags.push({ kind: "changed_back", who: b.by || "?", at: b.at, text: `${b.item_label || nice(b.feature)}: ${a.by === b.by ? `${b.by} decided "${a.decision.replace("_", " ")}", then changed it to "${b.decision.replace("_", " ")}"` : `${a.by} decided "${a.decision.replace("_", " ")}", then ${b.by} changed it to "${b.decision.replace("_", " ")}"`} ${Math.round((Date.parse(b.at) - Date.parse(a.at)) / 60000)} min later.` });
    }
  }
  // 2) Many decisions seconds apart (5 or more within 2 minutes): hard to have read each one
  const byWho = new Map<string, Row[]>();
  for (const r of rows.filter((x) => x.feature === "vaccines" || x.feature === "forms")) byWho.set(r.by || "?", [...(byWho.get(r.by || "?") || []), r]);
  for (const [who, list] of byWho) {
    for (let i = 0; i + 4 < list.length; i++) {
      if (Date.parse(list[i + 4].at) - Date.parse(list[i].at) <= 120000) {
        let j = i + 4; while (j + 1 < list.length && Date.parse(list[j + 1].at) - Date.parse(list[i].at) <= 300000) j++;
        flags.push({ kind: "fast", who, at: list[i].at, text: `${who} made ${j - i + 1} decisions on AI-checked items in ${Math.max(1, Math.round((Date.parse(list[j].at) - Date.parse(list[i].at)) / 60000))} min (${new Date(list[i].at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET).` });
        i = j;
      }
    }
  }
  // 3) One person disagreeing with the AI far more than everyone else (at least 10 decisions each)
  for (const f of ["vaccines", "forms", "messages"]) {
    const judged = rows.filter((r) => r.feature === f && r.agreed !== null);
    const people = new Map<string, Row[]>();
    for (const r of judged) people.set(r.by || "?", [...(people.get(r.by || "?") || []), r]);
    for (const [who, list] of people) {
      if (list.length < 10) continue;
      const others = judged.filter((r) => (r.by || "?") !== who);
      if (others.length < 10) continue;
      const me = list.filter((r) => r.agreed).length / list.length, rest = others.filter((r) => r.agreed).length / others.length;
      if (rest - me >= 0.25) flags.push({ kind: "disagrees", who, at: list[list.length - 1].at, text: `${who} agrees with the AI on ${Math.round(me * 100)}% of ${nice(f)}s (${list.length}), the rest of the team on ${Math.round(rest * 100)}%. Worth comparing a few together: it could be the AI, or how it's being used.` });
    }
  }
  return flags.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
}
