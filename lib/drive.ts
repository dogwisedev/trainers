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
