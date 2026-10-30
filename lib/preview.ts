// Pulse (the dashboard) is a preview: only the emails in PULSE_EMAILS (default alma@dogwiseacademy.com) can open it.
export function canSeePulse(email: string | null | undefined): boolean {
  const allowed = (process.env.PULSE_EMAILS || "alma@dogwiseacademy.com").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return !!email && allowed.includes(email.trim().toLowerCase());
}
