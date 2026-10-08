import { Shell } from "@/components/Shell";
import { listThreads, requireRole } from "@/lib/data";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const v = await requireRole("admin");
  const unread = (await listThreads()).reduce((n, t) => n + t.unread, 0);
  return (
    <Shell who={v.name} demo={v.demo} nav={[
      { href: "/a", label: "Overview", icon: "grid" },
      { href: "/a/trainers", label: "Trainers", icon: "users" },
      { href: "/a/messages", label: "Messages", icon: "messages", badge: unread }
    ]}>{children}</Shell>
  );
}
