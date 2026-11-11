// How much a person changed what the AI wrote, for the approval rates (Pulse → Office → AI help). A typo fixed, a word
// swapped or a sentence tidied is "minor" and counts as agreeing with the AI; "major" counts as a correction.
// Pure functions: used on the server and in tests.

export type Change = "none" | "minor" | "major";
/** Above this share of the words kept, in order, a text change is minor. */
export const MINOR_TEXT = 0.85;

const wordsOf = (s: unknown) => String(s ?? "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);

/** How much of the AI's text (a) survives in the final one (b), in order, 0 to 1. Words the person only added don't count
 *  against it: adding to the AI's text isn't disagreeing with it. */
export function sameness(a: unknown, b: unknown): number {
  const x = wordsOf(a), y = wordsOf(b);
  if (!x.length && !y.length) return 1;
  if (!x.length || !y.length) return 0;
  // Longest common subsequence of words (texts here are short: a message or a form answer)
  const prev = new Array(y.length + 1).fill(0), cur = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    for (let j = 0; j <= y.length; j++) prev[j] = cur[j];
  }
  return prev[y.length] / x.length;
}

/** A text the AI wrote against what was finally sent or saved. */
export function textChange(ai: unknown, final: unknown): Change {
  if (wordsOf(ai).join(" ") === wordsOf(final).join(" ")) return "none";
  return sameness(ai, final) >= MINOR_TEXT ? "minor" : "major";
}

type Item = { title?: string; text?: string };
const asItems = (v: unknown): Item[] => (Array.isArray(v) ? v.filter((i) => i && typeof i === "object") as Item[] : []);

/** A form before and after an admin's edits. Any change to a yes/no, a choice, a number or a date is major (it changes the
 *  facts); text and lists are judged by how much of the wording survived. */
export function answersChange(before: Record<string, unknown>, after: Record<string, unknown>): Change {
  let worst: Change = "none";
  const bump = (c: Change) => { if (c === "major" || (c === "minor" && worst === "none")) worst = c; };
  for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    const a = before?.[k], b = after?.[k];
    if (JSON.stringify(a ?? "") === JSON.stringify(b ?? "")) continue;
    if (Array.isArray(a) || Array.isArray(b)) {
      const ia = asItems(a), ib = asItems(b);
      if (ia.length || ib.length) { // training / homework items
        if (ia.length !== ib.length) { bump("major"); continue; }
        ia.forEach((it, n) => bump(textChange(`${it.title} ${it.text}`, `${ib[n]?.title} ${ib[n]?.text}`)));
      } else bump("major"); // a multiple choice
      continue;
    }
    const isText = typeof a === "string" && typeof b === "string" && (a.length > 24 || b.length > 24 || /\s/.test(`${a}${b}`));
    bump(isText ? textChange(a, b) : "major");
  }
  return worst;
}
