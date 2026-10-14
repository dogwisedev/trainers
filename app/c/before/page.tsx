import { redirect } from "next/navigation";
import { requireRole } from "@/lib/data";
import { listChats } from "@/lib/chatData";

// A fixed link for reminder emails: https://<app>/c/before → the client's "Before training" page (their open chat's Dog profile).
export default async function BeforeTraining() {
  const v = await requireRole("client");
  const open = (await listChats()).filter((c) => c.client_user_id === v.userId && c.status === "open");
  redirect(open.length ? `/c/${open[0].id}/profile` : "/c");
}
