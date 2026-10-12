// Browser-side: sends a file straight to Google Drive in pieces and carries on after a connection drop.
const CHUNK = 8 * 1024 * 1024; // multiple of 256 KiB
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

export async function uploadToDrive(file: File, url: string, onProgress: (sent: number) => void, onNote: (s: string) => void): Promise<void> {
  const total = file.size;
  let offset = 0, tries = 0;
  while (offset < total) {
    const end = Math.min(offset + CHUNK, total);
    try {
      const r = await put(url, file.slice(offset, end), offset, total, onProgress);
      if (r.status === 200 || r.status === 201) return;
      if (r.status === 308) { offset = r.range ? received(r.range) : end; tries = 0; onNote(""); continue; }
      if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw Object.assign(new Error(`Drive said ${r.status}`), { fatal: true });
      throw new Error(`Drive said ${r.status}`);
    } catch (e) {
      if ((e as { fatal?: boolean }).fatal || ++tries > 8) throw e;
      onNote(`Connection dropped. Retrying (${tries}/8)…`);
      await sleep(Math.min(30000, 1000 * 2 ** tries));
      try {
        const q = await put(url, new Blob([]), 0, total);
        if (q.status === 200 || q.status === 201) return;
        if (q.status === 308) offset = received(q.range);
      } catch { /* still offline: try again */ }
    }
  }
}
