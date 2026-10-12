import { requireRole } from "@/lib/data";
import { DriveUploadTest } from "@/components/DriveUploadTest";

export default async function DriveTest() {
  await requireRole("admin");
  return (
    <>
      <h1 className="text-[30px] font-extrabold">Drive upload test</h1>
      <p className="mb-5 mt-1 text-ink-soft">Checks that photos and videos can go straight from a phone into the Dogwise Shared Drive. Files land in a folder called &ldquo;Upload tests&rdquo;.</p>
      <DriveUploadTest />
    </>
  );
}
