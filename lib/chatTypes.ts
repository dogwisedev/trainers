// Chat types and small helpers that are safe to use in the browser too.
export type MediaRef = { id: string; name: string; kind: "video" | "photo" | "file"; size?: number };
export type ChatMsg = {
  id: string; chat_id: string; sender_id: string | null; sender_role: "admin" | "trainer" | "client" | "system"; sender_name: string | null;
  kind: "text" | "media" | "report" | "system"; body: string | null; media: MediaRef[]; report_id: string | null; created_at: string;
};
export type ChatRow = {
  id: string; deal_key: string; trainer_id: string | null; trainer_name: string | null; client_user_id: string | null; client_name: string | null; client_email: string | null;
  title: string | null; status: "open" | "closed"; drive_folder_id: string | null; drive_folder_url: string | null;
  last_message_at: string | null; last_preview: string | null; last_sender: string | null; last_trainer_at: string | null; last_client_at: string | null; last_admin_at: string | null;
  admin_seen_at: string | null; invited_at: string | null; created_at: string; closed_at: string | null;
  client_emails: boolean; archived_at: string | null; transcript_url: string | null; notified_client_at?: string | null;
  quiet_at?: string | null; quiet_by?: string | null; // quiet chat (migration 039): finishing on Signal, no alerts
};
export const driveView = (id: string) => `https://drive.google.com/file/d/${id}/view`;
export const driveDownload = (id: string) => `https://drive.google.com/uc?export=download&id=${id}`;
export const driveThumb = (id: string, width = 480) => `https://drive.google.com/thumbnail?id=${id}&sz=w${width}`;
/** Drive's own player/viewer, embeddable in the app (works for link-shared files, no Google account needed). */
export const drivePreview = (id: string) => `https://drive.google.com/file/d/${id}/preview`;
export const dealKey = (b: { hubspot_deal_id?: string | null; id: string }) => b.hubspot_deal_id || b.id;

const ts = (v: string | null) => (v ? new Date(v).getTime() : 0);
/** Is there something in this chat the viewer hasn't seen? Admins share one mark (admin_seen_at); trainers and clients have their own. */
export function chatUnread(chat: ChatRow, role: "admin" | "trainer" | "client", readAt?: string | null): boolean {
  const others = role === "admin" ? Math.max(ts(chat.last_client_at), ts(chat.last_trainer_at))
    : role === "trainer" ? Math.max(ts(chat.last_client_at), ts(chat.last_admin_at)) : Math.max(ts(chat.last_trainer_at), ts(chat.last_admin_at));
  const seen = role === "admin" ? ts(chat.admin_seen_at) : ts(readAt || null);
  return others > seen;
}
