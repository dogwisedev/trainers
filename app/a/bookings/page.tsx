import { redirect } from "next/navigation";

// Bookings are now "Dogs".
export default function Bookings({ searchParams }: { searchParams: Record<string, string> }) {
  const qs = new URLSearchParams(searchParams).toString();
  redirect(qs ? `/a/dogs?${qs}` : "/a/dogs");
}
