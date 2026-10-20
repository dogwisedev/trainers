import { userIdByEmail } from "./userLookup";
import "server-only";
import { serviceClient } from "./supabase";
import { sendMail } from "./mail";
import { BRAND_LOGO_PNG_BASE64 } from "./brandLogo";

// Sign-in and invite emails, created by the app and sent from info@.
// Links go to /auth/confirm?token_hash=… so they work in any browser or device (no PKCE cookie needed).

const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");

const findUserId = (email: string) => userIdByEmail(email);

function emailHtml(title: string, intro: string, button: string, link: string, footnote: string) {
  return `<div style="background:#f4f5f8;padding:24px 12px;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #E7E3F3">
    <div style="height:6px;background:linear-gradient(90deg,#2A1971,#6B4FE0)"></div>
    <div style="padding:26px 26px 22px">
      <img src="cid:dogwise-logo" alt="Dogwise Academy" width="140" style="display:block;height:auto">
      <div style="font-size:22px;font-weight:800;color:#2A1971;margin-top:18px">${title}</div>
      <p style="font-size:15px;line-height:1.6;color:#41395E;margin:8px 0 20px">${intro}</p>
      <a href="${link}" style="display:inline-block;background:#2A1971;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">${button}</a>
      <p style="font-size:13px;line-height:1.6;color:#6B6880;margin:20px 0 0">${footnote}</p>
    </div>
  </div></div>`;
}
const logo = { filename: "dogwise.png", content: Buffer.from(BRAND_LOGO_PNG_BASE64, "base64"), contentType: "image/png", cid: "dogwise-logo" };

/** Invite a trainer (or re-send their login). Returns their auth user id. */
export async function sendInvite(email: string, name: string): Promise<{ userId: string }> {
  const admin = serviceClient();
  let { data, error } = await admin.auth.admin.generateLink({ type: "invite", email });
  let type = "invite";
  if (error) {
    // Already has an account: send a sign-in link instead
    ({ data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email }));
    type = "magiclink";
  }
  if (error || !data?.properties?.hashed_token || !data.user) throw new Error(error?.message || "Couldn't create the sign-in link.");
  const link = `${site()}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=${type}&next=/t`;
  const first = name.replace(/".*?"\s*/, "").split(" ")[0] || "there";
  await sendMail({
    to: email, subject: "Your Dogwise Academy app login",
    html: emailHtml("Welcome to the Dogwise Academy app",
      `Hi ${first}, this is where you'll see the dogs booked with you, block time off, get your payslips and message the Dogwise team.`,
      "Open the app", link,
      "The button signs you straight in. Then choose a password (there's a prompt at the top) so you can sign in with your email and password any time. The link works once and expires in 24 hours."),
    text: `Hi ${first}, open the Dogwise Academy app: ${link}\nThen choose a password so you can sign in any time. The link works once.`,
    attachments: [logo]
  });
  return { userId: data.user.id };
}

/** Email a sign-in link to someone who already has an account. Silent if they don't (so emails can't be probed). */
export async function sendSignInLink(email: string): Promise<void> {
  if (!(await findUserId(email))) return;
  const { data, error } = await serviceClient().auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) throw new Error(error?.message || "Couldn't create the sign-in link.");
  const link = `${site()}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=magiclink`;
  await sendMail({
    to: email, subject: "Your Dogwise Academy sign-in link",
    html: emailHtml("Sign in to Dogwise Academy", "Tap the button to sign in. It works in any browser or on your phone.", "Sign me in", link,
      "This link works once and expires in an hour. Forgotten your password? Sign in with this link, then set a new one from the Password link in the menu."),
    text: `Sign in to Dogwise Academy: ${link}\nThis link works once and expires in an hour.`,
    attachments: [logo]
  });
}

// ── Clients (chat) ──────────────────────────────────────────────────────

/** Makes sure a client has a login (confirmed, no password) and returns their user id. Never emails anyone. */
export async function ensureClientUser(email: string): Promise<string> {
  const admin = serviceClient();
  const made = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (made.data?.user) return made.data.user.id;
  // Already has an account (a client's second dog, or a trainer/admin testing with their own address)
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.data?.user) return link.data.user.id;
  throw new Error(made.error?.message || link.error?.message || "Couldn't set up the client's login.");
}

/** One-click link that signs a client straight into a page. */
export async function clientLoginLink(email: string, next: string): Promise<string> {
  const { data, error } = await serviceClient().auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) throw new Error(error?.message || "Couldn't create the sign-in link.");
  return `${site()}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=magiclink&next=${encodeURIComponent(next)}`;
}

/** "Here's your chat with the trainer" email from info@. */
export async function sendChatInvite(opts: { email: string; clientName: string; title: string; trainerName: string; chatId: string }) {
  const first = (opts.clientName || "").split(" ")[0] || "there";
  const link = await clientLoginLink(opts.email, `/c/${opts.chatId}`);
  await sendMail({
    to: opts.email, subject: `Your Dogwise training chat for ${opts.title}`,
    html: emailHtml(`Chat with ${opts.trainerName || "your trainer"}`,
      `Hi ${first}, this is your private chat for ${opts.title}'s training. ${opts.trainerName ? `${opts.trainerName} and ` : ""}the Dogwise team will share updates, photos and videos here, and you can message us any time.`,
      "Open the chat", link,
      `The button signs you straight in, and works once. If it has expired, go to ${site()}/login, enter this email address, leave the password empty, and we'll send you a fresh link.`),
    text: `Hi ${first}, your chat for ${opts.title}: ${link}\nIf the link has expired, go to ${site()}/login and enter this email address.`,
    attachments: [logo]
  });
}
