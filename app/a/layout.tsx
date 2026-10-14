import { Shell } from "@/components/Shell";
import { requireRole, unreadForAdmin } from "@/lib/data";
import { incidentCount, unreadChats } from "@/lib/chatData";
import { pendingReportCount } from "@/lib/reportData";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const v = await requireRole("admin");
  const [unread, reportsToReview, chatsUnread, incidents] = await Promise.all([unreadForAdmin(), pendingReportCount(), unreadChats(v), incidentCount()]);
  return (
    <Shell who={v.name} demo={v.demo} accountHref="/a/account" needsPassword={v.passwordSet === false} nav={[
      { href: "/a", label: "To do", icon: "todo", badge: incidents + reportsToReview + unread, also: ["/a/reports"] },
      { href: "/a/dogs", label: "Dogs", icon: "paw", also: ["/a/bookings"] },
      { href: "/a/chats", label: "Chats", icon: "chats", badge: chatsUnread + unread, also: ["/a/messages"] },
      { href: "/a/trainers", label: "Trainers", icon: "users" }
    ]}>{children}</Shell>
  );
}
