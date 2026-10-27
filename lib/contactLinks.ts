// Tap-to-act links for a client's details (safe in the browser and on the server).

/** Google Maps directions from wherever the phone is now to this address (no origin = "your location"). */
export const directionsUrl = (address: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
const digits = (p: string) => p.replace(/[^\d+]/g, "");
export const telHref = (p: string) => (digits(p).replace(/\D/g, "").length >= 7 ? `tel:${digits(p)}` : null);
export const smsHref = (p: string) => (digits(p).replace(/\D/g, "").length >= 7 ? `sms:${digits(p)}` : null);

export type ClientContact = { name: string; phone: string; email: string; address: string };
/** From the client's before-training answers (the HubSpot contact): "5195 Fontaine Blvd, Colorado Springs, CO 80911". */
export function contactFrom(c: Record<string, unknown> | null | undefined, fallbackName = ""): ClientContact {
  const s = (k: string) => String(c?.[k] ?? "").trim();
  const cityLine = [s("city"), [s("state"), s("zip")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return {
    name: [s("firstname"), s("lastname")].filter(Boolean).join(" ") || fallbackName,
    phone: s("phone") || s("mobilephone"), email: s("email"),
    address: [s("address"), cityLine].filter(Boolean).join(", ")
  };
}
