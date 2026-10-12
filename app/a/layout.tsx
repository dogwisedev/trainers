import { Shell } from "@/components/Shell";
import { requireRole, unreadForAdmin } from "@/lib/data";
import { unreadChats } from "@/lib/chatData";
import { pendingReportCount } from "@/lib/reportData";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const v = await requireRole("admin");
  const [unread, reportsToReview, chatsUnread] = await Promise.all([unreadForAdmin(), pendingReportCount(), unreadChats(v)]);
  return (
    <Shell who={v.name} demo={v.demo} accountHref="/a/account" needsPassword={v.passwordSet === false} nav={[
      { href: "/a", label: "Overview", icon: "grid" },
      { href: "/a/trainers", label: "Trainers", icon: "users" },
      { href: "/a/reports", label: "Reports", icon: "reports", badge: reportsToReview },
      { href: "/a/chats", label: "Chats", icon: "chats", badge: chatsUnread },
      { href: "/a/messages", label: "Team", icon: "messages", badge: unread }
    ]}>{children}</Shell>
  );
}
