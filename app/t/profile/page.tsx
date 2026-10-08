import { getTrainer, requireRole } from "@/lib/data";
import { PasswordForm, TrainerForm } from "@/components/forms";
import { Avatar, Section } from "@/components/ui";

export default async function TrainerProfile() {
  const v = await requireRole("trainer");
  const t = v.trainerId ? await getTrainer(v.trainerId) : null;
  if (!t) return null;
  return (
    <>
      <div className="flex items-center gap-4">
        <Avatar name={t.name} size={64} />
        <div><h1 className="text-[28px] font-extrabold leading-tight">{t.name}</h1><p className="text-ink-soft">{[t.city, t.state].filter(Boolean).join(", ")}</p></div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 text-[14px]">
        <div className="panel p-4"><p className="text-ink-soft">Dogs at one time</p><p className="text-[20px] font-bold">{t.capacity}</p></div>
        <div className="panel p-4"><p className="text-ink-soft">Driving range</p><p className="font-bold">{t.range_text || `${t.range_miles} miles`}</p></div>
        <div className="panel col-span-2 p-4"><p className="text-ink-soft">Programs</p><p className="font-semibold">{t.programs || "Not set"}</p></div>
      </div>
      <p className="mt-3 text-[13px] text-ink-faint">Need your capacity, range or programs changed? Message the Dogwise team.</p>
      <Section title="Your details"><TrainerForm t={t} admin={false} /></Section>
      <Section title="Password"><div className="panel p-4"><PasswordForm /></div></Section>
    </>
  );
}
