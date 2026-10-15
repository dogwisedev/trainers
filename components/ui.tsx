import Link from "next/link";
import { PawPrint } from "lucide-react";

// Initials avatars: a few brand tints, picked from the name so a person always gets the same one
const TONES = ["bg-lav text-white", "bg-paper text-ink", "bg-ink text-white", "bg-biscuit-wash text-[#6E5338]", "bg-fern text-white"];
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const initials = name.replace(/["']/g, "").split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w)).slice(0, 2).map((s) => s[0]).join("").toUpperCase() || "?";
  const tone = TONES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % TONES.length];
  return (
    <span className={`inline-grid shrink-0 place-items-center rounded-full font-bold tracking-tight ring-2 ring-white ${tone}`} style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden>
      {initials}
    </span>
  );
}

export function Pill({ children, tone = "mint" }: { children: React.ReactNode; tone?: "mint" | "biscuit" | "heart" | "ink" | "line" }) {
  const t = { mint: "bg-paper text-fern", biscuit: "bg-biscuit-wash text-[#7A5418]", heart: "bg-heart-wash text-heart", ink: "bg-ink text-white", line: "bg-white text-ink-soft border border-line" }[tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${t}`}>{children}</span>;
}

export function Section({ title, action, children, className = "" }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`mt-7 ${className}`}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="text-[20px] font-extrabold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children, href, cta }: { title: string; children?: React.ReactNode; href?: string; cta?: string }) {
  return (
    <div className="rounded-[20px] border border-dashed border-lav/40 bg-white/70 px-6 py-8 text-center">
      <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-paper text-lav" aria-hidden><PawPrint size={22} /></span>
      <p className="font-bold">{title}</p>
      {children && <p className="mt-1 text-[14px] text-ink-soft">{children}</p>}
      {href && cta && <Link href={href} className="btn-mint mt-4">{cta}</Link>}
    </div>
  );
}

export function DemoBanner() {
  return (
    <div className="bg-biscuit-wash px-4 py-2 text-center text-[13px] text-[#8A5A00]">
      Demo mode with today&apos;s sheet data. Changes won&apos;t save until Supabase is connected.
    </div>
  );
}

/** A small rounded-square icon "tag" at the start of a list row. */
export function IconTile({ children, tone = "lav" }: { children: React.ReactNode; tone?: "lav" | "heart" | "biscuit" | "ink" | "paper" }) {
  const t = { lav: "bg-paper text-lav-deep", heart: "bg-heart-wash text-heart", biscuit: "bg-biscuit-wash text-[#7A5418]", ink: "bg-ink text-white", paper: "bg-paper text-ink-soft" }[tone];
  return <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[14px] ${t}`} aria-hidden>{children}</span>;
}
