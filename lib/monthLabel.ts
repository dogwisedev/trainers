/** "October 2026" for a "2026-10" month. Plain, so both server and client files can use it. */
export const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
