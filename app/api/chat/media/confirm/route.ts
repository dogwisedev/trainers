import { NextResponse } from "next/server";
import { findFile } from "@/lib/drive";
import { accessibleChat } from "@/lib/driveAccess";

// After an upload: finds the file in the chat's folder and returns its id.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const a = await accessibleChat(String(body.chatId || ""));
  if ("error" in a) return a.error;
  if (!a.c.drive_folder_id) return NextResponse.json({ message: "No folder for this chat yet." }, { status: 400 });
  const id = await findFile(a.c.drive_folder_id, String(body.storedName || ""));
  if (!id) return NextResponse.json({ message: "The upload isn't in Drive yet. Try again in a moment." }, { status: 404 });
  return NextResponse.json({ id });
}
