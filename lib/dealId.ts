// A HubSpot deal ID as the app stores it: digits only. People paste the deal's whole web address
// (https://app.hubspot.com/contacts/<portal>/record/0-3/<deal id>/) or "Deal 123", so take the deal's number from it.
export function cleanDealId(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return s;
  const fromUrl = s.match(/record\/0-3\/(\d+)/) || s.match(/\/deal\/(\d+)/i);
  if (fromUrl) return fromUrl[1];
  const runs = s.match(/\d{6,}/g);            // otherwise the longest long number in it (portal ids are shorter than deal ids)
  return runs ? runs.sort((a, b) => b.length - a.length)[0] : s;
}
