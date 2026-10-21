import { lastSignIns, userIdByEmail } from "./userLookup";
import { welcomeLink } from "./trainerSignin";
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

/** A simple password for a client: the dog's name plus 4 digits, e.g. "Bowser4821". */
const simplePassword = (dog: string) => `${(dog.replace(/[^A-Za-z]/g, "") || "Dog").replace(/^./, (c) => c.toUpperCase()).slice(0, 12)}${Math.floor(1000 + Math.random() * 9000)}`;
const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** "Welcome to Bowser's chat" email from info@: a button that signs them straight in (works for 30 days), and a simple password as a backup. */
export async function sendChatInvite(opts: { email: string; clientName: string; title: string; trainerName: string; chatId: string }) {
  const first = (opts.clientName || "").split(" ")[0] || "there", dog = opts.title || "your dog";
  const link = welcomeLink(opts.email, `/c/${opts.chatId}`, 30);
  // A password only for someone who has never signed in (it never changes a password they already use)
  let password: string | null = null;
  const id = await userIdByEmail(opts.email);
  if (id) {
    const seen = await lastSignIns([id]);
    if (seen && !seen.get(id)) {
      const pw = simplePassword(dog.split(/\s|&/)[0]);
      const { error } = await serviceClient().auth.admin.updateUserById(id, { password: pw });
      if (!error) password = pw;
    }
  }
  const login = `${site()}/login`;
  await sendMail({
    to: opts.email, subject: `Welcome to ${dog}'s training chat`,
    html: emailHtml(`Welcome to ${esc(dog)}'s chat`,
      `Hi ${esc(first)}, this is your private chat for ${esc(dog)}'s training. ${opts.trainerName ? `${esc(opts.trainerName)} and ` : ""}the Dogwise team will post updates, photos and videos of ${esc(dog)} here, and you can message us any time.<br><br>
      <b>How to use it:</b><br>1. Tap the button below. You're signed straight in.<br>2. Read the updates, and type in the box at the bottom to message us.<br>3. Tap the paperclip to send a photo or video.<br>4. We'll email you whenever there's something new.`,
      `Open ${esc(dog)}'s chat`, link,
      `The button works for 30 days. You can also sign in any time at <a href="${login}">${login.replace(/^https?:\/\//, "")}</a>:<br>
      <b>Email:</b> ${esc(opts.email)}<br>${password ? `<b>Password:</b> <span style="font-size:16px;font-weight:700;color:#2A1971">${password}</span><br>` : "<b>Password:</b> the one you set before (or leave it empty and we'll email you a link).<br>"}
      Tip: on your phone, add the page to your Home Screen so ${esc(dog)}'s chat is one tap away.`),
    text: `Hi ${first}, welcome to ${dog}'s training chat.\nOpen it: ${link}\n(works for 30 days)\n\nOr sign in any time at ${login}\nEmail: ${opts.email}\n${password ? `Password: ${password}` : "Password: the one you set before"}\n`,
    attachments: [logo]
  });
}
