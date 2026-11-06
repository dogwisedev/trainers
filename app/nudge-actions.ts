"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/data";
import { audited } from "@/lib/audit";
import { isDemo, serverClient, serviceClient } from "@/lib/supabase";
import { pushToTrainer } from "@/lib/push";
import { fromFor, loadPocNumbers, quoNumber, sendText, toE164 } from "@/lib/quo";
import type { NudgeKind } from "@/lib/nudges";

// The office's check-in with a trainer, from an item the reminder ladder handed to To do (components/ChaseActions.tsx).
// Each one is logged in `nudges` with what the app suggested and whether it was changed, so we can see how often the
// suggestion is used as it is. Messages go in the trainer's Dogwise team thread, where the whole office can see them.

export type CheckIn = { ref: string | null; kind: NudgeKind; trainerId: string; chatId: string | null; bookingId: string | null };
type R = { ok: boolean; message: string };
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

async function admin() {
  const v = await getViewer();
  if (!v || v.role !== "admin") throw new Error("Admins only.");
  return { v, who: v.name === "Dogwise team" || v.name === "Dogwise Admin" ? (v.email || "An admin").split("@")[0] : v.name };
}
/** The log line. Never stops the action: the message already went. */
async function log(c: CheckIn, by: string, channel: string, body: string, suggested: string | null) {
  try {
    await serviceClient().from("nudges").insert({
      ref: c.ref || `checkin:${c.chatId || c.bookingId || c.trainerId}`, kind: c.kind, step: null, by, trainer_id: c.trainerId, chat_id: c.chatId, booking_id: c.bookingId,
      channels: [channel], body: body.slice(0, 1000), suggested, edited: suggested == null ? null : norm(body) !== norm(suggested)
    });
  } catch { /* the log must never undo a sent message */ }
}

/** Send in app (the trainer's Dogwise team thread, plus a phone notification) or as a text from the Quo number. */
export async function checkInAction(c: CheckIn, channel: "app" | "text", text: string, suggested: string): Promise<R> {
  return audited("checkIn", { ...c, channel, text }, async () => {
    if (isDemo()) return { ok: false, message: "Demo mode: connect Supabase to send." };
    const { v, who } = await admin();
    const body = text.trim();
    if (!body) return { ok: false, message: "Write a message first." };
    const sb = serviceClient();
    const { data: t } = await sb.from("trainers").select("id, name, phone, poc").eq("id", c.trainerId).maybeSingle();
    if (!t) return { ok: false, message: "Trainer not found." };
    if (channel === "text") {
      if (!toE164(t.phone)) return { ok: false, message: `${t.name} has no mobile number on their profile.` };
      const r = await sendText(t.phone, `Dogwise: ${body}`, fromFor(t.poc, await loadPocNumbers(sb)).from); // from their POC's own Quo number when it's set
      if (!r.ok) return { ok: false, message: `The text didn't go: ${r.error}` };
    } else {
      const { error } = await serverClient().from("messages").insert({ trainer_id: t.id, sender_id: v.userId, sender_role: "admin", sender_name: "Dogwise team", body: body.slice(0, 4000) });
      if (error) return { ok: false, message: error.message };
      await pushToTrainer(t.id, { title: "Message from the Dogwise team", body, url: "/t/messages", tag: "team" });
    }
    await log(c, who, channel, body, suggested || null);
    revalidatePath("/a");
    return { ok: true, message: channel === "text" ? `Texted ${t.name.split(" ")[0]}` : `Sent to ${t.name.split(" ")[0]} in the app` };
  });
}

/** Tapping Call: logged as an attempt (whether they picked up isn't known here). The item still clears only when the trainer acts. */
export async function logCallAction(c: CheckIn): Promise<R> {
  try {
    if (isDemo()) return { ok: true, message: "" };
    const { who } = await admin();
    await log(c, who, "call", "Called the trainer", null);
    return { ok: true, message: "" };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

/** Your account → Your Quo number: the number texts to your trainers come from, and the POC name you answer to. */
export async function saveQuoNumberAction(_: R | null, f: FormData): Promise<R> {
  return audited("saveQuoNumber", { number: String(f.get("number") || ""), poc: String(f.get("poc") || "") }, async () => {
    if (isDemo()) return { ok: false, message: "Demo mode: connect Supabase to save." };
    const { v } = await admin();
    const raw = String(f.get("number") || "").trim(), poc = String(f.get("poc") || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const number = raw ? quoNumber(raw) : null;
    if (raw && !number) return { ok: false, message: "That doesn't look like a Quo number: type it like +1 646 576 7764, or its ID (PN…)." };
    const { error } = await serviceClient().from("profiles").update({ quo_number: number, quo_poc: number ? poc || null : null }).eq("id", v.userId);
    if (error) return { ok: false, message: /quo_|schema cache/i.test(error.message) ? "Run migration 051 in Supabase first." : error.message };
    revalidatePath("/a/account");
    return { ok: true, message: number ? `Saved. Texts to ${poc ? `${poc}'s` : "your"} trainers come from ${number}.` : "Removed: your trainers get texts from the default number." };
  });
}
