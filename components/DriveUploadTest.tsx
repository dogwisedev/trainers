"use client";
import { useRef, useState } from "react";

const CHUNK = 8 * 1024 * 1024; // must be a multiple of 256 KiB
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mb = (n: number) => `${(n / 1048576).toFixed(n > 1e8 ? 0 : 1)} MB`;

type Reply = { status: number; range: string | null; body: string };
function put(url: string, blob: Blob, start: number, total: number, onProgress?: (sent: number) => void): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Range", blob.size ? `bytes ${start}-${start + blob.size - 1}/${total}` : `bytes */${total}`);
    if (onProgress) xhr.upload.onprogress = (e) => onProgress(start + e.loaded);
    xhr.onload = () => resolve({ status: xhr.status, range: xhr.getResponseHeader("Range"), body: xhr.responseText });
    xhr.onerror = () => reject(new Error("network"));
    xhr.ontimeout = () => reject(new Error("timeout"));
    xhr.send(blob.size ? blob : null);
  });
}
const received = (range: string | null) => (range ? parseInt(range.split("-")[1], 10) + 1 : 0);

/** Sends a file to Drive in pieces. If the connection drops it asks Drive how much arrived and carries on. */
async function upload(file: File, url: string, onProgress: (sent: number) => void, onNote: (s: string) => void): Promise<{ id?: string }> {
  const total = file.size;
  let offset = 0, tries = 0;
  const finish = (body: string) => { try { return JSON.parse(body); } catch { return {}; } };
  while (offset < total) {
    const end = Math.min(offset + CHUNK, total);
    try {
      const r = await put(url, file.slice(offset, end), offset, total, onProgress);
      if (r.status === 200 || r.status === 201) return finish(r.body);
      if (r.status === 308) { offset = r.range ? received(r.range) : end; tries = 0; onNote(""); continue; }
      if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw Object.assign(new Error(`Drive said ${r.status}`), { fatal: true });
      throw new Error(`Drive said ${r.status}`);
    } catch (e) {
      if ((e as { fatal?: boolean }).fatal || ++tries > 8) throw e;
      onNote(`Connection dropped. Retrying (${tries}/8)…`);
      await sleep(Math.min(30000, 1000 * 2 ** tries));
      try { // ask Drive how much it already has
        const q = await put(url, new Blob([]), 0, total);
        if (q.status === 200 || q.status === 201) return finish(q.body);
        if (q.status === 308) offset = received(q.range);
      } catch { /* still offline: loop and try again */ }
    }
  }
  return {};
}

export function DriveUploadTest() {
  const [check, setCheck] = useState<{ ok?: boolean; name?: string; hints?: string[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [sent, setSent] = useState(0);
  const [size, setSize] = useState(0);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [fileId, setFileId] = useState<string | undefined>();
  const started = useRef(0);

  const runCheck = async () => {
    setChecking(true);
    try { setCheck(await (await fetch("/api/drive/status")).json()); } catch { setCheck({ ok: false, hints: ["Couldn't reach the app."] }); }
    setChecking(false);
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setState("uploading"); setMsg(""); setSent(0); setSize(file.size); setNote(""); setFileId(undefined); started.current = Date.now();
    try {
      const r = await fetch("/api/drive/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, type: file.type || "application/octet-stream", size: file.size }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || `Couldn't start the upload (${r.status}).`);
      const out = await upload(file, d.uploadUrl, setSent, setNote);
      setFileId(out.id); setState("done");
      setMsg(`${mb(file.size)} in ${Math.max(1, Math.round((Date.now() - started.current) / 1000))} seconds.`);
    } catch (e) {
      setState("error");
      setMsg(`${(e as Error).message}. Nothing is lost: pick the same file to try again.`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <h2 className="text-[17px] font-bold">1. Is Drive connected?</h2>
        <button className="btn-ghost mt-3" onClick={runCheck} disabled={checking}>{checking ? "Checking…" : "Check connection"}</button>
        {check && (
          <div className={`mt-3 rounded-xl px-3 py-2 text-[14px] ${check.ok ? "bg-mint-wash text-fern" : "bg-heart-wash text-heart"}`}>
            {check.ok ? `Connected to the folder "${check.name}" in a Shared Drive.` : (check.hints || []).map((h, i) => <p key={i}>{h}</p>)}
          </div>
        )}
      </div>

      <div className="panel p-4">
        <h2 className="text-[17px] font-bold">2. Upload a photo or video</h2>
        <p className="mt-1 text-[14px] text-ink-soft">Try a big video on your phone, on mobile data. Switch to airplane mode for a few seconds mid-upload to test that it carries on.</p>
        <label className="btn-ink mt-3 cursor-pointer">
          Choose a file
          <input type="file" accept="video/*,image/*,application/pdf" className="sr-only" disabled={state === "uploading"} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {state !== "idle" && (
          <div className="mt-4" aria-live="polite">
            <div className="h-3 overflow-hidden rounded-full bg-paper"><div className={`h-full rounded-full transition-all ${state === "error" ? "bg-heart" : "bg-fern"}`} style={{ width: `${state === "done" ? 100 : Math.min(100, (sent / Math.max(1, size)) * 100)}%` }} /></div>
            <p className="mt-2 text-[14px]">{state === "uploading" ? `${mb(sent)} of ${mb(size)}` : state === "done" ? "Uploaded ✓" : "Upload stopped"}</p>
            {note && <p className="text-[13px] text-[#8A5A00]">{note}</p>}
            {msg && <p className={`text-[14px] ${state === "error" ? "text-heart" : "text-ink-soft"}`}>{msg}</p>}
            {state === "done" && (fileId
              ? <a className="btn-mint mt-3" target="_blank" rel="noopener" href={`https://drive.google.com/file/d/${fileId}/view`}>Open in Drive</a>
              : <p className="mt-2 text-[13px] text-ink-soft">Look in the &ldquo;Upload tests&rdquo; folder in the Shared Drive.</p>)}
          </div>
        )}
      </div>
    </div>
  );
}
