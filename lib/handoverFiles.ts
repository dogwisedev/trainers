import "server-only";
import { serviceClient } from "./supabase";
import { getReport } from "./reportData";
import { items, s } from "./reports";
import { driveUrl } from "./reportDoc";
import { handoverPdf } from "./handoverPdf";
import { certificatePdf } from "./certificatePdf";
import { programFor } from "./programs";
import { photoBytes } from "./drive";

type Rep = NonNullable<Awaited<ReturnType<typeof getReport>>>;
/** The client's handover report and certificate PDFs, built from the report as it stands. */
export async function handoverFiles(b: Rep, to: string) {
  const svc = serviceClient(), a = b.report.answers, m = b.report.media || [];
  const long = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
  const today = new Date().toISOString().slice(0, 10);
  const dog = s(a.dogName) || b.booking.dog_name || "your dog", trainer = s(a.trainerName) || b.trainer.name;
  const program = programFor(s(a.program)) || programFor(b.booking.program) || s(a.program) || b.booking.program || "Dogwise program";
  const { data: chat } = await svc.from("chats").select("id").eq("deal_key", b.booking.hubspot_deal_id || b.booking.id).maybeSingle();
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  const chatUrl = chat ? `${site}/c/${chat.id}` : `${site}/c`;
  const videos = (slot: "training" | "homework") => m.filter((x) => x.slot === slot && x.kind === "video").map((x) => ({ label: x.description || x.name, url: driveUrl(x.id) }));
  const ph = m.find((x) => x.slot === "health" && x.kind === "photo");
  const pdf = await handoverPdf({
    dog, client: s(a.clientName), trainer, program, location: s(a.clientLocation), contact: to,
    start: long(b.booking.start_date), end: long(b.booking.end_date), date: long(today),
    goals: s(a.goals), training: items(a.training).filter((i) => i.title || i.text), homework: items(a.homework).filter((i) => i.title || i.text),
    trainingVideos: videos("training"), homeworkVideos: videos("homework"),
    health: s(a.healthAtHandover), extra: s(a.extra), review: s(a.overall), photo: ph ? await photoBytes(ph.id) : null, chatUrl
  });
  const cert = await certificatePdf({ dog, program, trainer, date: long(today) });
  return { pdf, cert, dog, program, trainer, chatUrl, reportName: `Handover Report - ${dog}.pdf`, certName: `Certificate - ${dog} - ${program}.pdf` };
}
