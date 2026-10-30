import { normName } from "./pretrainingFields";

// Dog names come from the HubSpot deal (Dog 1, Dog 2…). Two mistakes keep happening when sales fill them in:
//  - two dogs typed into one box ("Francesca & Jack"), so the app books one dog with both names
//  - the owner's name typed as the dog's ("William Smith")
// Each one becomes a To do item ("Fix in HubSpot" or "Keep dog name"). Pure, so it's easy to test.

export type DogNameProblem = "two" | "person";

/** "Spot & Tuffy", "Spot, Tuffy", "Spot and Tuffy", "Spot + Tuffy", "Spot/Tuffy" → two dogs. */
export const splitDogNames = (s: string) => s.split(/\s*(?:,|&|\+|\/|\n|\band\b)\s*/i).map((x) => x.trim()).filter(Boolean);

/** Why this dog name looks wrong, or null if it looks fine. */
export function dogNameProblem(name: string, client: { first?: string | null; last?: string | null }): DogNameProblem | null {
  const n = String(name || "").replace(/\s+/g, " ").trim();
  if (!n) return null;
  if (splitDogNames(n).length > 1) return "two";
  const words = normName(n).split(" ").filter(Boolean), first = normName(client.first), last = normName(client.last);
  // Two or more words with the client's surname in it ("William Smith" for a Smith), or exactly the client's full name
  if (words.length >= 2 && ((first && last && words.join(" ") === `${first} ${last}`) || (last.length > 1 && words.includes(last)))) return "person";
  return null;
}

/** One To do item per deal and name. A name an admin chose to keep is never flagged again. */
export const dogNameRef = (dealId: string, name: string) => `dogname:${dealId}:${normName(name).replace(/ /g, "-").slice(0, 80)}`;
