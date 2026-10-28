import { Shell } from "@/components/Shell";
import { requireRole, unreadForAdmin } from "@/lib/data";
import { unreadChats } from "@/lib/chatData";
import { todoCount } from "@/lib/todo";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const v = await requireRole("admin");
  const [unread, chatsUnread, todo] = await Promise.all([unreadForAdmin(), unreadChats(v), todoCount()]);
  return (
    <Shell who={v.name} demo={v.demo} accountHref="/a/account" needsPassword={v.passwordSet === false} nav={[
      { href: "/a", label: "To do", icon: "todo", badge: todo, also: ["/a/reports"] },
      { href: "/a/dogs", label: "Dogs", icon: "paw", also: ["/a/bookings"] },
      { href: "/a/chats", label: "Chats", icon: "chats", badge: chatsUnread + unread, also: ["/a/messages"] },
      { href: "/a/sales", label: "Sales", icon: "sales" },
      { href: "/a/trainers", label: "Trainers", icon: "users" }
    ]}>{children}</Shell>
  );
}
