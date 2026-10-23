import { Shell } from "@/components/Shell";
import { TrainerTour } from "@/components/TrainerTour";
import { requireRole, unreadForTrainer } from "@/lib/data";
import { unreadChats } from "@/lib/chatData";

export default async function TrainerLayout({ children }: { children: React.ReactNode }) {
  const v = await requireRole("trainer");
  const [teamUnread, chatsUnread] = await Promise.all([v.trainerId ? unreadForTrainer(v.trainerId) : 0, unreadChats(v)]);
  const unread = teamUnread + chatsUnread;
  return (
    <Shell who={v.name} demo={v.demo} accountHref="/t/profile#password" needsPassword={v.passwordSet === false} nav={[
      { href: "/t", label: "Home", icon: "home" },
      { href: "/t/calendar", label: "Calendar", icon: "calendar" },
      { href: "/t/chats", label: "Chats", icon: "messages", badge: unread, also: ["/t/messages"] },
      { href: "/t/pay", label: "Pay", icon: "pay" },
      { href: "/t/profile", label: "Profile", icon: "profile" }
    ]}><TrainerTour />{children}</Shell>
  );
}
