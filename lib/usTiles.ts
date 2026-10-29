// A tile map of the US: every state (and DC) as one square on a grid, so a map works on a phone and needs no map data.
// Columns left to right, rows top to bottom, roughly where the state sits.
export const US_TILES: { st: string; name: string; col: number; row: number }[] = [
  { st: "AK", name: "Alaska", col: 0, row: 0 }, { st: "ME", name: "Maine", col: 11, row: 0 },
  { st: "VT", name: "Vermont", col: 10, row: 1 }, { st: "NH", name: "New Hampshire", col: 11, row: 1 },
  { st: "WA", name: "Washington", col: 1, row: 2 }, { st: "ID", name: "Idaho", col: 2, row: 2 }, { st: "MT", name: "Montana", col: 3, row: 2 }, { st: "ND", name: "North Dakota", col: 4, row: 2 }, { st: "MN", name: "Minnesota", col: 5, row: 2 }, { st: "IL", name: "Illinois", col: 6, row: 2 }, { st: "WI", name: "Wisconsin", col: 7, row: 2 }, { st: "MI", name: "Michigan", col: 8, row: 2 }, { st: "NY", name: "New York", col: 9, row: 2 }, { st: "RI", name: "Rhode Island", col: 10, row: 2 }, { st: "MA", name: "Massachusetts", col: 11, row: 2 },
  { st: "OR", name: "Oregon", col: 1, row: 3 }, { st: "NV", name: "Nevada", col: 2, row: 3 }, { st: "WY", name: "Wyoming", col: 3, row: 3 }, { st: "SD", name: "South Dakota", col: 4, row: 3 }, { st: "IA", name: "Iowa", col: 5, row: 3 }, { st: "IN", name: "Indiana", col: 6, row: 3 }, { st: "OH", name: "Ohio", col: 7, row: 3 }, { st: "PA", name: "Pennsylvania", col: 8, row: 3 }, { st: "NJ", name: "New Jersey", col: 9, row: 3 }, { st: "CT", name: "Connecticut", col: 10, row: 3 },
  { st: "CA", name: "California", col: 1, row: 4 }, { st: "UT", name: "Utah", col: 2, row: 4 }, { st: "CO", name: "Colorado", col: 3, row: 4 }, { st: "NE", name: "Nebraska", col: 4, row: 4 }, { st: "MO", name: "Missouri", col: 5, row: 4 }, { st: "KY", name: "Kentucky", col: 6, row: 4 }, { st: "WV", name: "West Virginia", col: 7, row: 4 }, { st: "VA", name: "Virginia", col: 8, row: 4 }, { st: "MD", name: "Maryland", col: 9, row: 4 }, { st: "DE", name: "Delaware", col: 10, row: 4 },
  { st: "AZ", name: "Arizona", col: 2, row: 5 }, { st: "NM", name: "New Mexico", col: 3, row: 5 }, { st: "KS", name: "Kansas", col: 4, row: 5 }, { st: "AR", name: "Arkansas", col: 5, row: 5 }, { st: "TN", name: "Tennessee", col: 6, row: 5 }, { st: "NC", name: "North Carolina", col: 7, row: 5 }, { st: "SC", name: "South Carolina", col: 8, row: 5 }, { st: "DC", name: "Washington, DC", col: 9, row: 5 },
  { st: "OK", name: "Oklahoma", col: 4, row: 6 }, { st: "LA", name: "Louisiana", col: 5, row: 6 }, { st: "MS", name: "Mississippi", col: 6, row: 6 }, { st: "AL", name: "Alabama", col: 7, row: 6 }, { st: "GA", name: "Georgia", col: 8, row: 6 },
  { st: "HI", name: "Hawaii", col: 0, row: 7 }, { st: "TX", name: "Texas", col: 4, row: 7 }, { st: "FL", name: "Florida", col: 9, row: 7 }
];
export const US_COLS = 12, US_ROWS = 8;
const KNOWN = new Set(US_TILES.map((t) => t.st));
/** The state in a deal name like "Monica Anderson, Pittsburg, CA, 94565" (the last two-letter state), or null. */
export function stateOf(dealName: string | null | undefined): string | null {
  const m = [...String(dealName || "").matchAll(/(?:^|,|\s)([A-Z]{2})(?=\s*(?:,|\s+\d{5}|$))/g)].map((x) => x[1]).filter((x) => KNOWN.has(x));
  return m.length ? m[m.length - 1] : null;
}
