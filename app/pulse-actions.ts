"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireRole } from "@/lib/data";
import { canSeePulse } from "@/lib/preview";

/** Refresh on Pulse: drops the 5-minute cache for every range and view, then the page reloads fresh. */
export async function refreshPulseAction(): Promise<void> {
  const v = await requireRole("admin");
  if (!canSeePulse(v.email)) return;
  revalidateTag("pulse");
  revalidatePath("/a/pulse");
}
