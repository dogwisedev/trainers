import { requireRole } from "@/lib/data";
import { TrainerForm } from "@/components/forms";

export default async function NewTrainer() {
  await requireRole("admin");
  return (
    <>
      <h1 className="text-[30px] font-extrabold">Add a trainer</h1>
      <p className="mb-5 mt-1 text-ink-soft">Save the profile first, then send their login from the profile page.</p>
      <TrainerForm t={{ capacity: 2, range_miles: 100 }} admin />
    </>
  );
}
