import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { verifyMedia } from "@/lib/mediaSig";

const page = (title: string, body: string, status = 200) => new NextResponse(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:Arial,sans-serif;background:#f4f5f8;margin:0;padding:40px 16px"><div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid #E7E3F3;border-radius:16px;padding:28px"><h1 style="font-size:20px;color:#281870;margin:0 0 10px">${title}</h1><p style="font-size:15px;color:#333;line-height:1.5;margin:0">${body}</p></div></body>`, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

// The "Stop these emails" link in a client's notification email. Works without signing in.
export async function GET(req: Request) {
  const u = new URL(req.url), id = u.searchParams.get("c") || "", t = u.searchParams.get("t") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyMedia(id, "mute-chat", t)) return page("This link isn't valid", "It may have been copied incompletely. You can still read your chat any time by signing in.", 400);
  // Opening the link only asks: email security scanners open every link in a message, and that used to switch the emails off
  // without the client doing anything. The button below sends the POST that does it.
  return page("Stop these emails?", `You'll stop getting notification emails about this chat. Your chat stays where it is.<form method="post" action="/api/chat/mute?c=${id}&amp;t=${encodeURIComponent(t)}" style="margin:18px 0 0"><button type="submit" style="font:inherit;font-weight:bold;color:#fff;background:#281870;border:0;border-radius:10px;padding:12px 18px;cursor:pointer">Stop these emails</button></form>`);
}
export async function POST(req: Request) {
  const u = new URL(req.url), id = u.searchParams.get("c") || "", t = u.searchParams.get("t") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyMedia(id, "mute-chat", t)) return page("This link isn't valid", "It may have been copied incompletely. You can still read your chat any time by signing in.", 400);
  await serviceClient().from("chats").update({ client_emails: false }).eq("id", id);
  return page("No more emails", "You won't get notification emails about this chat any more. Your chat is still there whenever you want to read it.");
}
