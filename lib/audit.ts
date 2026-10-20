import "server-only";
import { getViewer } from "./data";
import { isDemo, serviceClient } from "./supabase";

// Activity log. Every server action calls auditCall() first: who did what, when, on which dog / chat / trainer.
// Never stores passwords. Never throws (a log failure must never stop the action).
export const LOG_VIEWERS = () => (process.env.LOG_VIEWERS || "alma@dogwiseacademy.com").toLowerCase().split(",").map((s) => s.trim());

const LABEL: Record<string, string> = {
  signOut: "Signed out", setPassword: "Changed their password", saveTrainer: "Saved a trainer profile", setTrainerActive: "Changed a trainer's active status",
  clearFlag: "Cleared a trainer profile flag", inviteTrainer: "Sent a trainer their login", addTimeOff: "Added time off", deleteTimeOff: "Removed time off",
  saveBooking: "Saved a booking", setExtraDays: "Changed extra days", setBookingStatus: "Changed a booking's status", sendMessage: "Sent a Trainer message",
  emailTrainerAboutBooking: "Emailed a trainer about a booking", sendSigninHellos: "Sent 'your app is ready' emails", logFollowupAction: "Logged a follow-up session",
  decideProbationAction: "Decided a probation", setFollowupsAction: "Set follow-up session dates", startChatAction: "Started a chat", inviteClientAction: "Invited a client to a chat",
  takeIncidentAction: "Took a to-do", resolveIncidentAction: "Marked a to-do Done", closeChatAction: "Closed a chat", reopenChatAction: "Reopened a chat",
  sendSummaryAgainAction: "Re-sent a chat summary", setClientEmailsAction: "Changed client chat emails", savePayslipAction: "Edited a payslip",
  approveAndSendAction: "Approved and sent a payslip", approveAction: "Approved a payslip", approveManyAction: "Approved several payslips",
  correctAndResendAction: "Corrected and re-sent a payslip", resendAction: "Re-sent a payslip", reopenAction: "Reopened a payslip", saveRatesAction: "Saved pay rates",
  submitReportAction: "Submitted a form", approveReportAction: "Approved a form", sendBackAction: "Sent a form back", resendReportAction: "Re-sent a form to the client",
  setReportsEnabledAction: "Turned forms on/off for a dog", waiveReportAction: "Marked a form not needed", unwaiveReportAction: "Brought back a form",
  saveProfileAction: "Edited before-training answers", reviewVaccinesAction: "Checked vaccines", setClearedAction: "Changed 'OK to start'", setSlotAction: "Changed which dog is which on a deal",
  signInPassword: "Signed in with their password", signInFailed: "Tried to sign in: wrong email or password", signInLinkSent: "Asked for a sign-in link by email",
  signInLinkUsed: "Signed in with an email link", pushOn: "Turned notifications on", pushOff: "Turned notifications off", pushTest: "Sent themselves a test notification",
  bookingApi: "Booked a dog from the HubSpot extension",
  addVaccineFileAction: "Uploaded a vaccine record", inviteSalesAction: "Sent a sales login", importSalesAction: "Imported sales from the Monies sheet", reportIncidentAction: "Reported an incident"
};

const short = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").slice(0, 120);
function describe(args: Record<string, unknown>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (v instanceof FormData) {
      for (const [fk, fv] of v.entries()) if (!/pass|token|secret/i.test(fk) && typeof fv === "string" && fv.trim()) out.push(`${fk}: ${short(fv)}`);
    } else if (/pass|token|secret/i.test(k)) continue;
    else if (Array.isArray(v)) out.push(`${k}: ${v.length > 6 ? `${v.length} items` : v.map(short).join(", ")}`);
    else if (v && typeof v === "object") out.push(`${k}: ${short(JSON.stringify(v))}`);
    else if (v !== undefined && v !== null && v !== "") out.push(`${k}: ${short(v)}`);
  }
  return out.join(" · ").slice(0, 900);
}

/** Names instead of ids, where it's cheap: the dog for a booking, the chat's dog, the trainer. */
async function context(args: Record<string, unknown>): Promise<{ about: string; link: string | null }> {
  const sb = serviceClient(), s = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  try {
    const bookingId = s("bookingId") || (/^[0-9a-f-]{36}$/.test(s("id")) ? s("id") : "");
    if (s("chatId")) { const { data } = await sb.from("chats").select("title, client_name").eq("id", s("chatId")).maybeSingle(); if (data) return { about: `${data.title || "Dog"} (${data.client_name || "client"})`, link: `/a/chats/${s("chatId")}` }; }
    if (bookingId) { const { data } = await sb.from("bookings").select("dog_name, client_name").eq("id", bookingId).maybeSingle(); if (data) return { about: `${data.dog_name || "Dog"} (${data.client_name})`, link: `/a/dogs/${bookingId}` }; }
    if (s("trainerId")) { const { data } = await sb.from("trainers").select("name").eq("id", s("trainerId")).maybeSingle(); if (data) return { about: data.name, link: `/a/trainers/${s("trainerId")}` }; }
  } catch { /* ignore */ }
  return { about: "", link: null };
}

export async function auditCall(action: string, args: Record<string, unknown> = {}, who?: { name: string; role: string; userId?: string | null }) {
  if (isDemo()) return;
  try {
    const v = who ? null : await getViewer();
    const person = who || (v ? { name: v.name, role: v.role, userId: v.userId } : null);
    const c = await context(args);
    await serviceClient().from("audit_log").insert({
      user_id: person?.userId || null, who: person?.name || "Someone (not signed in)", role: person?.role || null,
      action: LABEL[action] || action, detail: [c.about, describe(args)].filter(Boolean).join(" · ").slice(0, 1000) || null, link: c.link
    });
  } catch { /* the log must never stop the action */ }
}
