import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { getTrainer, listBookings, listTimeOff, requireRole } from "@/lib/data";
import { soonestOpening, utilisation, weekUsage } from "@/lib/capacity";
import { addDays, range, short, todayIso, weekStart, weeksFrom } from "@/lib/dates";
import { clearFlag, inviteTrainer, setBookingStatus, setTrainerActive } from "@/app/actions";
import { KennelLegend, KennelStrip } from "@/components/KennelStrip";
import { ActionButton, DeleteTimeOff, ExtraDays, TimeOffForm, TrainerForm } from "@/components/forms";
import { Avatar, Pill, Section } from "@/components/ui";
import { PayRatesForm } from "@/components/PayRatesForm";
import { getRates } from "@/lib/payrollData";

export default async function TrainerDetail({ params, searchParams }: { params: { id: string }; searchParams: { saved?: string } }) {
  await requireRole("admin");
  const t = await getTrainer(params.id);
  if (!t) notFound();
  const today = todayIso();
  const [bookings, off, rates] = await Promise.all([listBookings({ trainerId: t.id, from: addDays(today, -30) }), listTimeOff({ trainerId: t.id, from: addDays(today, -7) }), getRates(t.id)]);
  const use = weekUsage(t, bookings, off, weeksFrom(today, 16));
  const o2 = soonestOpening(use, 2), o3 = soonestOpening(use, 3);
  const when = (o: string | null) => (!o ? "None in 16 weeks" : o === weekStart(today) ? "Now" : short(o));
  const upcoming = bookings.filter((b) => b.end_date >= today && b.status !== "cancelled");
  const id = t.id;

  return (
    <>
      {searchParams.saved === "booking" && <p className="mb-4 rounded-xl bg-mint-wash px-3 py-2 text-[14px] text-fern">Booking saved.</p>}
      <div className="flex items-start gap-4">
        <Avatar name={t.name} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[28px] font-extrabold leading-tight">{t.name}</h1>
          <p className="mt-0.5 inline-flex items-center gap-1 text-ink-soft"><MapPin size={15} />{[t.city, t.state].filter(Boolean).join(", ") || "No location"}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{t.active ? <Pill>Active</Pill> : <Pill tone="heart">Inactive</Pill>}{t.poc && <Pill tone="line">Contact: {t.poc}</Pill>}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {t.phone && <a href={`tel:${t.phone}`} className="btn-ghost"><Phone size={17} />Call</a>}
        {t.email && <a href={`mailto:${t.email}`} className="btn-ghost"><Mail size={17} />Email</a>}
        <Link href={`/a/messages/${id}`} className="btn-ghost"><MessageCircle size={17} />Message</Link>
      </div>

      <div className="mt-5 rounded-[26px] bg-mint p-4 md:p-6">
        <div className="mb-3 grid grid-cols-3 gap-2 text-center">
          <div><p className="text-[24px] font-extrabold">{t.capacity}</p><p className="text-[12px] text-ink-soft">dogs at once</p></div>
          <div><p className="text-[24px] font-extrabold">{when(o3)}</p><p className="text-[12px] text-ink-soft">3-week opening</p></div>
          <div><p className="text-[24px] font-extrabold">{Math.round(utilisation(use.slice(0, 8)) * 100)}%</p><p className="text-[12px] text-ink-soft">full, next 8 wks</p></div>
        </div>
        <div className="rounded-[20px] bg-white/70 p-4"><KennelStrip use={use} /><KennelLegend /></div>
        <p className="mt-3 text-[13px] text-ink-soft">2-week opening: {when(o2)}. Range: {t.range_text || `${t.range_miles} mi`} (matching uses {t.range_miles} mi).</p>
      </div>

      {t.data_flags?.length > 0 && (
        <Section title="Check these details">
          <ul className="space-y-2">
            {t.data_flags.map((f) => (
              <li key={f} className="flex items-center justify-between gap-3 rounded-xl bg-biscuit-wash px-3.5 py-2.5 text-[14px]">
                <span>{f}</span><ActionButton className="btn-ghost h-9 min-h-0 px-3 text-[13px]" action={clearFlag.bind(null, id, f)}>Checked</ActionButton>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Bookings" action={<Link href={`/a/bookings/new?trainer=${id}`} className="btn-mint h-10 min-h-0 px-3 text-[14px]"><CalendarPlus size={16} />Book a dog</Link>}>
        {upcoming.length ? (
          <ul className="panel divide-y divide-line">
            {upcoming.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div><p className="font-semibold">{b.dog_name || "Dog"} <span className="font-normal text-ink-soft">with {b.client_name}</span></p><p className="text-[14px] text-ink-soft">{range(b.start_date, b.end_date)}, {b.program || `${b.weeks}-week`}{b.extra_days ? ` + ${b.extra_days} day${b.extra_days > 1 ? "s" : ""}` : ""}{b.rehab ? ", rehab" : ""}</p>
                  {b.hubspot_deal_id && <a className="text-[13px] font-semibold text-fern underline" href={`https://app.hubspot.com/contacts/21869370/record/0-3/${b.hubspot_deal_id}`} target="_blank" rel="noopener">HubSpot deal</a>}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <ExtraDays id={b.id} current={b.extra_days || 0} />
                  <Pill tone={b.start_date <= today ? "biscuit" : b.status === "pending" ? "line" : "mint"}>{b.start_date <= today ? "In training" : b.status === "pending" ? "Pending" : "Confirmed"}</Pill>
                  <ActionButton className="btn-danger h-9 min-h-0 px-3 text-[13px]" confirm={`Cancel ${b.dog_name || "this booking"}? The kennel frees up straight away.`} action={setBookingStatus.bind(null, b.id, "cancelled")}>Cancel</ActionButton>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-[14px] text-ink-soft">No upcoming bookings.</p>}
      </Section>

      <Section title="Time off">
        {off.length > 0 && (
          <ul className="panel mb-3 divide-y divide-line">
            {off.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-2 pl-4 pr-2">
                <div><p className="font-semibold">{range(o.start_date, o.end_date)}</p><p className="text-[13px] text-ink-soft">{o.reason}{o.slots_blocked ? `, ${o.slots_blocked} kennel${o.slots_blocked > 1 ? "s" : ""}` : ", whole calendar"}{o.note ? `. ${o.note}` : ""}</p></div>
                <DeleteTimeOff id={o.id} />
              </li>
            ))}
          </ul>
        )}
        <details className="panel p-4"><summary className="cursor-pointer font-semibold">Block dates for {t.name.split(" ")[0]}</summary><div className="mt-4"><TimeOffForm trainerId={id} capacity={t.capacity} /></div></details>
      </Section>


      <Section title="Pay rates (admins only)"><div className="panel p-4 md:p-5"><PayRatesForm trainerId={id} rates={rates} /></div></Section>

      <Section title="Profile"><TrainerForm t={t} admin /></Section>

      <Section title="Login and status">
        <div className="panel flex flex-wrap gap-3 p-4">
          <ActionButton className="btn-ink" action={inviteTrainer.bind(null, id)}>Send login to {t.email || "trainer"}</ActionButton>
          {t.active
            ? <ActionButton className="btn-danger" confirm={`Mark ${t.name} inactive? They disappear from matching and can't sign in to new bookings. History is kept.`} action={setTrainerActive.bind(null, id, false)}>Mark inactive</ActionButton>
            : <ActionButton className="btn-mint" action={setTrainerActive.bind(null, id, true)}>Make active again</ActionButton>}
        </div>
      </Section>
    </>
  );
}
