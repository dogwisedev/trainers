import { requireRole } from "@/lib/data";
import { DogProfilePage } from "@/components/DogProfilePage";

export const maxDuration = 60; // reads and writes HubSpot
export default async function Page({ params, searchParams }: { params: { id: string }; searchParams: { dog?: string } }) {
  await requireRole("client");
  return <DogProfilePage chatId={params.id} dog={searchParams.dog} back={`/c/${params.id}`} />;
}
