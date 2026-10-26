import Link from "next/link";

/** Admin Chats: one switch between client chats and trainer messages, each with its unread count. */
export function ChatsSwitch({ on, clientUnread, trainerUnread }: { on: "clients" | "trainers"; clientUnread: number; trainerUnread: number }) {
  const tabs = [
    { key: "clients", href: "/a/chats", label: "Client chats", n: clientUnread },
    { key: "trainers", href: "/a/messages", label: "Trainer messages", n: trainerUnread }
  ] as const;
  return (
    <nav className="mb-4 grid grid-cols-2 rounded-2xl border border-line bg-white p-1 text-body font-semibold shadow-card sm:inline-grid sm:w-auto" aria-label="Chats">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={on === t.key ? "page" : undefined}
          className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 ${on === t.key ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}>
          {t.label}
          {t.n > 0 && <span className={`grid h-[20px] min-w-[20px] place-items-center rounded-full px-1.5 text-micro font-bold ${on === t.key ? "bg-white text-ink" : "bg-heart text-white"}`}>{t.n}</span>}
        </Link>
      ))}
    </nav>
  );
}
