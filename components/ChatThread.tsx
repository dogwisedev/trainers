"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Download, ExternalLink, FileText, FolderOpen, Paperclip, SendHorizontal, Video, X } from "lucide-react";
import { notifyChatAction } from "@/app/chat-actions";
import { uploadToDrive } from "@/lib/driveUpload";
import { ChatMsg, MediaRef, driveDownload, driveThumb, driveView } from "@/lib/chatTypes";

type Me = { userId: string; role: "admin" | "trainer" | "client"; name: string };
type Local = ChatMsg & { local?: boolean; failed?: boolean };
type Task = { key: number; file: File; progress: number; note: string; error: string };
const ROLE_LABEL = { admin: "Dogwise team", trainer: "Trainer", client: "Client", system: "" } as const;
const mb = (n: number) => `${(n / 1048576).toFixed(n > 1e8 ? 0 : 1)} MB`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function merge(cur: Local[], incoming: Local[], me: Me): Local[] {
  const byId = new Map(cur.map((m) => [m.id, m]));
  for (const m of incoming) {
    byId.set(m.id, m);
    if (m.sender_id === me.userId) for (const [id, x] of byId) if (x.local && !x.failed && x.body === m.body && x.kind === m.kind) byId.delete(id); // the real copy replaces my "Sending"
  }
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function MediaCard({ m }: { m: MediaRef }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white text-ink">
      {m.kind === "photo" && !broken && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={driveThumb(m.id)} alt={m.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="max-h-72 w-full object-cover" />
      )}
      <div className="flex items-center gap-2 p-2.5 text-[14px]">
        {m.kind === "video" ? <Video size={18} /> : <FileText size={18} />}
        <span className="min-w-0 flex-1 truncate font-semibold">{m.name}{m.size ? <span className="font-normal opacity-70"> ({mb(m.size)})</span> : null}</span>
        <a href={driveView(m.id)} target="_blank" rel="noopener" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper text-ink" aria-label={m.kind === "video" ? "Watch" : "Open"}><ExternalLink size={16} /></a>
        <a href={driveDownload(m.id)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper text-ink" aria-label="Download"><Download size={16} /></a>
      </div>
    </div>
  );
}

export function ChatThread(p: { chatId: string; me: Me; initial: ChatMsg[]; hasMore: boolean; open: boolean; folderUrl: string | null; demo: boolean; withBottomNav: boolean; otherLabel: string }) {
  const { me, chatId, demo } = p;
  const [msgs, setMsgs] = useState<Local[]>(p.initial);
  const [more, setMore] = useState(p.hasMore);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [folder, setFolder] = useState(p.folderUrl);
  const [tasks, setTasks] = useState<Task[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const seq = useRef(0);
  const meRef = useRef(me); meRef.current = me;

  const sb = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return !demo && url && key ? createBrowserClient(url, key) : null;
  }, [demo]);

  const markRead = useCallback(async () => {
    if (!sb) return;
    if (meRef.current.role === "admin") await sb.from("chats").update({ admin_seen_at: new Date().toISOString() }).eq("id", chatId);
    else await sb.from("chat_reads").upsert({ chat_id: chatId, user_id: meRef.current.userId, last_read_at: new Date().toISOString() }, { onConflict: "chat_id,user_id" });
  }, [sb, chatId]);

  const latest = useRef(""); latest.current = msgs.filter((m) => !m.local).reduce((t, m) => (m.created_at > t ? m.created_at : t), "");
  const fetchSince = useCallback(async () => {
    if (!sb) return;
    let q = sb.from("chat_messages").select("*").eq("chat_id", chatId).order("created_at", { ascending: true }).limit(200);
    if (latest.current) q = q.gt("created_at", latest.current);
    const { data } = await q;
    if (data?.length) { setMsgs((cur) => merge(cur, data as Local[], meRef.current)); if (document.visibilityState === "visible") markRead(); }
  }, [sb, chatId, markRead]);

  // Live updates, plus two safety nets for flaky phone signal: catch up after reconnecting or returning to the tab, and a light poll
  useEffect(() => {
    if (!sb) return;
    markRead();
    const ch = sb.channel(`chat-${chatId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `chat_id=eq.${chatId}` }, (e) => {
        setMsgs((cur) => merge(cur, [e.new as Local], meRef.current));
        if ((e.new as ChatMsg).sender_id !== meRef.current.userId && document.visibilityState === "visible") markRead();
      })
      .subscribe((status) => { if (status === "SUBSCRIBED") fetchSince(); });
    const vis = () => { if (document.visibilityState === "visible") { fetchSince(); markRead(); } };
    document.addEventListener("visibilitychange", vis);
    const poll = setInterval(() => { if (document.visibilityState === "visible") fetchSince(); }, 15000);
    return () => { sb.removeChannel(ch); document.removeEventListener("visibilitychange", vis); clearInterval(poll); };
  }, [sb, chatId, fetchSince, markRead]);

  useEffect(() => {
    const onScroll = () => { nearBottom.current = window.innerHeight + window.scrollY > document.body.scrollHeight - 220; };
    window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const last = msgs[msgs.length - 1];
    if (nearBottom.current || last?.sender_id === me.userId || last?.local) end.current?.scrollIntoView({ block: "end" });
  }, [msgs, me.userId]);

  const loadEarlier = async () => {
    if (!sb || !msgs.length) return;
    const first = msgs.find((m) => !m.local)?.created_at;
    const { data } = await sb.from("chat_messages").select("*").eq("chat_id", chatId).lt("created_at", first || new Date().toISOString()).order("created_at", { ascending: false }).limit(101);
    const rows = (data || []) as Local[];
    setMore(rows.length > 100);
    setMsgs((cur) => merge(cur, rows.slice(0, 100), me));
  };

  const post = async (local: Local) => {
    if (demo || !sb) return;
    const { data, error } = await sb.from("chat_messages").insert({ chat_id: chatId, kind: local.kind, body: local.body, media: local.media }).select("*").single();
    if (error || !data) { setMsgs((cur) => cur.map((m) => (m.id === local.id ? { ...m, failed: true } : m))); setErr(error?.message.includes("closed") ? "This chat has been closed." : "Couldn't send. Check your signal and tap the message to try again."); return; }
    setErr("");
    setMsgs((cur) => merge(cur.filter((m) => m.id !== local.id), [data as Local], me));
    markRead(); notifyChatAction(chatId);
  };
  const mk = (kind: "text" | "media", body: string | null, media: MediaRef[]): Local => ({ id: `local-${Date.now()}-${++seq.current}`, local: true, chat_id: chatId, sender_id: me.userId, sender_role: me.role, sender_name: me.name, kind, body, media, report_id: null, created_at: new Date().toISOString() });

  const send = () => {
    const body = text.trim();
    if (!body || !p.open) return;
    const local = mk("text", body, []);
    setMsgs((cur) => [...cur, local]); setText(""); post(local);
  };
  const retry = (m: Local) => { setMsgs((cur) => cur.map((x) => (x.id === m.id ? { ...x, failed: false } : x))); post(m); };

  const patch = (key: number, t: Partial<Task>) => setTasks((cur) => cur.map((x) => (x.key === key ? { ...x, ...t } : x)));
  const runUpload = async (t: Task) => {
    patch(t.key, { error: "", progress: 0, note: "" });
    try {
      const r = await fetch("/api/chat/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, name: t.file.name, type: t.file.type || "application/octet-stream", size: t.file.size }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || `Couldn't start the upload (${r.status}).`);
      if (d.folderUrl) setFolder(d.folderUrl);
      await uploadToDrive(t.file, d.uploadUrl, (sent) => patch(t.key, { progress: sent / t.file.size }), (note) => patch(t.key, { note }));
      patch(t.key, { note: "Finishing…", progress: 1 });
      const c = await fetch("/api/chat/media/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, storedName: d.storedName }) });
      const cd = await c.json().catch(() => ({}));
      if (!c.ok) throw new Error(cd.message || "Couldn't confirm the upload.");
      const local = mk("media", null, [{ id: cd.id, name: t.file.name, kind: t.file.type.startsWith("video") ? "video" : "photo", size: t.file.size }]);
      setMsgs((cur) => [...cur, local]); setTasks((cur) => cur.filter((x) => x.key !== t.key)); post(local);
    } catch (e) { patch(t.key, { error: (e as Error).message, note: "" }); }
  };
  const attach = (files: FileList | null) => {
    if (!files || !p.open) return;
    const added = [...files].map((file) => ({ key: ++seq.current, file, progress: 0, note: "", error: "" }));
    setTasks((cur) => [...cur, ...added]);
    added.reduce((chain, t) => chain.then(() => runUpload(t)), Promise.resolve()); // one at a time: kind to a phone connection
  };

  let lastDay = "";
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  return (
    <div className="flex min-h-[62dvh] flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[13px] text-ink-faint">Chat with {p.otherLabel}</p>
        {folder
          ? <a href={folder} target="_blank" rel="noopener" className="btn-ghost h-9 min-h-0 px-3 text-[13px]"><FolderOpen size={15} />Look at media</a>
          : <span className="text-[12px] text-ink-faint">Photos and videos will appear here</span>}
      </div>
      <div className="flex-1 space-y-2">
        {more && <div className="text-center"><button type="button" onClick={loadEarlier} className="text-[13px] font-semibold underline">Load earlier messages</button></div>}
        {msgs.length === 0 && <p className="py-12 text-center text-[14px] text-ink-faint">No messages yet. Say hello.</p>}
        {msgs.map((m) => {
          const d = day(m.created_at), sep = d !== lastDay; lastDay = d;
          const mine = m.sender_id === me.userId && m.sender_role !== "system";
          return (
            <div key={m.id}>
              {sep && <p className="my-3 text-center text-[12px] font-semibold text-ink-faint">{d}</p>}
              {m.sender_role === "system" && m.kind === "system" ? (
                <p className="py-1 text-center text-[13px] text-ink-faint">{m.body}</p>
              ) : m.kind === "report" ? (
                <div className="mx-auto max-w-[88%] rounded-[18px] border border-line bg-white p-3.5">
                  <p className="text-[12px] font-bold uppercase tracking-wide text-ink-faint">Report</p>
                  <p className="mt-0.5 font-bold">{m.body}</p>
                  {m.media[0] ? <div className="mt-2"><MediaCard m={m.media[0]} /></div> : <p className="mt-1 text-[13px] text-ink-soft">Sent by email.</p>}
                </div>
              ) : (
                <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[84%] rounded-[20px] px-3.5 py-2.5 text-[15px] leading-snug ${mine ? "rounded-br-md bg-ink text-white" : "rounded-bl-md border border-line bg-white"} ${m.failed ? "opacity-70" : ""}`}>
                    {!mine && <p className="mb-0.5 text-[12px] font-semibold text-fern">{m.sender_name}{ROLE_LABEL[m.sender_role] && m.sender_role !== "admin" ? <span className="font-normal text-ink-faint"> · {ROLE_LABEL[m.sender_role]}</span> : null}</p>}
                    {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                    {m.media.length > 0 && <div className={`${m.body ? "mt-2" : ""} space-y-2 ${mine ? "text-ink" : ""}`}>{m.media.map((x) => <MediaCard key={x.id} m={x} />)}</div>}
                    <p className={`mt-1 text-[11px] ${mine ? "text-white/60" : "text-ink-faint"}`}>
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

      {err && <p role="alert" className="mt-3 text-[13px] text-heart">{err}</p>}
      {tasks.length > 0 && (
        <ul className="mt-3 space-y-2">
          {tasks.map((t) => (
            <li key={t.key} className="rounded-2xl border border-line bg-white p-3 text-[14px]" aria-live="polite">
              <div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate font-semibold">{t.file.name} <span className="font-normal text-ink-soft">({mb(t.file.size)})</span></span>
                {t.error && <button type="button" aria-label="Cancel" onClick={() => setTasks((c) => c.filter((x) => x.key !== t.key))}><X size={16} /></button>}</div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-paper"><div className={`h-full rounded-full ${t.error ? "bg-heart" : "bg-fern"}`} style={{ width: `${t.progress * 100}%` }} /></div>
              {t.note && <p className="mt-1 text-[13px] text-[#8A5A00]">{t.note}</p>}
              {t.error && <p className="mt-1 text-[13px] text-heart">{t.error} <button type="button" className="font-semibold underline" onClick={() => runUpload(t)}>Try again</button></p>}
            </li>
          ))}
        </ul>
      )}

      {p.open ? (
        <div className={`sticky z-10 mt-4 flex items-end gap-1.5 rounded-[22px] border border-line bg-white p-2 ${p.withBottomNav ? "bottom-[calc(76px+env(safe-area-inset-bottom))] md:bottom-4" : "bottom-3"}`}>
          <label className={`grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft hover:bg-paper ${demo ? "opacity-40" : ""}`} aria-label="Add photo or video">
            <Paperclip size={20} />
            <input type="file" accept="image/*,video/*" multiple className="sr-only" disabled={demo} onChange={(e) => { attach(e.target.files); e.target.value = ""; }} />
          </label>
          <label className="sr-only" htmlFor="chat-msg">Message</label>
          <textarea id="chat-msg" rows={1} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !coarse) { e.preventDefault(); send(); } }}
            placeholder={`Message ${p.otherLabel}`} className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-1.5 py-2.5 text-[15px] focus:outline-none" />
          <button type="button" onClick={send} disabled={!text.trim()} className="btn-ink h-11 w-11 shrink-0 rounded-full p-0" aria-label="Send"><SendHorizontal size={18} /></button>
        </div>
      ) : <p className="mt-4 rounded-2xl bg-paper p-4 text-center text-[14px] text-ink-soft">This chat is closed. Everything was sent to the client, and the client can start a fresh chat any time.</p>}
    </div>
  );
}
