import { listMessages, requireRole } from "@/lib/data";
import { MessageThread } from "@/components/MessageThread";

export default async function TrainerMessages() {
  const v = await requireRole("trainer");
  if (!v.trainerId) return null;
  const msgs = await listMessages(v.trainerId);
  return (
    <>
      <h1 className="text-[30px] font-extrabold">Dogwise team</h1>
      <p className="mb-5 mt-1 text-ink-soft">Questions about a dog, pickups or your calendar. The team sees this straight away.</p>
      <MessageThread trainerId={v.trainerId} initial={msgs} me="trainer" otherName="the Dogwise team" />
    </>
  );
}
