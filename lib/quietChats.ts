// Quiet chats (migration 039): for dogs finishing their training on Signal. A quiet chat gets none of these alerts, no client
// "new updates" emails and no automatic invite. Messages still notify as normal if anyone does post in the app.
import type { IncidentKind } from "./chatRules";

export const QUIET_KINDS: IncidentKind[] = ["trainer_silent", "client_waiting", "client_pileup"];
export const QUIET_LABEL = "Quiet: finishing on Signal";

/** Who may quiet or unquiet a chat: QUIET_CHAT_EMAILS (comma-separated), or alma@dogwiseacademy.com. Everyone else only sees the label. */
export function canQuiet(email: string | null | undefined): boolean {
  const allowed = (process.env.QUIET_CHAT_EMAILS || "alma@dogwiseacademy.com").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return !!email && allowed.includes(email.trim().toLowerCase());
}
