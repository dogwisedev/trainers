"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";

export type VoiceResult = { heard: string; text?: string; tidied?: boolean; set?: Record<string, unknown>; filled?: string[]; questions?: string[] };
type Props = {
  mode: "chat" | "form"; chatId?: string; reportId?: string;
  getAnswers?: () => Record<string, unknown>;      // forms: the answers as they are on screen now
  onResult: (r: VoiceResult) => void;
  label?: string;                                   // shown beside the microphone (forms); chats show the icon only
  className?: string; maxSeconds?: number;
};

// The browser's own speech recognition (Chrome, Edge, Safari). Not in TypeScript's built-in types.
type SRResult = { isFinal: boolean; 0?: { transcript: string } };
type SREvent = { resultIndex: number; results: { length: number; [i: number]: SRResult } };
type SR = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
const recognizer = (): (new () => SR) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

// Which way this deployment listens: the phone's own recognition (default), or a recording sent to a transcription
// service when one is set up in Vercel. Asked once, ahead of the first tap, so the tap itself can start listening at once.
let setup: { on: boolean; stt: boolean } | null = null;
const loadSetup = async () => {
  if (setup) return setup;
  try { const r = await fetch("/api/voice"); if (r.ok) setup = (await r.json()) as { on: boolean; stt: boolean }; } catch { /* offline: decided at the tap */ }
  return setup;
};

const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const tidy = (t: string) => t.replace(/\s+/g, " ").trim();
const NOTE = { chat: "Speech to text, not a voice message: you'll see the words before anything is sent.", form: "Speech to text, not a voice message: we fill in the answers you talk about." };

/** "Speak": the person talks, the phone turns it into words, and AI tidies them: a message in the chat box, or answers in
 *  the form, always shown to the person before anything is sent. Never a voice message.
 *  Built to keep going and never lose words: listening restarts itself after a pause, repeated phrases are dropped, and if
 *  the phone stops or can't listen at all, a box opens with what was heard so far, to add to by typing or with the
 *  keyboard's own microphone. Put it inside a positioned (sticky / relative) bar: its panel opens just above that bar. */
export function VoiceButton({ mode, chatId, reportId, getAnswers, onResult, label, className, maxSeconds = 150 }: Props) {
  const [state, setState] = useState<"idle" | "listening" | "recording" | "typing" | "working">("idle");
  const [secs, setSecs] = useState(0);
  const [live, setLive] = useState("");       // the words so far, shown while listening
  const [typed, setTyped] = useState("");     // the box: what was heard, to add to or change
  const [note, setNote] = useState("");       // why the box opened
  const [err, setErr] = useState("");

  const sr = useRef<SR | null>(null), finals = useRef<string[]>([]), interim = useRef("");
  const on = useRef(false), ended = useRef(true), fatal = useRef(""), quick = useRef(0), lastStart = useRef(0);
  const rec = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null), chunks = useRef<Blob[]>([]), keep = useRef(true);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null), started = useRef(0);

  useEffect(() => { void loadSetup(); }, []);
  const stopClock = () => { if (tick.current) clearInterval(tick.current); tick.current = null; };
  const startClock = (onMax: () => void) => {
    started.current = Date.now(); setSecs(0); stopClock();
    tick.current = setInterval(() => { const s = Math.round((Date.now() - started.current) / 1000); setSecs(s); if (s >= maxSeconds) onMax(); }, 500);
  };
  const heardSoFar = () => tidy([...finals.current, interim.current].join(" "));

  // ── Send the words (or a recording) to be written up ──
  const send = async (payload: { heard?: string; audio?: Blob }) => {
    setState("working"); setErr("");
    const seconds = Math.round((Date.now() - started.current) / 1000);
    try {
      const f = new FormData();
      if (payload.heard) f.append("heard", payload.heard);
      if (payload.audio) f.append("audio", payload.audio, `speech.${/mp4/.test(payload.audio.type) ? "m4a" : /ogg/.test(payload.audio.type) ? "ogg" : "webm"}`);
      f.append("mode", mode); f.append("seconds", String(started.current ? seconds : 0));
      if (chatId) f.append("chatId", chatId);
      if (reportId) f.append("reportId", reportId);
      if (getAnswers) f.append("answers", JSON.stringify(getAnswers()));
      const r = await fetch("/api/voice", { method: "POST", body: f });
      const d = (await r.json().catch(() => null)) as ({ ok: boolean; message?: string } & VoiceResult) | null;
      if (d?.ok) { onResult(d); setTyped(""); setNote(""); setState("idle"); return; }
      // Nothing is lost: the words go back in the box with what went wrong
      if (payload.heard) { setTyped(payload.heard); setNote(d?.message || "That didn't work. Tap Write it up to try again."); setState("typing"); }
      else { setErr(d?.message || "That didn't work. Try again, or type it."); setState("idle"); }
    } catch {
      if (payload.heard) { setTyped(payload.heard); setNote("No connection just now. Tap Write it up to try again."); setState("typing"); }
      else { setErr("No connection just now. Try again, or type it."); setState("idle"); }
    }
  };
  const openBox = (why: string, text = "") => { setTyped(text); setNote(why); setState("typing"); };

  // ── The phone's own speech recognition ──
  // Phones repeat themselves: Android sends "hello", then "hello how are", then "hello how are you", each as finished, and
  // sometimes the earlier ones again. Keep the longest version of each sentence, once.
  const addFinal = (t: string) => {
    const x = tidy(t); if (!x) return;
    const all = finals.current, a = x.toLowerCase();
    if (tidy(all.join(" ")).toLowerCase().endsWith(a)) return;                        // the same words again
    if (all.slice(-3).some((f) => f.toLowerCase().startsWith(a))) return;             // a shorter, earlier version of a sentence we have
    const last = all.length - 1;
    if (last >= 0 && a.startsWith(all[last].toLowerCase())) { all[last] = x; return; } // the sentence we have, grown
    all.push(x);
  };
  /** Listening is over: Done was tapped (write it up), or it stopped by itself (the box, with what was heard). */
  const finish = (byItself: boolean) => {
    if (ended.current) return; ended.current = true; on.current = false;
    stopClock();
    if (interim.current) { addFinal(interim.current); interim.current = ""; }
    const r = sr.current; sr.current = null;
    if (r) { r.onresult = null; r.onerror = null; r.onend = null; try { r.abort(); } catch { /* already stopped */ } }
    const text = heardSoFar();
    const why = fatal.current === "blocked" ? "The microphone or dictation is blocked for this app. Allow it in your phone's settings, or use the microphone on your keyboard here."
      : fatal.current === "nomic" ? "Couldn't reach the microphone. Use the microphone on your keyboard here, or type."
      : fatal.current === "network" ? "Listening needs a connection, and it dropped. Carry on here with your keyboard." : "";
    if (byItself || why) { openBox(why || (text ? "Listening stopped. Here's what we heard: add to it, or tap Write it up." : "Couldn't hear anything. Tap the microphone on your keyboard and talk, or type."), text); return; }
    if (text.split(" ").length < 2) { openBox("Didn't catch that. Tap the microphone on your keyboard and talk, or type.", text); return; }
    void send({ heard: text });
  };
  const listen = (): boolean => {
    const Ctor = recognizer();
    if (!Ctor) return false;
    let r: SR;
    try { r = new Ctor(); } catch { return false; }
    r.lang = "en-US"; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = (e) => {
      let it = "";
      for (let i = e.resultIndex; i < e.results.length; i++) { const res = e.results[i], t = res?.[0]?.transcript || ""; if (res?.isFinal) addFinal(t); else it += ` ${t}`; }
      interim.current = tidy(it); setLive(heardSoFar());
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") fatal.current = "blocked";
      else if (e.error === "audio-capture") fatal.current = "nomic";
      else if (e.error === "network") fatal.current = "network";
      // "no-speech" and "aborted" are just pauses: listening carries on below
    };
    r.onend = () => {
      if (ended.current) return;
      if (interim.current) { addFinal(interim.current); interim.current = ""; setLive(heardSoFar()); }
      if (!on.current) { finish(false); return; }          // Done was tapped
      if (fatal.current) { finish(true); return; }
      // It stopped by itself (a pause, or the phone's time limit): start listening again, unless it won't stay on
      quick.current = Date.now() - lastStart.current < 700 ? quick.current + 1 : 0;
      if (quick.current >= 4) { finish(true); return; }
      setTimeout(() => {
        if (ended.current) return;
        if (!on.current) { finish(false); return; }
        try { lastStart.current = Date.now(); r.start(); } catch { finish(true); }
      }, 250);
    };
    finals.current = []; interim.current = ""; fatal.current = ""; quick.current = 0; ended.current = false; on.current = true;
    try { lastStart.current = Date.now(); r.start(); } catch { ended.current = true; on.current = false; return false; }
    sr.current = r; setLive(""); setState("listening");
    startClock(() => doneListening());
    return true;
  };
  const doneListening = () => {
    if (ended.current) return;
    on.current = false;
    try { sr.current?.stop(); } catch { /* finishing anyway */ }
    setTimeout(() => finish(false), 1200); // if the phone never says it has stopped
  };
  const cancelListening = () => { on.current = false; finals.current = []; interim.current = ""; ended.current = true; stopClock(); const r = sr.current; sr.current = null; if (r) { r.onresult = null; r.onerror = null; r.onend = null; try { r.abort(); } catch { /* fine */ } } setState("idle"); };

  // ── A recording, only when a transcription service is set up in Vercel ──
  const release = () => { stopClock(); stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; rec.current = null; };
  const record = async () => {
    try { stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { openBox((e as Error).name === "NotAllowedError" ? "The microphone is blocked for this app. Allow it in your phone's settings, or use the microphone on your keyboard here." : "Couldn't reach the microphone. Use the microphone on your keyboard here, or type."); return; }
    const type = TYPES.find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } });
    let r: MediaRecorder;
    try { r = new MediaRecorder(stream.current, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 }); }
    catch { try { r = new MediaRecorder(stream.current); } catch { release(); openBox("This phone can't record here. Use the microphone on your keyboard, or type."); return; } }
    chunks.current = []; keep.current = true;
    r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      const blob = new Blob(chunks.current, { type: r.mimeType || type || "audio/webm" });
      release();
      if (!keep.current) { setState("idle"); return; }
      if (blob.size < 1500) { setErr("That was too short to hear. Tap, talk, then tap Done."); setState("idle"); return; }
      void send({ audio: blob });
    };
    rec.current = r; r.start(); setState("recording");
    startClock(() => { try { r.stop(); } catch { /* stopping anyway */ } });
  };

  // Leaving the screen or locking the phone: stop listening and keep the words
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === "hidden" && on.current) { on.current = false; fatal.current = ""; try { sr.current?.stop(); } catch { /* fine */ } finish(true); } };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      ended.current = true; on.current = false; keep.current = false; stopClock();
      try { sr.current?.abort(); } catch { /* fine */ }
      try { rec.current?.stop(); } catch { /* fine */ }
      stream.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tap = () => {
    if (state === "listening") { doneListening(); return; }
    if (state === "recording") { try { rec.current?.stop(); } catch { release(); setState("idle"); } return; }
    if (state !== "idle") return;
    setErr(""); started.current = 0;
    if (setup && !setup.on) { setErr("Speaking is switched off. Type it for now."); return; }
    if (setup?.stt && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices && "getUserMedia" in navigator.mediaDevices) { void record(); return; }
    if (!listen()) openBox("This phone can't listen inside the app. Tap the microphone on your keyboard and talk, or type, then tap Write it up.");
  };
  const busy = state === "listening" || state === "recording";

  return (
    <>
      <button type="button" onClick={tap} disabled={state === "working"}
        aria-label={busy ? "Done speaking" : label || "Speak it: speech to text, not a voice message"} title="Speak it and we'll write it. Speech to text, not a voice message."
        className={className || `grid h-11 shrink-0 place-items-center rounded-full ${label ? "grid-flow-col gap-2 border border-line bg-white px-4 text-body font-semibold" : "w-11"} ${busy ? "bg-heart text-white" : "text-ink-soft hover:bg-paper"}`}>
        {busy ? <Square size={16} fill="currentColor" /> : <Mic size={19} className={state === "working" ? "animate-pulse" : ""} />}
        {label && <span>{busy ? "Done" : state === "working" ? "Writing…" : label}</span>}
      </button>
      {(state !== "idle" || err) && (
        <div role="status" aria-live="polite" className="absolute bottom-full left-0 right-0 z-20 mb-2 rounded-2xl border border-line bg-white p-3 text-body shadow-card">
          {busy && (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-bold"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-heart" aria-hidden />Listening {clock(secs)}</span>
                <span className="flex gap-2">
                  <button type="button" onClick={state === "listening" ? cancelListening : () => { keep.current = false; try { rec.current?.stop(); } catch { /* fine */ } release(); setState("idle"); }} className="btn-ghost h-10 min-h-0 px-3 text-small"><X size={15} />Cancel</button>
                  <button type="button" onClick={tap} className="btn-ink h-10 min-h-0 px-4 text-small">Done</button>
                </span>
              </div>
              {state === "listening" && <p className="mt-2 max-h-28 overflow-y-auto rounded-xl bg-paper px-3 py-2 text-body">{live || <span className="text-ink-faint">{mode === "chat" ? "Say what you want to tell them…" : "Talk through the form, in any order…"}</span>}</p>}
              <p className="mt-2 text-small text-ink-soft">{NOTE[mode]}</p>
            </>
          )}
          {state === "typing" && (
            <>
              {note && <p className="mb-2 text-small font-semibold text-warn">{note}</p>}
              <label className="block"><span className="sr-only">What you want to say</span>
                <textarea autoFocus rows={3} value={typed} onChange={(e) => setTyped(e.target.value)} className="field" placeholder="Tap the microphone on your keyboard and talk, or type here" /></label>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => { setTyped(""); setNote(""); setState("idle"); }} className="btn-ghost h-10 min-h-0 px-3 text-small">Cancel</button>
                <button type="button" disabled={tidy(typed).split(" ").length < 2} onClick={() => void send({ heard: tidy(typed) })} className="btn-ink h-10 min-h-0 flex-1 px-4 text-small">Write it up</button>
              </div>
              <p className="mt-2 text-small text-ink-soft">{NOTE[mode]}</p>
            </>
          )}
          {state === "working" && <p className="font-semibold">{mode === "chat" ? "Writing your message…" : "Filling in the form…"}</p>}
          {state === "idle" && err && <p className="flex items-start justify-between gap-3 text-heart"><span>{err}</span><button type="button" onClick={() => setErr("")} aria-label="Close" className="shrink-0 text-ink-soft"><X size={16} /></button></p>}
        </div>
      )}
    </>
  );
}
