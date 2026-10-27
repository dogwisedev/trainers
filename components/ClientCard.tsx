import Link from "next/link";
import { MapPin, MessageCircle, Navigation, Phone } from "lucide-react";
import { ClientContact, directionsUrl, telHref } from "@/lib/contactLinks";

/** The client, one tap away: directions from where you are, a call, or a message in the app's chat (not text or email,
 *  so everything stays in one place). Mobile first. */
export function ClientCard({ c, dogs, chatHref }: { c: ClientContact; dogs?: string; chatHref?: string | null }) {
  const tel = c.phone ? telHref(c.phone) : null;
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
        <div className={`grid gap-2 ${chatHref ? "grid-cols-2" : "grid-cols-1"}`}>
          {tel ? <a href={tel} className="btn-ghost min-h-[48px] justify-center"><Phone size={17} />Call</a>
            : <span className="btn-ghost pointer-events-none min-h-[48px] justify-center opacity-40"><Phone size={17} />No phone</span>}
          {chatHref && <Link prefetch={false} href={chatHref} className="btn-ghost min-h-[48px] justify-center"><MessageCircle size={17} />Message</Link>}
        </div>
        {c.phone && <p className="text-center text-small text-ink-soft">{c.phone}</p>}
      </div>
    </section>
  );
}
