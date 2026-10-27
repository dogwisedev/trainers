import { Mail, MapPin, MessageSquare, Navigation, Phone } from "lucide-react";
import { ClientContact, directionsUrl, smsHref, telHref } from "@/lib/contactLinks";

/** The client, one tap away: directions from where you are, call, text, email. Mobile first. */
export function ClientCard({ c, dogs }: { c: ClientContact; dogs?: string }) {
  const tel = c.phone ? telHref(c.phone) : null, sms = c.phone ? smsHref(c.phone) : null;
  return (
    <section className="panel overflow-hidden" aria-label="Client">
      <div className="p-4">
        <p className="text-caption font-bold uppercase tracking-wide text-ink-faint">Client{dogs ? ` · ${dogs}` : ""}</p>
        <p className="mt-0.5 text-h3 font-extrabold">{c.name || "Client"}</p>
        {c.address
          ? <p className="mt-1 flex items-start gap-1.5 text-body text-ink-soft"><MapPin size={16} className="mt-0.5 shrink-0" />{c.address}</p>
          : <p className="mt-1 text-body text-ink-faint">No address in the client&apos;s forms yet.</p>}
      </div>
      <div className="grid gap-2 px-4 pb-4">
        {c.address && (
          <a href={directionsUrl(c.address)} target="_blank" rel="noopener" className="btn-ink w-full justify-center text-lead">
            <Navigation size={18} />Directions from where you are
          </a>
        )}
        <div className="grid grid-cols-3 gap-2">
          <a href={tel || undefined} aria-disabled={!tel} className={`btn-ghost min-h-[48px] justify-center ${tel ? "" : "pointer-events-none opacity-40"}`}><Phone size={17} />Call</a>
          <a href={sms || undefined} aria-disabled={!sms} className={`btn-ghost min-h-[48px] justify-center ${sms ? "" : "pointer-events-none opacity-40"}`}><MessageSquare size={17} />Text</a>
          <a href={c.email ? `mailto:${c.email}` : undefined} aria-disabled={!c.email} className={`btn-ghost min-h-[48px] justify-center ${c.email ? "" : "pointer-events-none opacity-40"}`}><Mail size={17} />Email</a>
        </div>
        {c.phone && <p className="text-center text-small text-ink-soft">{c.phone}</p>}
      </div>
    </section>
  );
}
