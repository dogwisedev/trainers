import { redirect } from "next/navigation";
import { getViewer } from "@/lib/data";
import { isDemo, serverClient } from "@/lib/supabase";

export default async function Home() {
  const v = await getViewer();
  if (v) redirect(v.role === "admin" ? "/a" : "/t");
  // Signed in but no profile yet: say so instead of bouncing to the login screen.
  if (!isDemo()) {
    const { data: { user } } = await serverClient().auth.getUser();
    if (user) redirect(`/login?error=noprofile&detail=${encodeURIComponent(user.email || "")}`);
  }
  redirect("/login");
}
