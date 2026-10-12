import "server-only";
import crypto from "node:crypto";

// Google Drive for chat media (photos and videos). Files go straight from the phone to Drive,
// so nothing big ever touches Supabase or Vercel. We only create the upload session here.
//
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   the service account's email
//   GOOGLE_PRIVATE_KEY             its private key (from the JSON key file)
//   DRIVE_ROOT_FOLDER_ID           a folder inside a Shared Drive (service account = Content manager)

const API = process.env.DRIVE_API_BASE || "https://www.googleapis.com";
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";

export const driveConfigured = () => !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.DRIVE_ROOT_FOLDER_ID);
export const rootFolderId = () => process.env.DRIVE_ROOT_FOLDER_ID || "";

let cached: { token: string; exp: number } | null = null;
const b64u = (s: string) => Buffer.from(s).toString("base64url");

export async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n").replace(/^"|"$/g, "");
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64u(JSON.stringify({ iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, scope: "https://www.googleapis.com/auth/drive", aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  let sig: string;
  try { sig = crypto.createSign("RSA-SHA256").update(`${header}.${claims}`).sign(key).toString("base64url"); }
  catch { throw new Error("GOOGLE_PRIVATE_KEY isn't a valid private key. Paste the whole private_key value from the JSON file, including the BEGIN and END lines."); }
  const r = await fetch(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${sig}` })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`Google refused the sign-in: ${d.error_description || d.error || r.status}. Check the service account email and key match.`);
  cached = { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return cached.token;
}

async function api(path: string, init: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${await accessToken()}`, ...(init.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, body, headers: r.headers };
}

/** Checks the root folder is reachable, lives in a Shared Drive and can take uploads. */
export async function checkRoot() {
  const r = await api(`/drive/v3/files/${encodeURIComponent(rootFolderId())}?fields=id,name,mimeType,driveId,capabilities(canAddChildren)&supportsAllDrives=true`);
  const hints: string[] = [];
  if (r.status === 404) hints.push("Google can't see that folder. Check DRIVE_ROOT_FOLDER_ID, and that the service account was added to the Shared Drive (as Content manager).");
  else if (!r.ok) hints.push(`Google said: ${r.body?.error?.message || r.status}`);
  else {
    if (r.body.mimeType !== "application/vnd.google-apps.folder") hints.push("DRIVE_ROOT_FOLDER_ID is a file, not a folder.");
    if (!r.body.driveId) hints.push("This folder is in a normal Drive, not a Shared Drive. Uploads will fail with a storage quota error. Put the folder in a Shared Drive.");
    if (r.body.capabilities && r.body.capabilities.canAddChildren === false) hints.push("The service account can see this folder but can't add files. Make it Content manager on the Shared Drive.");
  }
  return { ok: r.ok && !hints.length, name: r.body?.name as string | undefined, sharedDrive: !!r.body?.driveId, hints };
}

export async function ensureFolder(name: string, parentId: string): Promise<string> {
  const q = `name='${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const found = await api(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  if (found.ok && found.body.files?.[0]?.id) return found.body.files[0].id;
  const made = await api(`/drive/v3/files?supportsAllDrives=true&fields=id`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] })
  });
  if (!made.ok) throw new Error(`Couldn't create the folder: ${made.body?.error?.message || made.status}`);
  return made.body.id;
}

/** Starts a resumable upload. The phone then sends the file straight to the returned URL, in pieces.
 *  `origin` must be the web page's origin: Google only allows browser uploads from the origin it was started for. */
export async function createUploadSession(opts: { name: string; mimeType: string; size: number; parentId: string; origin: string }): Promise<string> {
  const r = await fetch(`${API}/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": opts.mimeType, "X-Upload-Content-Length": String(opts.size), Origin: opts.origin
    },
    body: JSON.stringify({ name: opts.name, parents: [opts.parentId] })
  });
  const url = r.headers.get("location");
  if (!r.ok || !url) {
    const d = await r.json().catch(() => ({}));
    throw new Error(`Google wouldn't start the upload: ${d?.error?.message || r.status}`);
  }
  return url;
}

// ── Per-booking folders (reports and, later, chat media) ────────────────
const clean = (s: string) => s.replace(/[\\/'"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

/** Finds a file by exact name inside a folder (used right after an upload to learn its id). */
export async function findFile(parentId: string, name: string): Promise<string | null> {
  const q = `name='${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false`;
  for (let i = 0; i < 4; i++) {
    const r = await api(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
    if (r.ok && r.body.files?.[0]?.id) return r.body.files[0].id;
    await new Promise((res) => setTimeout(res, 700));
  }
  return null;
}

/** One folder per booking, readable by anyone with the link (so clients can watch without a Google account). */
export async function ensureBookingFolder(b: { id: string; client_name: string; dog_name: string | null }) {
  return ensureSharedFolder(`${clean(b.dog_name || "Dog")} - ${clean(b.client_name)} (${b.id.slice(0, 6)})`);
}
/** The folder for one booking chat's photos and videos. */
export async function ensureChatFolder(c: { id: string; title: string | null; client_name: string | null }) {
  return ensureSharedFolder(`Chat - ${clean(c.title || "Dog")} - ${clean(c.client_name || "Client")} (${c.id.slice(0, 6)})`);
}
async function ensureSharedFolder(name: string): Promise<{ id: string; url: string; shared: boolean; warning?: string }> {
  const id = await ensureFolder(name, rootFolderId());
  let shared = true, warning: string | undefined;
  const p = await api(`/drive/v3/files/${id}/permissions?supportsAllDrives=true`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "anyone", role: "reader", allowFileDiscovery: false })
  });
  if (!p.ok) { shared = false; warning = `Couldn't make the link public: ${p.body?.error?.message || p.status}. In Google Admin, allow sharing outside the organization for this Shared Drive, or clients won't be able to open the videos.`; }
  return { id, url: `https://drive.google.com/drive/folders/${id}`, shared, warning };
}

/** Can folders be shared with "anyone with the link"? Workspace admins can block it. Tries it on a folder and undoes it. */
export async function testAnyoneSharing(folderId: string): Promise<{ ok: boolean; message: string }> {
  const p = await api(`/drive/v3/files/${folderId}/permissions?supportsAllDrives=true&fields=id`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "anyone", role: "reader", allowFileDiscovery: false })
  });
  if (!p.ok) return { ok: false, message: `Google blocked link sharing: ${p.body?.error?.message || p.status}. Clients won't be able to open videos until this is allowed (Google Admin → Apps → Google Workspace → Drive and Docs → Sharing settings, and the Shared Drive's own settings).` };
  if (p.body?.id) await api(`/drive/v3/files/${folderId}/permissions/${p.body.id}?supportsAllDrives=true`, { method: "DELETE" });
  return { ok: true, message: "Link sharing works: clients can open videos without a Google account." };
}

/** Puts a small file (a report PDF) into a folder from the server. Returns the file's id. */
export async function uploadFile(parentId: string, name: string, mimeType: string, bytes: Uint8Array): Promise<string> {
  const boundary = `dogwise${Math.random().toString(36).slice(2)}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parentId] })}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const r = await fetch(`${API}/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id`, {
    method: "POST", headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: Buffer.concat([head, Buffer.from(bytes), Buffer.from(`\r\n--${boundary}--`)])
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.id) throw new Error(`Couldn't save the file to Drive: ${d?.error?.message || r.status}`);
  return d.id;
}
