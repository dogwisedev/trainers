// A sales manager: a sales login that sees the whole team's Sales screen (as admin does), and nothing else in admin.
// SALES_MANAGER_EMAILS in Vercel, comma-separated.
export function isSalesManager(email: string | null | undefined): boolean {
  const allowed = (process.env.SALES_MANAGER_EMAILS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return !!email && allowed.includes(email.trim().toLowerCase());
}
