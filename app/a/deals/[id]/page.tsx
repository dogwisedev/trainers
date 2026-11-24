import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, ChevronLeft, ExternalLink } from "lucide-react";
import { requireRole } from "@/lib/data";
import { isDemo } from "@/lib/supabase";
import { dealContacts, readDeals } from "@/lib/hubspot";
import { loadForm } from "@/lib/clientForms";
import { SECTIONS } from "@/lib/pretrainingFields";
import { short } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A deal that's won but not booked yet: what the client has already told us, read-only, with Book this dog. Nothing is
 *  created here (no chat, no booking): it only shows what's already in HubSpot and the client's before-training answers. */
export default async function DealPage({ params }: { params: { id: string } }) {
  await requireRole("admin");
  if (!/^\d+$/.test(params.id) || isDemo()) notFound();
  const id = params.id, hubspot = `https://app.hubspot.com/contacts/21869370/record/0-3/${id}`;
  const [deals, contacts] = await Promise.all([
    readDeals([id], ["dealname", "program_start_date", "training_end_date", "type_of_program_sold", "amount", "client_status", "dog_name", "dog_2_name", "dog_3_name"]).catch(() => new Map()),
    dealContacts([id]).catch(() => new Map<string, string[]>())
  ]);
  const d = (deals.get(id) || {}) as Record<string, string | null>;
  const contactId = (contacts.get(id) || [])[0];
  const form = contactId ? await loadForm(contactId).catch(() => null) : null;
  const day = (v: string | null | undefined) => { const m = String(v || "").match(/^\d{4}-\d{2}-\d{2}/); return m ? short(m[0]) : v && /^\d{10,}$/.test(v) ? short(new Date(Number(v)).toISOString().slice(0, 10)) : ""; };
  const answer = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v));
  const block = (title: string, answers: Record<string, unknown>, scope: "client" | "dog") => {
    const secs = SECTIONS.filter((s) => s.scope === scope && s.id !== "agreement");
    const total = secs.reduce((n, s) => n + s.questions.length, 0), filled = secs.reduce((n, s) => n + s.questions.filter((q) => answer(answers[q.key])).length, 0);
    return (
      <section className="panel overflow-hidden">
        <h2 className="flex items-baseline justify-between gap-3 border-b border-line bg-paper/60 px-4 py-2.5 text-body font-extrabold">{title}<span className="text-small font-normal text-ink-soft">{filled} of {total} answered</span></h2>
        {secs.map((s) => { const got = s.questions.filter((q) => answer(answers[q.key])); return (
          <div key={s.id} className="border-b border-line px-4 py-3 last:border-0">
            <p className="text-small font-bold text-ink-soft">{s.title}</p>
            {got.length ? <dl className="mt-1.5 space-y-1.5">{got.map((q) => <div key={q.key}><dt className="text-caption text-ink-faint">{q.label}</dt><dd className="whitespace-pre-wrap text-body">{answer(answers[q.key])}</dd></div>)}</dl>
              : <p className="mt-1 text-small text-ink-faint">Nothing filled in yet.</p>}
          </div>); })}
      </section>
    );
  };
  return (
    <>
      <Link prefetch={false} href="/a/dogs?f=notbooked" className="mb-3 inline-flex items-center gap-1 text-small font-semibold text-ink-soft hover:text-ink"><ChevronLeft size={16} />Not booked</Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h1 font-extrabold leading-tight">{d.dealname || form?.name || `Deal ${id}`} <span className="ml-1 rounded-full bg-biscuit-wash px-2.5 py-1 align-middle text-small font-semibold text-warn">Not booked</span></h1>
          <p className="mt-1 text-body text-ink-soft">{[d.type_of_program_sold, day(d.program_start_date) && `${day(d.program_start_date)}${day(d.training_end_date) ? ` to ${day(d.training_end_date)}` : ""}`, form?.email].filter(Boolean).join(" · ") || "No dates on the deal yet"}</p>
          <p className="mt-1 text-small text-ink-faint">Won in HubSpot, waiting for a trainer. Nothing here is a booking yet: no chat, no forms, no reminders.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link prefetch={false} href={`/a/bookings/new?deal=${id}`} className="btn-ink h-10 min-h-0 px-4"><CalendarPlus size={16} />Book this dog</Link>
          <a href={hubspot} target="_blank" rel="noopener" className="btn-ghost h-10 min-h-0 px-4">HubSpot deal<ExternalLink size={15} /></a>
        </div>
      </div>
      {!form ? <p className="panel p-5 text-ink-soft">{contactId ? "Couldn't read this client's answers from HubSpot just now. Try again in a minute." : "This deal has no contact in HubSpot, so there are no answers to show."}</p> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {block(`About ${form.name || "the client"}`, form.client, "client")}
          <div className="space-y-4">
            {form.dogs.length ? form.dogs.map((dog) => <div key={dog.key}>{block(dog.name || "Dog", dog.answers, "dog")}{dog.vaccines.length > 0 && <p className="mt-1 px-1 text-small text-ink-soft">{dog.vaccines.length} vaccine file{dog.vaccines.length === 1 ? "" : "s"} sent.</p>}</div>)
              : <p className="panel p-5 text-ink-soft">No dog named on the deal yet.</p>}
          </div>
        </div>
      )}
    </>
  );
}
