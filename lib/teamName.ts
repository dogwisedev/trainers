// How someone in the office is named on a message they write: "Anita, Dogwise team". The first name from their profile; a
// profile with no real name ("Dogwise team", "Dogwise Admin", or just an email address) stays "Dogwise team". The same rule
// as the database uses for chat messages (migration 072), for the places the app writes the name itself.
export function teamName(name: string | null | undefined): string {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  return !first || /^dogwise$/i.test(first) || first.includes("@") ? "Dogwise team" : `${first}, Dogwise team`;
}
