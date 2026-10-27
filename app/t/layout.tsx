import { Shell } from "@/components/Shell";
import { TrainerTour } from "@/components/TrainerTour";
import { requireRole, unreadForTrainer } from "@/lib/data";
import { unreadChats } from "@/lib/chatData";
import { listTodos } from "@/lib/reportData";

export default async function TrainerLayout({ children }: { children: React.ReactNode }) {
  const v = await requireRole("trainer");
  const [teamUnread, chatsUnread, formsDue] = await Promise.all([
    v.trainerId ? unreadForTrainer(v.trainerId) : 0, unreadChats(v),
    // Forms open, due or late: the red number on the Reports tab
    v.trainerId ? listTodos({ trainerId: v.trainerId }).then((t) => t.filter((x) => x.state !== "waiting").length).catch(() => 0) : 0
  ]);
  const unread = teamUnread + chatsUnread;
  return (
    <Shell who={v.name} demo={v.demo} accountHref="/t/profile#password" needsPassword={v.passwordSet === false} headerActions={false} tourHome="/t" nav={[
      { href: "/t", label: "Today", icon: "home", also: ["/t/calendar", "/t/dogs"] },
      { href: "/t/chats", label: "Chats", icon: "messages", badge: unread, also: ["/t/messages"] },
      { href: "/t/reports", label: "Forms", icon: "reports", badge: formsDue },
      { href: "/t/profile", label: "Me", icon: "profile", also: ["/t/pay", "/t/past", "/t/followup", "/t/followups"] }
    ]}><TrainerTour />{children}</Shell>
  );
}
