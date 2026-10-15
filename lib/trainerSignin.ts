import "server-only";
import crypto from "node:crypto";
import { serviceClient } from "./supabase";
import { sendMail } from "./mail";
import { BRAND_LOGO_PNG_BASE64 } from "./brandLogo";

// Trainers who haven't signed in yet, and a friendly email to help them in.
// The email's button goes to /welcome?t=…, which makes a fresh sign-in link when it's tapped,
// so it keeps working for 7 days (and survives email scanners that open links first).

const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const key = () => process.env.MEDIA_SIGNING_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "dogwise-dev-key";
const VALID_DAYS = 7;

export type SigninRow = { id: string; name: string; email: string | null; lastSignIn: string | null; hasLogin: boolean; nudgedAt: string | null };

async function allUsers() {
  const users: { id: string; email?: string; last_sign_in_at?: string | null }[] = [];
  for (let page = 1; page <= 10; page++) {
    const { data } = await serviceClient().auth.admin.listUsers({ page, perPage: 1000 });
    users.push(...(data?.users || []));
    if (!data || data.users.length < 1000) break;
  }
  return users;
}

/** Active trainers and whether they've ever signed in. */
export async function trainerSignins(): Promise<SigninRow[]> {
  const sb = serviceClient();
  const [{ data: trainers }, { data: profiles }, users] = await Promise.all([
    sb.from("trainers").select("id, name, email, dogwise_email, signin_nudged_at").eq("active", true).order("name"),
    sb.from("profiles").select("id, trainer_id").not("trainer_id", "is", null),
    allUsers()
  ]);
  return ((trainers || []) as { id: string; name: string; email: string | null; dogwise_email: string | null; signin_nudged_at: string | null }[]).map((t) => {
    const logins = ((profiles || []) as { id: string; trainer_id: string }[]).filter((p) => p.trainer_id === t.id).map((p) => users.find((u) => u.id === p.id)).filter(Boolean);
    const last = logins.map((u) => u!.last_sign_in_at).filter((x): x is string => !!x).sort().pop() || null;
    return { id: t.id, name: t.name, email: t.email || t.dogwise_email, lastSignIn: last, hasLogin: logins.length > 0, nudgedAt: t.signin_nudged_at };
  });
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (body: string) => crypto.createHmac("sha256", key()).update(`welcome:${body}`).digest("base64url").slice(0, 32);
export function welcomeLink(email: string) {
  const body = `${b64(email.toLowerCase())}.${Date.now() + VALID_DAYS * 86400e3}`;
  return `${site()}/welcome?t=${body}.${sign(body)}`;
}
/** The email address in a welcome link, if the link is genuine and not expired. */
export function verifyWelcome(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const body = `${parts[0]}.${parts[1]}`, sig = sign(body);
  if (parts[2].length !== sig.length || !crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(sig))) return null;
  if (Number(parts[1]) < Date.now()) return null;
  return Buffer.from(parts[0], "base64url").toString();
}

/** Makes sure the trainer has a login linked to their profile (creates one if needed). */
async function ensureLogin(trainerId: string, email: string, name: string) {
  const sb = serviceClient();
  let user = (await allUsers()).find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    const { data, error } = await sb.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw new Error(error?.message || "Couldn't create the login.");
    user = data.user;
  }
  const { data: existing } = await sb.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (existing?.role !== "admin") await sb.from("profiles").upsert({ id: user.id, role: "trainer", trainer_id: trainerId, display_name: name });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** The friendly "your app is ready, here's how to get in" email. */
export async function sendSigninHello(trainerId: string): Promise<{ ok: boolean; message: string }> {
  const sb = serviceClient();
  const { data: t } = await sb.from("trainers").select("name, email, dogwise_email").eq("id", trainerId).maybeSingle();
  const email = t?.email || t?.dogwise_email;
  if (!t || !email) return { ok: false, message: `${t?.name || "Trainer"}: no email on their profile.` };
  try {
    await ensureLogin(trainerId, email, t.name);
    const first = t.name.replace(/".*?"\s*/, "").split(" ")[0] || "there", link = welcomeLink(email);
    const li = (s: string) => `<li style="margin:0 0 6px">${s}</li>`;
    await sendMail({
      to: email,
      subject: `${first}, your Dogwise Academy app is ready for you`,
      text: `Hi ${first},\n\nWe noticed you haven't had a chance to open the Dogwise Academy app yet, so here's a quick hand.\n\nIt's where you'll find the dogs booked with you, each dog's forms (intake, weekly health check, handover), your chats with clients and the Dogwise team, and your payslips.\n\n1. Open this link: it signs you straight in, no password needed: ${link}\n2. Choose a password when it asks, so you can sign in any time.\n3. On your phone, add it to your home screen so it's one tap away.\n\nThe link works for ${VALID_DAYS} days. Any trouble, just reply to this email and we'll help.\n\nThe Dogwise team`,
      html: `<div style="background:#f4f5f8;padding:24px 12px;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:540px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #E7E3F3">
    <div style="height:6px;background:linear-gradient(90deg,#2A1971,#6B4FE0)"></div>
    <div style="padding:26px">
      <img src="cid:dogwise-logo" alt="Dogwise Academy" width="140" style="display:block;height:auto">
      <div style="font-size:22px;font-weight:800;color:#2A1971;margin-top:18px">Hi ${esc(first)}, your app is ready</div>
      <p style="font-size:15px;line-height:1.6;color:#41395E;margin:8px 0 12px">We noticed you haven't had a chance to open the Dogwise Academy app yet, so here's a quick hand. It's where you'll find:</p>
      <ul style="font-size:15px;line-height:1.5;color:#41395E;margin:0 0 16px;padding-left:20px">
        ${li("the dogs booked with you, with their dates")}${li("each dog's forms: intake, weekly health check and handover")}${li("your chats with clients and the Dogwise team")}${li("your payslips")}
      </ul>
      <p style="font-size:15px;font-weight:700;color:#1C1734;margin:0 0 6px">Getting in takes a minute:</p>
      <ol style="font-size:15px;line-height:1.5;color:#41395E;margin:0 0 20px;padding-left:20px">
        ${li("Tap the button below. It signs you straight in, no password needed.")}${li("Choose a password when it asks, so you can sign in any time.")}${li("On your phone, add it to your home screen: on iPhone tap Share, then <b>Add to Home Screen</b>; on Android tap the ⋮ menu, then <b>Add to Home screen</b>.")}
      </ol>
      <a href="${link}" style="display:inline-block;background:#2A1971;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:10px">Open my app</a>
      <p style="font-size:13px;line-height:1.6;color:#6B6880;margin:20px 0 0">The button works for ${VALID_DAYS} days. Any trouble at all, just reply to this email and we'll help you get in.</p>
      <p style="font-size:15px;color:#41395E;margin:16px 0 0">The Dogwise team</p>
    </div>
  </div></div>`,
      attachments: [{ filename: "dogwise.png", content: Buffer.from(BRAND_LOGO_PNG_BASE64, "base64"), contentType: "image/png", cid: "dogwise-logo" }]
    });
    await sb.from("trainers").update({ signin_nudged_at: new Date().toISOString() }).eq("id", trainerId);
    return { ok: true, message: `Sent to ${t.name}.` };
  } catch (e) { return { ok: false, message: `${t.name}: ${(e as Error).message}` }; }
}

/** The account behind a welcome link gets a fresh one-time sign-in token. */
export async function freshSigninHash(email: string): Promise<string | null> {
  const { data, error } = await serviceClient().auth.admin.generateLink({ type: "magiclink", email });
  return error ? null : data?.properties?.hashed_token || null;
}
