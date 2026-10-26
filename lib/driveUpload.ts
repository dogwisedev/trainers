// Browser-side: sends a file straight to Google Drive in pieces and carries on after a connection drop.
// Built for weak phone signal: small pieces (a dropped piece costs little), waits for the signal to come back
// instead of giving up, and resumes from what Drive already has.
const BIG = 4 * 1024 * 1024, SMALL = 1024 * 1024; // multiples of 256 KiB, as Drive requires
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Reply = { status: number; range: string | null; body: string };
function put(url: string, blob: Blob, start: number, total: number, onProgress?: (sent: number) => void): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.timeout = 120000; // a stuck piece is retried rather than waited on forever
    xhr.setRequestHeader("Content-Range", blob.size ? `bytes ${start}-${start + blob.size - 1}/${total}` : `bytes */${total}`);
    if (onProgress) xhr.upload.onprogress = (e) => onProgress(start + e.loaded);
    xhr.onload = () => resolve({ status: xhr.status, range: xhr.getResponseHeader("Range"), body: xhr.responseText });
    xhr.onerror = () => reject(new Error("network"));
    xhr.ontimeout = () => reject(new Error("timeout"));
    xhr.send(blob.size ? blob : null);
  });
}
const received = (range: string | null) => (range ? parseInt(range.split("-")[1], 10) + 1 : 0);
/** Drive answers the last piece with the new file (we asked for its id when the upload was started). */
const idOf = (body: string): string | null => { try { return (JSON.parse(body) as { id?: string }).id || null; } catch { return null; } };

/** Waits until the phone is back online (or up to `max` ms). */
function backOnline(max: number): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { window.removeEventListener("online", done); clearTimeout(t); resolve(); };
    const t = setTimeout(done, max);
    window.addEventListener("online", done);
  });
}

export type UploadNote = (s: string) => void;
/** Uploads the file and returns its Drive id (or null if Drive didn't say; the caller then looks it up). */
export async function uploadToDrive(file: Blob, url: string, onProgress: (sent: number) => void, onNote: UploadNote, resume = false): Promise<string | null> {
  const total = file.size;
  let offset = 0, tries = 0, chunk = BIG;
  if (resume) {
    // Carry on an upload that stopped: ask Drive how much it already has
    const q = await put(url, new Blob([]), 0, total).catch(() => null);
    if (q && (q.status === 200 || q.status === 201)) return idOf(q.body);
    if (q && (q.status === 404 || q.status === 410)) throw Object.assign(new Error("expired"), { fatal: true, expired: true });
    if (q && q.status === 308) { offset = received(q.range); chunk = SMALL; onProgress(offset); }
  }
  while (offset < total) {
    const end = Math.min(offset + chunk, total);
    try {
      const r = await put(url, file.slice(offset, end), offset, total, onProgress);
      if (r.status === 200 || r.status === 201) return idOf(r.body);
      if (r.status === 308) { offset = r.range ? received(r.range) : end; tries = 0; onNote(""); continue; }
      if (r.status === 404 || r.status === 410) throw Object.assign(new Error("expired"), { fatal: true, expired: true });
      if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw Object.assign(new Error(`Google Drive refused the file (${r.status}).`), { fatal: true });
      throw new Error(`Drive said ${r.status}`);
    } catch (e) {
      if ((e as { fatal?: boolean }).fatal) throw e;
      chunk = SMALL; // weak signal: smaller pieces from now on
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        onNote("No signal. Waiting for it to come back…");
        await backOnline(10 * 60000); // offline time doesn't count as a failed try
      } else {
        if (++tries > 10) throw new Error("The connection kept dropping. Tap Try again when you have better signal: it carries on from where it stopped.");
        onNote(`Connection dropped. Retrying (${tries}/10)…`);
        await sleep(Math.min(30000, 1000 * 2 ** tries));
      }
      try {
        const q = await put(url, new Blob([]), 0, total);
        if (q.status === 200 || q.status === 201) return idOf(q.body);
        if (q.status === 308) offset = received(q.range);
        if (q.status === 404 || q.status === 410) throw Object.assign(new Error("expired"), { fatal: true, expired: true });
      } catch (e2) { if ((e2 as { fatal?: boolean }).fatal) throw e2; /* still offline: try again */ }
    }
  }
  return null;
}
