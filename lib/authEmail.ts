import { userIdByEmail } from "./userLookup";
import { dealContacts, readContacts, readDeals } from "./hubspot";
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
    <div style="height:6px;background:linear-gradient(90deg,#281870,#6E4FE0)"></div>
    <div style="padding:26px 26px 22px">
      <img src="cid:dogwise-logo" alt="Dogwise Academy" width="140" style="display:block;height:auto">
      <div style="font-size:22px;font-weight:800;color:#281870;margin-top:18px">${title}</div>
      <p style="font-size:15px;line-height:1.6;color:#41395E;margin:8px 0 20px">${intro}</p>
      <a href="${link}" style="display:inline-block;background:#281870;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">${button}</a>
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
  if (error || !data?.user) throw new Error(error?.message || "Couldn't create the login.");
  void type;
  // The button goes to /welcome, which makes a fresh sign-in link when it's tapped: it works for 7 days, not 24 hours
  const link = welcomeLink(email, "/t");
  const first = name.replace(/".*?"\s*/, "").split(" ")[0] || "there";
  await sendMail({
    to: email, subject: "Your Dogwise Academy app login",
    html: emailHtml("Welcome to the Dogwise Academy app",
      `Hi ${first}, this is where you'll see the dogs booked with you, block time off, get your payslips and message the Dogwise team.`,
      "Open the app", link,
      "The button signs you straight in and works for 7 days. Then choose a password so you can sign in with your email and password any time, or tap \"Email me a code\" on the sign-in page."),
    text: `Hi ${first}, open the Dogwise Academy app: ${link}\nThe button works for 7 days. Then choose a password so you can sign in any time, or tap "Email me a code" on the sign-in page.`,
    attachments: [logo]
  });
  return { userId: data.user.id };
}

/** Email a sign-in code (and link) to someone who already has an account. Silent if they don't (so emails can't be probed).
 *  The 6-digit code is typed into the app itself, so it works inside the installed Home Screen app on iPhone,
 *  which never receives email links (they always open in the browser). */
export async function sendSignInLink(email: string): Promise<void> {
  if (!(await findUserId(email))) return;
  const { data, error } = await serviceClient().auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) throw new Error(error?.message || "Couldn't create the sign-in link.");
  const link = `${site()}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=magiclink`;
  const code = String(data.properties.email_otp || "").trim();
  const codeBlock = code
    ? `<div style="margin:0 0 18px;padding:14px 16px;background:#F0E8F8;border-radius:12px;text-align:center"><div style="font-size:13px;color:#5D5880;margin-bottom:4px">Your sign-in code</div><div style="font-size:32px;font-weight:800;letter-spacing:6px;color:#281870">${code}</div><div style="font-size:12px;color:#5D5880;margin-top:4px">Type it into the Dogwise app</div></div>`
    : "";
  await sendMail({
    to: email, subject: code ? `${code} is your Dogwise Academy sign-in code` : "Your Dogwise Academy sign-in link",
    html: emailHtml("Sign in to Dogwise Academy", `${codeBlock}Or tap the button to sign in on this device.`, "Sign me in", link,
      "The code and the button work once and expire in an hour. Only the newest email works. Forgotten your password? Sign in with the code, then set a new one from your profile."),
    text: `${code ? `Your Dogwise Academy sign-in code: ${code}\nType it into the app.\n\n` : ""}Or sign in here: ${link}\nThis works once and expires in an hour.`,
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

/** The client's phone and the deal's first dog, from HubSpot (the snapshot the app keeps, else HubSpot itself). */
async function clientDetails(chatId: string): Promise<{ phone: string | null; dog1: string | null }> {
  const sb = serviceClient();
  const { data: chat } = await sb.from("chats").select("deal_key").eq("id", chatId).maybeSingle();
  const deal = chat?.deal_key && /^\d+$/.test(chat.deal_key) ? chat.deal_key : null;
  if (!deal) return { phone: null, dog1: null };
  const { data: snap } = await sb.from("pretraining_deals").select("contact, deal").eq("deal_id", deal).maybeSingle();
  let dog1 = String((snap?.deal as Record<string, string> | undefined)?.k9___dog_name || "").trim() || null;
  const fromSnap = String((snap?.contact as Record<string, string> | undefined)?.phone || "");
  if (fromSnap.replace(/\D/g, "").length >= 4 && dog1) return { phone: fromSnap, dog1 };
  try {
    if (!dog1) dog1 = String((await readDeals([deal], ["k9___dog_name"])).get(deal)?.k9___dog_name || "").trim() || null;
    if (fromSnap.replace(/\D/g, "").length >= 4) return { phone: fromSnap, dog1 };
    const ids = (await dealContacts([deal])).get(deal) || [];
    const contacts = await readContacts(ids, ["phone", "mobilephone"]);
    for (const c of contacts.values()) { const ph = String(c.phone || c.mobilephone || ""); if (ph.replace(/\D/g, "").length >= 4) return { phone: ph, dog1 }; }
  } catch { /* HubSpot unreachable: fall back below */ }
  return { phone: null, dog1 };
}
/** The client's password: dog name + last 4 digits of their phone, all lowercase (sign-in ignores capitals), e.g. "steven2357". */
const clientPassword = (dog: string, phone: string | null) => `${(dog.replace(/[^A-Za-z]/g, "") || "dog").toLowerCase().slice(0, 14)}${phone ? phone.replace(/\D/g, "").slice(-4) : String(Math.floor(1000 + Math.random() * 9000))}`;
const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** "Welcome to Bowser's chat" email from info@: a button that signs them straight in (works for 30 days), and a simple password as a backup. */
export async function sendChatInvite(opts: { email: string; clientName: string; title: string; trainerName: string; chatId: string }) {
  const first = (opts.clientName || "").split(" ")[0] || "there", dog = opts.title || "your dog";
  const link = welcomeLink(opts.email, `/c/${opts.chatId}`, 30);
  // Password = the FIRST dog's name (dog 1 on the HubSpot deal) + last 4 digits of the client's phone.
  // One chat per deal, so a client with several dogs has one chat and one password. Set on every invite: always the one in the latest email.
  let password: string | null = null, fromPhone = false, pwDog = dog.split("&")[0].trim();
  const id = await userIdByEmail(opts.email);
  if (id) {
    const d = await clientDetails(opts.chatId);
    pwDog = d.dog1 || pwDog;
    const pw = clientPassword(pwDog, d.phone);
    const { error } = await serviceClient().auth.admin.updateUserById(id, { password: pw });
    if (!error) { password = pw; fromPhone = !!d.phone; }
  }
  const login = `${site()}/login`;
  await sendMail({
    to: opts.email, subject: `Welcome to ${dog}'s training chat`,
    html: emailHtml(`Welcome to ${esc(dog)}'s chat`,
      `Hi ${esc(first)}, this is your private chat for ${esc(dog)}'s training. ${opts.trainerName ? `${esc(opts.trainerName)} and ` : ""}the Dogwise team will post updates, photos and videos of ${esc(dog)} here, and you can message us any time.<br><br>
      <b>How to use it:</b><br>1. Tap the button below. You're signed straight in.<br>2. Read the updates, and type in the box at the bottom to message us.<br>3. Tap the paperclip to send a photo, video or PDF.<br>4. We'll email you whenever there's something new.`,
      `Open ${esc(dog)}'s chat`, link,
      `The button works for 30 days. You can also sign in any time at <a href="${login}">${login.replace(/^https?:\/\//, "")}</a>:<br>
      <b>Email:</b> ${esc(opts.email)}<br>${password ? `<b>Password:</b> <span style="font-size:17px;font-weight:700;color:#281870">${password}</span><br><span style="font-size:12px">${fromPhone ? `That's ${esc(pwDog)}'s name and the last 4 digits of your phone number. ` : ""}Capital letters don't matter.</span><br>` : "<b>Password:</b> leave it empty and we'll email you a sign-in link.<br>"}
      Tip: on your phone, add the page to your Home Screen so ${esc(dog)}'s chat is one tap away.`),
    text: `Hi ${first}, welcome to ${dog}'s training chat.\nOpen it: ${link}\n(works for 30 days)\n\nOr sign in any time at ${login}\nEmail: ${opts.email}\n${password ? `Password: ${password}` : "Password: the one you set before"}\n`,
    attachments: [logo]
  });
}
