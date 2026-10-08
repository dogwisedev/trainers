import { redirect } from "next/navigation";
import { getViewer } from "@/lib/data";

export default async function Home() {
  const v = await getViewer();
  redirect(!v ? "/login" : v.role === "admin" ? "/a" : "/t");
}
