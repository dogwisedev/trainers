import { NextResponse } from "next/server";
import { getViewer } from "@/lib/data";
import { isDemo, serviceClient } from "@/lib/supabase";
import { aiErrorText, aiLastError, aiOn } from "@/lib/ai";
import { aiSettings } from "@/lib/aiSettings";
import { etParts } from "@/lib/chatRules";
import { fillForm, sttOn, tailorChat, transcribe } from "@/lib/voice";
import type { Answers, Kind } from "@/lib/reports";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
// "Speak" in a chat or on a form (lib/voice.ts). Normally the phone's own speech recognition turns the talking into words
// and only those words (`heard`) come here, to be tidied by Claude. If a transcription service is set up in Vercel
// (STT_API_KEY or OPENAI_API_KEY), a recording comes instead and is turned into text here first; it is never stored.
// GET says which of the two this deployment uses, so the button knows whether to listen in the browser or record.
export async function GET() {
  const v = await getViewer().catch(() => null);
  if (!v || (v.role !== "trainer" && v.role !== "admin")) return NextResponse.json({ on: false, stt: false, ai: false }, { status: 401 });
  // on: the Speak switch (Pulse → Office → AI help). ai: Claude is set up (ANTHROPIC_API_KEY), so words get tidied and forms filled.
  const on = !isDemo() && (await aiSettings(serviceClient()).catch(() => ({ voice: true }))).voice;
  return NextResponse.json({ on, stt: sttOn(), ai: aiOn() });
}
const fail = (message: string, status = 400) => NextResponse.json({ ok: false, message }, { status });

export async function POST(req: Request) {
  try {
    if (isDemo()) return fail("Demo mode.");
    const v = await getViewer();
    if (!v || (v.role !== "trainer" && v.role !== "admin")) return fail("Sign in again.", 401);
    const sb = serviceClient();
    if (!(await aiSettings(sb)).voice) return fail("Speaking is switched off. An admin can turn it on: Pulse, Office, AI help.");
    const f = await req.formData();
    const audio = f.get("audio"), mode = String(f.get("mode") || "");
    // The words the phone heard (or typed in the box when it couldn't listen), or a recording to turn into words here
    const said = String(f.get("heard") || "").replace(/\s+/g, " ").trim().slice(0, 8000);
    const hasAudio = audio instanceof Blob && audio.size > 0;
    if (!said && !hasAudio) return fail("Didn't hear anything. Try again.");
    if (!said && hasAudio) {
      if (!sttOn()) return fail("This phone can't listen here. Type it, or use the microphone on your keyboard.");
      if ((audio as Blob).size < 1500) return fail("That was too short to hear. Talk a little longer and try again.");
      if ((audio as Blob).size > 4_200_000) return fail("That one was too long. Do it in shorter parts.");
    }
    const seconds = Math.min(600, Number(f.get("seconds")) || 0);
    const type = hasAudio ? (audio as Blob).type : "";
    const ext = /mp4|m4a|aac/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : /wav/.test(type) ? "wav" : "webm";
    const hear = async (names: (string | null | undefined)[]) => (said ? { ok: true as const, text: said } : transcribe(audio as Blob, `speech.${ext}`, names.filter(Boolean) as string[]));

    if (mode === "chat") {
      const chatId = String(f.get("chatId") || "");
      const { data: chat } = await sb.from("chats").select("id, title, client_name, trainer_id, trainer_name").eq("id", chatId).maybeSingle();
      if (!chat || (v.role === "trainer" && chat.trainer_id !== v.trainerId)) return fail("Chat not found.", 404);
      const t = await hear([chat.title, chat.client_name, chat.trainer_name]);
      if (!t.ok) return fail(t.error, 502);
      if (t.text.split(" ").length < 2) return fail("Couldn't hear anything to write. Try again a little closer to the phone.");
      // Without the Claude key the words go back exactly as said: plain speech to text, still theirs to check and send
      const text = aiOn() ? await tailorChat(sb, { userId: v.userId, role: v.role, chatId, heard: t.text }) : null;
      await sb.from("ai_voice").insert({ user_id: v.userId, role: v.role, mode: "chat", chat_id: chatId, seconds, heard_chars: t.text.length }).then(() => null, () => null);
      // Not tidied (no key, or Claude didn't answer): the exact words, and for an admin, why
      const why = text ? "" : !aiOn() ? "The Claude key (ANTHROPIC_API_KEY) isn't set in Vercel." : aiErrorText(aiLastError());
      return NextResponse.json({ ok: true, heard: t.text, text: text || t.text, tidied: !!text, why: v.role === "admin" ? why : "" });
    }

    if (mode === "form") {
      if (!aiOn()) return fail("Filling in a form by talking isn't set up yet: it needs the Claude key (ANTHROPIC_API_KEY) in Vercel. Type the answers for now.");
      const reportId = String(f.get("reportId") || "");
      const { data: r } = await sb.from("reports").select("id, kind, week_number, trainer_id, status, booking_id").eq("id", reportId).maybeSingle();
      if (!r || (v.role === "trainer" && r.trainer_id !== v.trainerId)) return fail("Form not found.", 404);
      const { data: b } = await sb.from("bookings").select("dog_name, client_name").eq("id", r.booking_id).maybeSingle();
      let answers: Answers = {};
      try { answers = JSON.parse(String(f.get("answers") || "{}")) as Answers; } catch { /* start from empty */ }
      const t = await hear([b?.dog_name, b?.client_name]);
      if (!t.ok) return fail(t.error, 502);
      if (t.text.split(" ").length < 2) return fail("Couldn't hear anything to fill in. Try again a little closer to the phone.");
      const fill = await fillForm({ kind: r.kind as Kind, week: r.week_number, dog: b?.dog_name || "", answers, heard: t.text, today: etParts(new Date()).date });
      if (!fill) return fail(`Heard you, but couldn't work out the answers just now. Try again, or type them.${v.role === "admin" && aiLastError() ? ` (${aiErrorText(aiLastError())})` : ""}`, 502);
      await sb.from("ai_voice").insert({ user_id: v.userId, role: v.role, mode: "form", report_id: reportId, seconds, heard_chars: t.text.length, fields_set: Object.keys(fill.set).length, questions: fill.questions.length }).then(() => null, () => null);
      return NextResponse.json({ ok: true, heard: t.text, ...fill });
    }
    return fail("Not a place to speak.");
  } catch (e) { return fail((e as Error).message, 500); }
}
