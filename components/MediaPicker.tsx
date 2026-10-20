"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Camera, Trash2, Video } from "lucide-react";
import { ChatMediaOption, listChatMediaAction } from "@/app/report-actions";
import { MediaItem } from "@/lib/reports";
import { driveThumb } from "@/lib/chatTypes";

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Pick photos or videos that are already in the dog's chat. Nothing is uploaded again: it's all in Drive already. */
export function MediaPicker({ bookingId, slot, kind, label, items, onChange, describe, chatHref }: {
  bookingId: string; slot: MediaItem["slot"]; kind: "video" | "photo"; label: string; items: MediaItem[]; onChange: (m: MediaItem[]) => void; describe: boolean; chatHref: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ChatMediaOption[] | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const mine = items.filter((m) => m.slot === slot);
  const choices = (options || []).filter((o) => o.kind === kind);
  const picked = (id: string) => mine.some((m) => m.id === id);
  const toggle = (o: ChatMediaOption) =>
    onChange(picked(o.id) ? items.filter((m) => !(m.slot === slot && m.id === o.id)) : [...items, { id: o.id, name: o.name, kind: o.kind, slot, sig: o.sig, size: o.size, description: "" }]);
  const show = () => start(async () => { const r = await listChatMediaAction(bookingId); setOptions(r.items); setNote(r.message || ""); setOpen(true); });

  return (
    <div className="mt-3 rounded-2xl border border-dashed border-line bg-paper p-3">
      <p className="text-[13px] font-semibold text-ink-soft">{label}</p>
      {mine.length > 0 && (
        <ul className="mt-2 space-y-2">
          {mine.map((m) => (
            <li key={`${m.slot}-${m.id}`} className="rounded-xl bg-white p-2.5">
              <div className="flex items-center gap-2.5 text-[14px]">
                {m.kind === "photo"
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={driveThumb(m.id)} alt="" referrerPolicy="no-referrer" className="h-11 w-11 shrink-0 rounded-lg bg-paper object-cover" />
                  : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-paper"><Video size={18} /></span>}
                <span className="min-w-0 flex-1 truncate font-semibold">{m.name}</span>
                <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint hover:bg-heart-wash hover:text-heart" aria-label={`Remove ${m.name}`} onClick={() => toggle({ id: m.id, name: m.name, kind: m.kind, size: m.size, at: "", by: "", sig: m.sig || "" })}><Trash2 size={16} /></button>
              </div>
              {describe && <input className="field mt-2 py-2 text-[14px]" placeholder="What is this video showing? (optional)" value={m.description || ""} onChange={(e) => onChange(items.map((x) => (x.slot === m.slot && x.id === m.id ? { ...x, description: e.target.value } : x)))} />}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn-ghost mt-2 h-10 min-h-0 px-3 text-[14px]" disabled={pending} onClick={() => (open ? setOpen(false) : show())}>
        {kind === "video" ? <Video size={16} /> : <Camera size={16} />}{pending ? "Loading…" : open ? "Done" : mine.length ? `Choose ${kind === "video" ? "videos" : "photos"} from the chat` : `Choose ${kind === "video" ? "a video" : "a photo"} from the chat`}
      </button>
      {open && (
        <div className="mt-2 rounded-xl bg-white p-2">
          {choices.length ? (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {choices.map((o) => (
                <li key={o.id}>
                  <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-paper">
                    <input type="checkbox" className="h-5 w-5 shrink-0 accent-[#2A1971]" checked={picked(o.id)} onChange={() => toggle(o)} />
                    {o.kind === "photo"
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={driveThumb(o.id)} alt="" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-md bg-paper object-cover" />
                      : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-paper"><Video size={16} /></span>}
                    <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold">{o.name}</span><span className="text-[12px] text-ink-faint">{o.by ? `${o.by}, ` : ""}{when(o.at)}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-2 text-[14px] text-ink-soft">{note || `No ${kind === "video" ? "videos" : "photos"} in the chat yet.`} {chatHref && !note.startsWith("This dog has no chat") && <>Post them in <Link prefetch={false} href={chatHref} className="font-semibold underline">the dog&apos;s chat</Link>, then come back.</>}</p>
          )}
        </div>
      )}
    </div>
  );
}
