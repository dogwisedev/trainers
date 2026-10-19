import { Shell } from "@/components/Shell";
import { requireRole } from "@/lib/data";

export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const v = await requireRole("sales");
  return <Shell who={v.name} demo={v.demo} accountHref="/s/account" needsPassword={v.passwordSet === false} nav={[{ href: "/s", label: "My sales", icon: "sales" }]}>{children}</Shell>;
}
