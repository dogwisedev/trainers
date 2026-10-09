import { Shell } from "@/components/Shell";
import { requireRole, unreadForTrainer } from "@/lib/data";

export default async function TrainerLayout({ children }: { children: React.ReactNode }) {
  const v = await requireRole("trainer");
  const unread = v.trainerId ? await unreadForTrainer(v.trainerId) : 0;
  return (
    <Shell who={v.name} demo={v.demo} nav={[
      { href: "/t", label: "Home", icon: "home" },
      { href: "/t/calendar", label: "Calendar", icon: "calendar" },
      { href: "/t/messages", label: "Messages", icon: "messages", badge: unread },
      { href: "/t/pay", label: "Pay", icon: "pay" },
      { href: "/t/profile", label: "Profile", icon: "profile" }
    ]}>{children}</Shell>
  );
}
