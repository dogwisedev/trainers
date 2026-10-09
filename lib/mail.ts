import "server-only";
import nodemailer from "nodemailer";

// Sends from info@ through Google Workspace SMTP (or any SMTP).
//   SMTP_HOST=smtp.gmail.com  SMTP_PORT=465  SMTP_USER=info@dogwiseacademy.com  SMTP_PASS=<Google app password>
//   MAIL_FROM="Dogwise Academy <info@dogwiseacademy.com>"
export const mailConfigured = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
function smtp() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return transport;
}

export type Attachment = { filename: string; content: Buffer | Uint8Array; contentType?: string; cid?: string };

export async function sendMail(opts: { to: string; subject: string; html: string; text: string; attachments?: Attachment[] }) {
  if (!mailConfigured()) throw new Error("Email isn't set up yet: add SMTP_HOST, SMTP_USER and SMTP_PASS in Vercel.");
  const from = process.env.MAIL_FROM || `Dogwise Academy <${process.env.SMTP_USER}>`;
  await smtp().sendMail({
    from, to: opts.to, replyTo: process.env.MAIL_REPLY_TO || process.env.SMTP_USER, subject: opts.subject,
    html: opts.html, text: opts.text,
    attachments: opts.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType, cid: a.cid }))
  });
}
