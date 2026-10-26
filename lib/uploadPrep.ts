// Browser-side helpers for chat uploads: work out the file type when the phone doesn't say,
// and shrink very large photos so they send quickly on weak signal (videos and PDFs are sent as they are).

const BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif",
  mp4: "video/mp4", m4v: "video/x-m4v", mov: "video/quicktime", webm: "video/webm", "3gp": "video/3gpp", avi: "video/x-msvideo",
  pdf: "application/pdf"
};

/** The file's type, from the browser or (when the phone leaves it blank) from its name. */
export function fileType(f: File): string {
  if (f.type) return f.type;
  const ext = (f.name.split(".").pop() || "").toLowerCase();
  return BY_EXT[ext] || "application/octet-stream";
}
export const allowedType = (t: string) => /^(image|video)\//.test(t) || t === "application/pdf";
export const mediaKind = (t: string): "photo" | "video" | "file" => (t.startsWith("video/") ? "video" : t.startsWith("image/") ? "photo" : "file");

const SHRINK_OVER = 2.5 * 1024 * 1024, MAX_SIDE = 2560;

/** Photos over 2.5 MB come down to 2560 px on the long side (still sharp on any screen). Anything that can't be
 *  shrunk safely (HEIC on some phones, GIFs, odd files) is sent untouched. Never throws. */
export async function shrinkPhoto(f: File): Promise<{ blob: Blob; name: string; type: string }> {
  const type = fileType(f);
  const same = { blob: f as Blob, name: f.name, type };
  if (!/^image\/(jpeg|png|webp)$/.test(type) || f.size < SHRINK_OVER || typeof createImageBitmap !== "function") return same;
  try {
    const bmp = await createImageBitmap(f);                    // applies the photo's own rotation (EXIF) in current browsers
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return same;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);          // transparent PNGs get a white background, not black
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.86));
    if (!blob || blob.size >= f.size) return same;             // no gain: keep the original
    return { blob, name: f.name.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg", type: "image/jpeg" };
  } catch { return same; }
}

/** Short device label for the activity log ("iPhone; CPU iPhone OS 17_4 like Mac OS X"). */
export const deviceLabel = () => (typeof navigator === "undefined" ? "" : navigator.userAgent.replace(/^Mozilla\/5\.0 \(([^)]*)\).*/, "$1").slice(0, 80));

/** A message id made on the phone, so a retry can never post the same message twice. */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  (typeof crypto !== "undefined" ? crypto : { getRandomValues: (x: Uint8Array) => x.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
