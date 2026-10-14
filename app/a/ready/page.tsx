import { redirect } from "next/navigation";
// "Before training" is now on each dog's page; dogs starting soon show what's missing in Dogs → Upcoming.
export default function Ready() { redirect("/a/dogs?f=upcoming"); }
