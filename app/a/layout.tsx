import { Shell } from "@/components/Shell";
import { listThreads, requireRole } from "@/lib/data";
import { pendingReportCount } from "@/lib/reportData";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const v = await requireRole("admin");
  const unread = (await listThreads()).reduce((n, t) => n + t.unread, 0);
  const reportsToReview = await pendingReportCount();
  return (
    <Shell who={v.name} demo={v.demo} accountHref="/a/account" needsPassword={v.passwordSet === false} nav={[
      { href: "/a", label: "Overview", icon: "grid" },
      { href: "/a/trainers", label: "Trainers", icon: "users" },
      { href: "/a/reports", label: "Reports", icon: "reports", badge: reportsToReview },
      { href: "/a/messages", label: "Messages", icon: "messages", badge: unread }
    ]}>{children}</Shell>
  );
}
