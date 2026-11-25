// Messages to trainers, said 75 ways each so they don't read like a machine wrote them. Same meaning every time, soft and
// short, never a telling-off. Each kind has 5 openers, 5 asks and 3 sign-offs, written by hand; every combination is one
// message (5 × 5 × 3 = 75). Which one a trainer gets moves on every time (STRIDE changes the opener, the ask and the
// sign-off together), so two in a row never match and a trainer sees all 75 before one comes back.
// To change the wording, edit the lists: keep 5 / 5 / 3 and keep the {words in braces}. Pure: no database.
export type BankKind = "nudge" | "update_due" | "client_waiting" | "form_late" | "form_ready";
type Bank = { open: string[]; ask: string[]; close: string[] };

export const BANK: Record<BankKind, Bank> = {
  // The text (or email) from the app: open the app, never the details
  nudge: {
    open: ["Hi {first},", "Hey {first},", "Hi {first} 🐾", "{first}, quick one from Dogwise:", "Hello from Dogwise, {first} 🐾"],
    ask: ["a couple of things are waiting for you in the app", "there's a little pile in the app with your name on it", "you've got a few bits to look at in the app", "something in the app could use your eyes", "a few things landed in the app for you"],
    close: ["Whenever you get a sec:", "No rush, when you're between dogs:", "Have a look when you can:"]
  },
  // The office's suggested check-in: no update posted
  update_due: {
    open: ["Hi {first},", "Hey {first},", "{first}, hope the day's going well.", "Hi {first}, quick one.", "Hey {first}, me again 🐾"],
    ask: ["{client} hasn't seen anything of {dog} since {since}. Could you pop a photo or a short video in {dog}'s chat today?", "it's been quiet in {dog}'s chat since {since} and {client} is keen for news. A quick photo or clip today would be great.", "{client} is missing {dog}! Nothing since {since}. Can you drop an update in the chat today?", "{dog}'s chat hasn't had an update since {since}. Even one photo and a line for {client} today would do it.", "could {client} get a little {dog} update today? The last one was {since}."],
    close: ["Thanks!", "Appreciate it.", "Thank you, shout if anything's up."]
  },
  // The office's suggested check-in: a client is waiting for a reply
  client_waiting: {
    open: ["Hi {first},", "Hey {first},", "{first}, quick one.", "Hi {first}, when you have a minute:", "Hey {first} 🐾"],
    ask: ["{client} has been waiting {wait} for a reply about {dog}. Could you answer in {dog}'s chat?", "there's a message from {client} in {dog}'s chat that's been sitting {wait}. Can you get back to them?", "{client} asked something about {dog} {wait} ago and hasn't heard back yet. Could you reply in the chat?", "{dog}'s chat has a question from {client} waiting {wait}. A quick answer would settle them.", "could you take a look at {client}'s message about {dog}? It's been {wait}."],
    close: ["Thanks!", "Appreciate it.", "Thank you, tell me if you'd like us to step in."]
  },
  // The office's suggested check-in: a form is late
  form_late: {
    open: ["Hi {first},", "Hey {first},", "{first}, quick one.", "Hi {first}, small reminder.", "Hey {first} 🐾"],
    ask: ["{form} for {dog} hasn't come in yet. Could you send it today?", "we're still missing {form} for {dog}. Can you get it over today?", "{form} for {dog} is past its day. Could you fill it in when you're next in the app?", "{form} for {dog} is the one thing we're waiting on. Today if you can?", "could you send {form} for {dog} today? It's showing late on our side."],
    close: ["Thanks!", "Appreciate it.", "Thank you, tell me if something's in the way."]
  },
  // The heading of the app's form reminder (the list of forms follows it)
  form_ready: {
    open: ["Hi {first},", "Hey {first},", "{first},", "Hi {first} 🐾", "Hello {first},"],
    ask: ["your forms are open", "there's a form ready for you", "form time", "a form is waiting for you", "you've got a form to fill in"],
    close: ["here's what's on the list", "nothing scary, here it is", "the details are below"]
  }
};

export const BANK_SIZE = 75;
const STRIDE = 31; // shares no factor with 75, and isn't a multiple of 5 or 3: every step changes all three parts

/** Message number `n` (any whole number) of a kind, before the names go in. */
export function bankTemplate(kind: BankKind, n: number): string {
  const b = BANK[kind], i = (((Math.trunc(n) * STRIDE) % BANK_SIZE) + BANK_SIZE) % BANK_SIZE;
  const open = b.open[i % 5], ask = b.ask[Math.floor(i / 5) % 5], close = b.close[Math.floor(i / 25) % 3];
  const body = ask;
  if (kind === "nudge") return `${open} ${body}. ${close}`;
  if (kind === "form_ready") return `${open} ${body}: ${close}`;
  return `${open} ${body} ${close}`;
}

const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
/** Where this trainer is in the rotation: their own starting point, moved on once per `hours` (a text goes at most every 12). */
export const bankTurn = (who: string, at: Date = new Date(), hours = 12) => hash(who) + Math.floor(at.getTime() / (hours * 3600000));

/** The message, with the names in. Unknown {words} are left out rather than shown. */
export function bankMessage(kind: BankKind, n: number, vars: Record<string, string | number | undefined | null>): string {
  return bankTemplate(kind, n).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? "")).replace(/\s{2,}/g, " ").trim()
    .replace(/([.!?]|\u{1F43E})\s+([a-z])/gu, (_, end: string, c: string) => `${end} ${c.toUpperCase()}`); // a sentence starts with a capital, whatever went in
}
