"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { FolderOpen, Paperclip, SendHorizontal, X } from "lucide-react";
import { notifyChatAction } from "@/app/chat-actions";
import { uploadToDrive } from "@/lib/driveUpload";
import { allowedType, deviceLabel, fileType, mediaKind, newId, shrinkPhoto } from "@/lib/uploadPrep";
import { ChatMsg, MediaRef } from "@/lib/chatTypes";
import { MediaCard, MediaViewer } from "@/components/MediaViewer";

// One chat (client, trainer and the Dogwise team). Built to never lose or double a message on weak phone signal:
//  • every message gets its id on the phone, so a retry after a lost reply can't post it twice
//  • unsent messages and the half-typed draft are kept on the phone, and sent when the app is opened again
//  • live updates, plus a catch-up (with a few seconds' overlap) whenever the app comes back to the screen
//  • uploads go straight to Google Drive in small pieces, wait out lost signal, and carry on from where they stopped

type Me = { userId: string; role: "admin" | "trainer" | "client"; name: string };
type Local = ChatMsg & { local?: boolean; failed?: boolean };
type Stage = "prepare" | "start" | "upload" | "confirm";
type Task = { key: number; file: File; progress: number; note: string; error: string; stage: Stage; blob?: Blob; name?: string; type?: string; session?: { uploadUrl: string; storedName: string }; restarted?: boolean };
type Outbox = Pick<ChatMsg, "id" | "kind" | "body" | "media" | "created_at">[];

const ROLE_LABEL = { admin: "Dogwise team", trainer: "Trainer", client: "Client", system: "" } as const;
const mb = (n: number) => `${(n / 1048576).toFixed(n > 1e8 ? 0 : 1)} MB`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const OVERLAP_MS = 15000; // catch-up re-reads the last 15 s, so a message that landed slightly out of order is never skipped

const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { if (v === null || (Array.isArray(v) && !v.length) || v === "") localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
};

function merge(cur: Local[], incoming: Local[]): Local[] {
  const byId = new Map(cur.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m); // the saved copy replaces "Sending…" (same id)
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Tells the activity log an upload went wrong (or Drive sharing is off), so problems can be checked. Fire and forget. */
function reportUpload(chatId: string, t: { name: string; type: string; size: number }, stage: string, error: string, warning = false) {
  try {
    fetch("/api/log/upload", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, ...t, stage, error, warning, device: deviceLabel(), online: navigator.onLine }) }).catch(() => {});
  } catch { /* never in the way */ }
}

export function ChatThread(p: { chatId: string; me: Me; initial: ChatMsg[]; hasMore: boolean; open: boolean; folderUrl: string | null; demo: boolean; withBottomNav: boolean; otherLabel: string }) {
  const { me, chatId, demo } = p;
  const draftKey = `dw-draft:${chatId}`, outKey = `dw-outbox:${chatId}`;
  const [msgs, setMsgs] = useState<Local[]>(p.initial);
  const [more, setMore] = useState(p.hasMore);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [folder, setFolder] = useState(p.folderUrl);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [viewing, setViewing] = useState<MediaRef | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const previews = useRef(new Map<string, string>()); // Drive id → this phone's copy of a photo just sent (shown until Drive's is ready)
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const seq = useRef(0);
  const meRef = useRef(me); meRef.current = me;
  const closeViewer = useCallback(() => setViewing(null), []);

  const sb = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return !demo && url && key ? createBrowserClient(url, key) : null;
  }, [demo]);

  // ── Outbox: messages not yet confirmed as saved survive closing the app ──
  const outbox = {
    add(m: Local) { store.set(outKey, [...store.get<Outbox>(outKey, []).filter((x) => x.id !== m.id), { id: m.id, kind: m.kind, body: m.body, media: m.media, created_at: m.created_at }]); },
    drop(id: string) { store.set(outKey, store.get<Outbox>(outKey, []).filter((x) => x.id !== id)); }
  };

  const markRead = useCallback(async () => {
    if (!sb) return;
    if (meRef.current.role === "admin") await sb.from("chats").update({ admin_seen_at: new Date().toISOString() }).eq("id", chatId);
    else await sb.from("chat_reads").upsert({ chat_id: chatId, user_id: meRef.current.userId, last_read_at: new Date().toISOString() }, { onConflict: "chat_id,user_id" });
  }, [sb, chatId]);

  const latest = useRef(""); latest.current = msgs.filter((m) => !m.local).reduce((t, m) => (m.created_at > t ? m.created_at : t), "");
  const fetchSince = useCallback(async () => {
    if (!sb) return;
    let q = sb.from("chat_messages").select("*").eq("chat_id", chatId).order("created_at", { ascending: true }).limit(200);
    if (latest.current) q = q.gt("created_at", new Date(new Date(latest.current).getTime() - OVERLAP_MS).toISOString());
    const { data } = await q;
    if (data?.length) {
      setMsgs((cur) => merge(cur, data as Local[]));
      for (const m of data as Local[]) outbox.drop(m.id); // saved after all
      if (document.visibilityState === "visible") markRead();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb, chatId, markRead]);

  // ── Sending ──
  const post = useCallback(async (local: Local) => {
    if (demo || !sb) return;
    let { data, error } = await sb.from("chat_messages").insert({ id: local.id, chat_id: chatId, kind: local.kind, body: local.body, media: local.media }).select("*").single();
    if (error?.code === "23505") ({ data, error } = await sb.from("chat_messages").select("*").eq("id", local.id).single()); // already saved; only the reply was lost
    if (error || !data) {
      setMsgs((cur) => cur.map((m) => (m.id === local.id ? { ...m, failed: true } : m)));
      setErr(error?.message.includes("closed") ? "This chat has been closed." : navigator.onLine ? "Couldn't send. Tap the message to try again." : "No signal. Your message is saved and will send when you're back online.");
      if (error?.message.includes("closed")) outbox.drop(local.id);
      return;
    }
    outbox.drop(local.id);
    setErr("");
    setMsgs((cur) => merge(cur, [data as Local]));
    markRead(); notifyChatAction(chatId, local.id); // the server also notifies on its own; whichever is first sends it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb, chatId, demo, markRead]);

  const mk = (kind: "text" | "media", body: string | null, media: MediaRef[]): Local => ({ id: newId(), local: true, chat_id: chatId, sender_id: me.userId, sender_role: me.role, sender_name: me.name, kind, body, media, report_id: null, created_at: new Date().toISOString() });
  const queue = (m: Local) => { outbox.add(m); setMsgs((cur) => [...cur, m]); post(m); };
  const retry = (m: Local) => { setMsgs((cur) => cur.map((x) => (x.id === m.id ? { ...x, failed: false } : x))); post(m); };
  const msgsRef = useRef(msgs); msgsRef.current = msgs;
  const retryRef = useRef(retry); retryRef.current = retry;

  // Restore the draft and anything that didn't send last time (then send it)
  useEffect(() => {
    setText(store.get<string>(draftKey, ""));
    const pending = store.get<Outbox>(outKey, []);
    if (pending.length && sb && p.open) {
      const locals = pending.map((x) => ({ ...x, local: true, chat_id: chatId, sender_id: me.userId, sender_role: me.role, sender_name: me.name, report_id: null } as Local));
      setMsgs((cur) => merge(cur, locals.filter((l) => !cur.some((c) => c.id === l.id && !c.local))));
      locals.forEach((l) => post(l));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, sb]);
  useEffect(() => { store.set(draftKey, text); }, [draftKey, text]);

  // Live updates, plus safety nets for flaky phone signal: catch up after reconnecting or returning to the app, and a light poll
  useEffect(() => {
    if (!sb) return;
    markRead();
    const ch = sb.channel(`chat-${chatId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `chat_id=eq.${chatId}` }, (e) => {
        setMsgs((cur) => merge(cur, [e.new as Local]));
        outbox.drop((e.new as ChatMsg).id);
        if ((e.new as ChatMsg).sender_id !== meRef.current.userId && document.visibilityState === "visible") markRead();
      })
      .subscribe((status) => { if (status === "SUBSCRIBED") fetchSince(); });
    const resend = () => msgsRef.current.filter((m) => m.local && m.failed).forEach((m) => retryRef.current(m));
    const vis = () => { if (document.visibilityState === "visible") { fetchSince(); markRead(); resend(); } };
    const online = () => { fetchSince(); resend(); };
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("online", online);
    const poll = setInterval(() => { if (document.visibilityState === "visible") fetchSince(); }, 15000);
    return () => { sb.removeChannel(ch); document.removeEventListener("visibilitychange", vis); window.removeEventListener("online", online); clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb, chatId, fetchSince, markRead]);

  // Warn before closing the page while something is still sending
  const busy = tasks.some((t) => !t.error) || msgs.some((m) => m.local && !m.failed);
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  useEffect(() => {
    const onScroll = () => { nearBottom.current = window.innerHeight + window.scrollY > document.body.scrollHeight - 220; };
    window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const last = msgs[msgs.length - 1];
    if (nearBottom.current || last?.sender_id === me.userId || last?.local) end.current?.scrollIntoView({ block: "end" });
  }, [msgs, me.userId]);
  // The message box grows with what's typed (up to a limit), so long messages are easy to check before sending
  useEffect(() => { const el = box.current; if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 180)}px`; } }, [text]);

  const loadEarlier = async () => {
    if (!sb || !msgs.length) return;
    const first = msgs.find((m) => !m.local)?.created_at;
    const { data } = await sb.from("chat_messages").select("*").eq("chat_id", chatId).lt("created_at", first || new Date().toISOString()).order("created_at", { ascending: false }).limit(101);
    const rows = (data || []) as Local[];
    setMore(rows.length > 100);
    setMsgs((cur) => merge(cur, rows.slice(0, 100)));
  };

  const send = () => {
    const body = text.trim();
    if (!body || !p.open) return;
    setText(""); store.set(draftKey, "");
    queue(mk("text", body, []));
    box.current?.focus();
  };

  // ── Uploads ──
  const patch = (key: number, t: Partial<Task>) => setTasks((cur) => cur.map((x) => (x.key === key ? { ...x, ...t } : x)));
  const runUpload = async (t0: Task) => {
    let t = { ...t0 };
    const info = () => ({ name: t.name || t.file.name, type: t.type || fileType(t.file), size: (t.blob || t.file).size });
    const fail = (stage: Stage, message: string, logged = message) => { patch(t.key, { error: message, note: "", stage }); reportUpload(chatId, info(), stage, logged); };
    patch(t.key, { error: "", note: "" });
    try {
      // 1. Prepare: work out the type, shrink big photos
      if (!t.blob) {
        t.stage = "prepare";
        const type = fileType(t.file);
        if (!allowedType(type)) return fail("prepare", "Only photos, videos and PDFs can be sent here.", `not allowed: ${type || "no type"}`);
        if (type.startsWith("image/")) { patch(t.key, { note: "Getting the photo ready…" }); const s = await shrinkPhoto(t.file); t = { ...t, blob: s.blob, name: s.name, type: s.type }; }
        else t = { ...t, blob: t.file, name: t.file.name, type };
        patch(t.key, { blob: t.blob, name: t.name, type: t.type, note: "" });
      }
      // 2. Ask the server for an upload link into this chat's Drive folder (reused when carrying on after a drop)
      const resume = !!t.session;
      if (!t.session) {
        t.stage = "start";
        const r = await fetch("/api/chat/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, name: t.name, type: t.type, size: t.blob!.size }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return fail("start", d.message || `Couldn't start the upload (${r.status}). Check your signal and try again.`, `${r.status} ${d.message || ""}`);
        if (d.folderUrl) setFolder(d.folderUrl);
        if (d.warning) { reportUpload(chatId, info(), "start", d.warning, true); if (meRef.current.role === "admin") setAdminNote(d.warning); }
        t.session = { uploadUrl: d.uploadUrl, storedName: d.storedName };
        patch(t.key, { session: t.session });
      }
      // 3. Send it to Drive
      t.stage = "upload";
      let id: string | null;
      try { id = await uploadToDrive(t.blob!, t.session.uploadUrl, (sent) => patch(t.key, { progress: sent / t.blob!.size }), (note) => patch(t.key, { note }), resume); }
      catch (e) {
        if (!(e as { expired?: boolean }).expired || t.restarted) throw (e as Error).message === "expired" ? new Error("Google Drive closed the upload. Tap Try again to send it fresh.") : e;
        // The upload link ran out (Drive keeps them about a week): start a fresh one, once
        patch(t.key, { session: undefined, restarted: true });
        return runUpload({ ...t, session: undefined, restarted: true });
      }
      // 4. Drive normally tells us the file's id; if it didn't, look it up
      t.stage = "confirm";
      patch(t.key, { note: "Finishing…", progress: 1 });
      for (let i = 0; !id && i < 3; i++) {
        const c = await fetch("/api/chat/media/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, storedName: t.session.storedName }) });
        const cd = await c.json().catch(() => ({}));
        if (c.ok && cd.id) id = cd.id; else await new Promise((r) => setTimeout(r, 2500));
      }
      if (!id) return fail("confirm", "The file reached Google Drive but the app couldn't find it yet. Tap Try again (it won't upload twice).", "file id not found after upload");
      // 5. Post it in the chat
      const kind = mediaKind(t.type!);
      if (kind === "photo") previews.current.set(id, URL.createObjectURL(t.blob!));
      setTasks((cur) => cur.filter((x) => x.key !== t.key));
      queue(mk("media", null, [{ id, name: t.name!, kind, size: t.blob!.size }]));
    } catch (e) {
      const msg = (e as Error).message;
      fail(t.stage, navigator.onLine ? msg : "No signal. Tap Try again when you're back online: it carries on from where it stopped.", msg);
    }
  };
  const attach = (files: FileList | null) => {
    if (!files || !p.open) return;
    const added: Task[] = [...files].map((file) => ({ key: ++seq.current, file, progress: 0, note: "", error: "", stage: "prepare" }));
    setTasks((cur) => [...cur, ...added]);
    added.reduce((chain, t) => chain.then(() => runUpload(t)), Promise.resolve()); // one at a time: kind to a phone connection
  };

  let lastDay = "";
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  return (
    <div className="flex min-h-[62dvh] flex-col">
      <div className="mb-3 flex min-h-[36px] items-center justify-between gap-2">
        <p className="min-w-0 truncate rounded-full bg-white/70 px-3 py-1.5 text-small font-semibold text-ink-soft">With {p.otherLabel}</p>
        {folder && <a href={folder} target="_blank" rel="noopener" className="btn-ghost h-9 min-h-0 shrink-0 px-3 text-small"><FolderOpen size={15} />All media</a>}
      </div>
      {adminNote && <p role="alert" className="mb-3 rounded-xl bg-biscuit-wash px-3 py-2 text-small text-warn">{adminNote}</p>}
      <div className="flex-1 space-y-2">
        {more && <div className="text-center"><button type="button" onClick={loadEarlier} className="text-small font-semibold underline">Load earlier messages</button></div>}
        {msgs.length === 0 && <p className="py-12 text-center text-body text-ink-faint">No messages yet. Say hello.</p>}
        {msgs.map((m) => {
          const d = day(m.created_at), sep = d !== lastDay; lastDay = d;
          const mine = m.sender_id === me.userId && m.sender_role !== "system";
          return (
            <div key={m.id}>
              {sep && <p className="my-3 text-center text-caption font-semibold text-ink-faint">{d}</p>}
              {m.sender_role === "system" && m.kind === "system" && m.body?.startsWith("👋 Welcome to") ? (
                <div className="mx-auto my-2 max-w-[92%] whitespace-pre-wrap rounded-[18px] border border-lav/30 bg-white p-4 text-body text-ink shadow-card">{m.body}</div>
              ) : m.sender_role === "system" && m.kind === "system" ? (
                <p className="py-1 text-center text-small text-ink-faint">{m.body}</p>
              ) : m.kind === "report" ? (
                <div className="mx-auto max-w-[88%] rounded-[18px] border border-line bg-white p-3.5">
                  <p className="text-caption font-bold text-ink-faint">Report</p>
                  <p className="mt-0.5 font-bold">{m.body}</p>
                  {m.media[0] ? <div className="mt-2"><MediaCard m={m.media[0]} onOpen={setViewing} /></div> : <p className="mt-1 text-small text-ink-soft">Sent by email.</p>}
                </div>
              ) : (
                <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[84%] rounded-[20px] px-3.5 py-2.5 text-body ${mine ? "rounded-br-md bg-ink text-white" : "rounded-bl-md border border-line bg-white"} ${m.failed ? "opacity-80" : ""}`}>
                    {!mine && <p className="mb-0.5 text-caption font-semibold text-fern">{m.sender_name}{ROLE_LABEL[m.sender_role] && m.sender_role !== "admin" ? <span className="font-normal text-ink-faint"> · {ROLE_LABEL[m.sender_role]}</span> : null}</p>}
                    {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                    {m.media.length > 0 && <div className={`${m.body ? "mt-2" : ""} space-y-2`}>{m.media.map((x) => <MediaCard key={x.id} m={x} local={previews.current.get(x.id)} onOpen={setViewing} dark={mine} />)}</div>}
                    <p className={`mt-1 text-micro ${mine ? "text-white/75" : "text-ink-faint"}`}>
                      {m.failed ? <button type="button" onClick={() => retry(m)} className="font-semibold underline">Not sent. Tap to retry</button> : m.local ? (demo ? "Demo: not saved" : "Sending…") : clock(m.created_at)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div ref={end} />
      </div>

      {err && <p role="alert" className="mt-3 text-small text-heart">{err}</p>}
      {tasks.length > 0 && (
        <ul className="mt-3 space-y-2">
          {tasks.map((t) => (
            <li key={t.key} className="rounded-2xl border border-line bg-white p-3 text-body" aria-live="polite">
              <div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate font-semibold">{t.name || t.file.name} <span className="font-normal text-ink-soft">({mb((t.blob || t.file).size)})</span></span>
                {t.error && <button type="button" aria-label="Remove" className="grid h-8 w-8 place-items-center rounded-full hover:bg-paper" onClick={() => setTasks((c) => c.filter((x) => x.key !== t.key))}><X size={16} /></button>}</div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-paper"><div className={`h-full rounded-full transition-[width] ${t.error ? "bg-heart" : "bg-fern"}`} style={{ width: `${Math.max(2, t.progress * 100)}%` }} /></div>
              {!t.error && <p className="mt-1 text-small text-ink-soft">{t.note || `${Math.round(t.progress * 100)}% · keep this screen open until it's sent`}</p>}
              {t.error && <p className="mt-1 text-small text-heart">{t.error} <button type="button" className="font-semibold underline" onClick={() => runUpload(t)}>Try again</button></p>}
            </li>
          ))}
        </ul>
      )}

      {p.open ? (
        <div data-tour="composer" className={`sticky z-10 mt-4 flex items-end gap-1.5 rounded-[22px] border border-line bg-white p-2 shadow-card ${p.withBottomNav ? "bottom-[calc(76px+env(safe-area-inset-bottom))] md:bottom-4" : "bottom-3"}`}>
          <label data-tour="attach" className={`grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft hover:bg-paper ${demo ? "opacity-40" : ""}`} aria-label="Add photo, video or PDF">
            <Paperclip size={20} />
            <input type="file" accept="image/*,video/*,application/pdf,.heic,.heif,.mov,.pdf" multiple className="sr-only" disabled={demo} onChange={(e) => { attach(e.target.files); e.target.value = ""; }} />
          </label>
          <label className="sr-only" htmlFor="chat-msg">Message</label>
          <textarea ref={box} id="chat-msg" rows={1} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !coarse) { e.preventDefault(); send(); } }}
            placeholder="Write a message" className="max-h-[180px] min-h-[44px] flex-1 resize-none bg-transparent px-1.5 py-2.5 text-input focus:outline-none md:text-body" />
          <button type="button" onClick={send} disabled={!text.trim()} className="btn-ink h-11 w-11 shrink-0 rounded-full p-0" aria-label="Send"><SendHorizontal size={18} /></button>
        </div>
      ) : <p className="mt-4 rounded-2xl bg-paper p-4 text-center text-body text-ink-soft">This chat is closed. Everything was sent to the client, and the client can start a fresh chat any time.</p>}

      <MediaViewer m={viewing} onClose={closeViewer} />
    </div>
  );
}
