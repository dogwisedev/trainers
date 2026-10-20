import { requireRole } from "@/lib/data";
import { PasswordForm } from "@/components/forms";
import { AppSetup } from "@/components/AppSetup";

export default async function SalesAccount() {
  const v = await requireRole("sales");
  return (
    <>
      <h1 className="text-[30px] font-extrabold">Your account</h1>
      <p className="mb-5 mt-1 text-ink-soft">{v.name}{v.email ? `, ${v.email}` : ""}</p>
      <div className="max-w-md"><AppSetup always /></div>
      <div className="panel max-w-md p-4 md:p-5">
        <h2 className="mb-3 text-[17px] font-bold">{v.passwordSet === false ? "Set a password" : "Change password"}</h2>
        <PasswordForm />
        <p className="mt-3 text-[13px] text-ink-faint">Forgotten it? On the sign-in page, enter your email and leave the password empty: you&apos;ll get a sign-in link, then set a new password here.</p>
      </div>
    </>
  );
}
