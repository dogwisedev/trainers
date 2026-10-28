import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient, isDemo } from "./supabase";
import { programFor } from "./programs";
import { etParts } from "./chatRules";
import { scheduleFor, sendMinute, type Bk, type Planned, type PlanSettings, DEFAULT_SETTINGS } from "./trainingPlan";
export { scheduleFor, bookingProgram, DEFAULT_SETTINGS, type PlanSettings } from "./trainingPlan";
import { auditSystem } from "./audit";
import { pushToUsers } from "./push";

// Training materials: each program's list (and an "after drop-off" list), posted in the dog's chat at a steady
// random time between 12 and 6 PM Eastern, at most one a day. Set up on Admin → Training materials.
export { PLANS, planLabel } from "./trainingPlan";
export type Material = { id: string; plan: string; position: number; title: string; message: string | null; drive_id: string; kind: "video" | "file" | "photo"; active: boolean };
export const DEFAULT_INTRO = "Hey! As training goes on, we'll share short videos to help you get ready for training at home.";

/** "https://drive.google.com/file/d/ID/view", "…open?id=ID", "…/folders/ID" or a bare id → the Drive id. */
export function driveIdFrom(link: string): string | null {
  const s = String(link || "").trim();
  const m = s.match(/\/(?:file\/d|folders)\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/) || s.match(/^([\w-]{20,})$/);
  return m ? m[1] : null;
}
export const kindFor = (mime: string): Material["kind"] => (mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "photo" : "file");


export async function loadMaterials(sb: SupabaseClient = serviceClient()): Promise<Material[]> {
  const { data } = await sb.from("training_materials").select("*").eq("active", true).order("plan").order("position");
  return (data || []) as Material[];
}
export async function loadSettings(sb: SupabaseClient = serviceClient()): Promise<Map<string, PlanSettings>> {
  const { data } = await sb.from("training_plans").select("*");
  return new Map(((data || []) as PlanSettings[]).map((p) => [p.plan, p]));
}
export async function loadIntro(sb: SupabaseClient = serviceClient()): Promise<string> {
  const { data } = await sb.from("app_state").select("value").eq("key", "training_intro").maybeSingle();
  return (data?.value as string | undefined)?.trim() || DEFAULT_INTRO;
}

/** The 10-minute chat check: post today's item in each chat once its send time (12–5:30 PM Eastern) has come. */
export async function runTrainingSends(sb: SupabaseClient = serviceClient()) {
  const out = { sent: 0, skipped: 0, errors: [] as string[] };
  if (isDemo()) return out;
  const now = etParts(new Date());
  const minute = now.hour * 60 + now.minute;
  if (now.hour < 12 || now.hour >= 18) return out;
  const today = now.date;
  const materials = await loadMaterials(sb).catch(() => [] as Material[]);
  if (!materials.length) return out; // nothing set up yet (or migration 035 not run)
  const [settings, intro] = await Promise.all([loadSettings(sb), loadIntro(sb)]);
  const byId = new Map(materials.map((m) => [m.id, m]));
  const { data: chats } = await sb.from("chats").select("id, deal_key, title, client_user_id").eq("status", "open");
  const list = (chats || []) as { id: string; deal_key: string; title: string | null; client_user_id: string | null }[];
  const deals = list.map((c) => c.deal_key).filter((k) => /^\d+$/.test(k));
  if (!deals.length) return out;
  const { data: bks } = await sb.from("bookings").select("id, hubspot_deal_id, dog_name, start_date, end_date, status, program, program_choice, training_paused, created_at").in("hubspot_deal_id", deals);
  const { data: sends } = await sb.from("training_sends").select("deal_key, material_id, status, at").in("deal_key", deals);
  const sent = (sends || []) as { deal_key: string; material_id: string | null; status: string; at: string }[];
  for (const c of list) {
    try {
      if (!/^\d+$/.test(c.deal_key)) continue;
      const sch = scheduleFor(((bks || []) as Bk[]).filter((b) => b.hubspot_deal_id === c.deal_key), materials, settings);
      if (!sch || sch.paused || today < sch.start) continue;
      const mine = sent.filter((x) => x.deal_key === c.deal_key);
      const done = new Set(mine.map((x) => x.material_id));
      const items = today < sch.end ? sch.during : sch.after;
      const plan = today < sch.end ? sch.program || "" : "after";
      // First look at this chat for this list: items planned before today (a dog already in training) or with no
      // day left in the program are skipped, so nobody gets a backlog
      const firstLook = !mine.some((x) => byId.get(x.material_id || "")?.plan === plan);
      const skip = items.filter((p) => !done.has(p.id) && (p.on === null || (firstLook && p.on < today)));
      // Once the program has ended, anything from it that didn't go out is closed off (not sent late)
      if (today >= sch.end) for (const p of sch.during) if (!done.has(p.id) && !skip.some((x) => x.id === p.id)) skip.push({ ...p, on: p.on });
      if (skip.length) {
        await sb.from("training_sends").upsert(skip.map((p) => ({ deal_key: c.deal_key, booking_id: sch.lead.id, material_id: p.id, plan, position: p.position, status: "skipped",
          planned_on: p.on, note: p.on === null ? "No day left in the program" : today >= sch.end && sch.during.some((d) => d.id === p.id) ? "The program ended before it went out" : "Planned before this dog started getting materials" })), { onConflict: "deal_key,material_id", ignoreDuplicates: true });
        out.skipped += skip.length;
        skip.forEach((p) => done.add(p.id));
      }
      // At most one a day, at this chat's time for today
      if (mine.some((x) => x.status === "sent" && etParts(new Date(x.at)).date === today)) continue;
      if (minute < sendMinute(c.deal_key, today)) continue;
      const due = items.find((p) => p.on && p.on <= today && !done.has(p.id));
      if (!due) continue;
      const m = byId.get(due.id)!;
      const first = !mine.some((x) => x.status === "sent");
      const body = [first ? intro : "", (m.message || "").trim()].filter(Boolean).join("\n\n") || m.title;
      const { data: msg, error } = await sb.from("chat_messages").insert({
        chat_id: c.id, sender_role: "admin", sender_name: "Dogwise team", kind: "media", body: body.slice(0, 4000),
        media: [{ id: m.drive_id, name: m.title, kind: m.kind }],
        notified_at: new Date().toISOString() // the usual "new message" push and trainer email are skipped for these…
      }).select("id").single();
      const row = { deal_key: c.deal_key, booking_id: sch.lead.id, material_id: m.id, plan, position: m.position, planned_on: due.on, chat_id: c.id };
      if (error || !msg) {
        out.errors.push(`${c.title || c.deal_key}: ${error?.message || "not posted"}`);
        await auditSystem("Couldn't send training material", `${c.title || "Dog"}: ${m.title}`, { ok: false, error: error?.message || "not posted", link: `/a/chats/${c.id}` });
        continue; // tried again on the next check
      }
      await sb.from("training_sends").upsert({ ...row, status: "sent", message_id: msg.id }, { onConflict: "deal_key,material_id" });
      // …only the client gets a phone notification (their daily update email covers it too)
      if (c.client_user_id) await pushToUsers([c.client_user_id], { title: `New for ${c.title || "your dog"}: ${m.title}`, body: (m.message || "A short helper from the Dogwise team").slice(0, 160), url: `/c/${c.id}`, tag: `chat-${c.id}` }).catch(() => {});
      out.sent++;
    } catch (e) { out.errors.push(`${c.title || c.deal_key}: ${(e as Error).message}`); }
  }
  return out;
}

export { programFor };

export type DogTrainingRow = { title: string; kind: Material["kind"]; on: string | null; status: "sent" | "skipped" | "planned"; phase: "during" | "after" };
/** Dog page: what this dog's chat gets, when, and what's gone out (or been skipped). */
export async function dealTraining(dealKey: string, sb: SupabaseClient = serviceClient()) {
  if (!/^\d+$/.test(dealKey)) return null;
  try {
    const [materials, settings, { data: bks }, { data: sends }] = await Promise.all([
      loadMaterials(sb), loadSettings(sb),
      sb.from("bookings").select("id, hubspot_deal_id, dog_name, start_date, end_date, status, program, program_choice, training_paused, created_at").eq("hubspot_deal_id", dealKey),
      sb.from("training_sends").select("material_id, status").eq("deal_key", dealKey)
    ]);
    const sch = scheduleFor((bks || []) as Bk[], materials, settings);
    if (!sch) return null;
    const st = new Map(((sends || []) as { material_id: string; status: "sent" | "skipped" | "failed" }[]).map((x) => [x.material_id, x.status]));
    const byId = new Map(materials.map((m) => [m.id, m]));
    const row = (p: Planned, phase: DogTrainingRow["phase"]): DogTrainingRow => {
      const s = st.get(p.id);
      return { title: byId.get(p.id)?.title || "Item", kind: byId.get(p.id)?.kind || "video", on: p.on, status: s === "sent" ? "sent" : s === "skipped" || p.on === null ? "skipped" : "planned", phase };
    };
    return { program: sch.program, paused: sch.paused, leadId: sch.lead.id, rows: [...sch.during.map((p) => row(p, "during")), ...sch.after.map((p) => row(p, "after"))] };
  } catch { return null; } // migration 035 not run yet
}
