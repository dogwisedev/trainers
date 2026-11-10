import "server-only";
import { createHash, randomUUID } from "crypto";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bech32 } from "@scure/base";

// The app's own Buzz account, "Dogwise App": a Buzz agent that Claude reads and writes through (lib/buzzTools.ts).
// The webhooks in lib/buzz.ts can only post, one channel each, and get no message id back; this is a real member, so it
// reads the channels it's in, replies in threads, reacts, edits, DMs and runs channels. It talks to Buzz the way Buzz's
// own CLI does (block/buzz, crates/buzz-cli/src/client.rs): POST /query with Nostr filters and POST /events with signed
// events, every request signed with NIP-98 (kind 27235: u, method, nonce, payload tags, base64 in "Authorization: Nostr …"),
// and the NIP-OA tag that says the key acts for its owner sent in x-auth-tag and added to every event it signs.
// Vercel variables (make the first two with scripts/buzz-agent-key.mjs, see the README):
//   BUZZ_PRIVATE_KEY  the agent's own key (nsec1… or 64 hex). Only ever the agent's, never a person's.
//   BUZZ_AUTH_TAG     ["auth","<owner pubkey>","","<signature>"]: the owner's signed say-so for that key
//   BUZZ_RELAY_URL    https://dogwise-academy.communities.buzz.xyz (the host the webhook URLs use)
// Off until BUZZ_PRIVATE_KEY and BUZZ_RELAY_URL are set. A Buzz problem never touches anything else in the app.

export type NostrEvent = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string };
export type Template = { kind: number; content?: string; tags?: string[][]; created_at?: number };

/** Buzz refused or failed a request. status 0 = no answer (timed out, unreachable). The message is the relay's own words. */
export class BuzzRelayError extends Error { constructor(public status: number, message: string) { super(message); } }
/** Something to fix in Vercel (a missing or wrong variable). */
export class BuzzSetupError extends Error {}
/** A request that can't be sent as asked (bad id, unknown channel...): the message goes back to Claude as it is. */
export class BuzzInput extends Error {}

const HEX64 = /^[0-9a-f]{64}$/;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const fromHex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();
const now = () => Math.floor(Date.now() / 1000);
// Pasted values often carry quotes, spaces or a line break
const envOf = (k: string) => (process.env[k] || "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
/** Lone surrogates can't travel as UTF-8, so they'd change the text between signing and Buzz checking the id. */
const wellFormed = (s: string) => s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");

/** A secret key from nsec1… or 64 hex. */
export function parseSecretKey(input: string, what = "BUZZ_PRIVATE_KEY"): Uint8Array {
  const s = input.trim();
  let key: Uint8Array;
  if (/^nsec1/i.test(s)) {
    try {
      const d = bech32.decode(s.toLowerCase() as `${string}1${string}`, 1500);
      if (d.prefix !== "nsec") throw new Error("not an nsec");
      key = Uint8Array.from(bech32.fromWords(d.words));
    } catch { throw new BuzzSetupError(`${what} looks like an nsec but isn't a valid one (check it was copied whole).`); }
  } else if (HEX64.test(s.toLowerCase())) key = fromHex(s.toLowerCase());
  else throw new BuzzSetupError(`${what} should be an nsec1… key or 64 hex characters.`);
  if (key.length !== 32) throw new BuzzSetupError(`${what} isn't 32 bytes long.`);
  try { schnorr.getPublicKey(key); } catch { throw new BuzzSetupError(`${what} isn't a usable key.`); }
  return key;
}
export const pubkeyOf = (sk: Uint8Array) => hex(schnorr.getPublicKey(sk));
export const npubOf = (pubkeyHex: string) => bech32.encode("npub", bech32.toWords(fromHex(pubkeyHex)), 1500);
export const nsecOf = (sk: Uint8Array) => bech32.encode("nsec", bech32.toWords(sk), 1500);
/** A pubkey from 64 hex or npub1…; "" when it's neither. */
export function pubkeyFrom(input: string): string {
  const s = input.trim().toLowerCase();
  if (HEX64.test(s)) return s;
  if (/^npub1/.test(s)) {
    try { const d = bech32.decode(s as `${string}1${string}`, 1500); const b = bech32.fromWords(d.words); if (d.prefix === "npub" && b.length === 32) return hex(Uint8Array.from(b)); } catch { /* not an npub */ }
  }
  return "";
}

/** NIP-OA (block/buzz docs/nips/NIP-OA.md): the owner signs sha256("nostr:agent-auth:" + agent pubkey + ":" + conditions). */
export const authPreimage = (agentPubkey: string, conditions: string) => `nostr:agent-auth:${agentPubkey}:${conditions}`;
export function makeAuthTag(ownerSk: Uint8Array, agentPubkey: string, conditions = ""): string[] {
  const owner = pubkeyOf(ownerSk);
  if (owner === agentPubkey) throw new BuzzSetupError("The owner and the agent must be different keys.");
  return ["auth", owner, conditions, hex(schnorr.sign(new Uint8Array(sha256(authPreimage(agentPubkey, conditions))), ownerSk))];
}

type Auth = { tag: string[]; json: string; owner: string };
/** BUZZ_AUTH_TAG, checked: four strings, "auth", the owner's pubkey, conditions, and a signature that verifies for this agent. */
export function parseAuthTag(input: string, agentPubkey: string): Auth {
  let s = input.trim();
  // Buzz's CLI also takes the unquoted shorthand [auth,<hex>,,<hex>]
  if (/^\[.*\]$/s.test(s) && !s.includes("\"")) s = JSON.stringify(s.slice(1, -1).split(",").map((x) => x.trim()));
  let arr: unknown;
  try { arr = JSON.parse(s); } catch { throw new BuzzSetupError("BUZZ_AUTH_TAG isn't valid JSON: it should look like [\"auth\",\"<64 hex>\",\"\",\"<128 hex>\"]."); }
  if (!Array.isArray(arr) || arr.length !== 4 || !arr.every((x) => typeof x === "string") || arr[0] !== "auth") throw new BuzzSetupError("BUZZ_AUTH_TAG should be [\"auth\",\"<owner pubkey>\",\"<conditions>\",\"<signature>\"].");
  const [, owner, conditions, sig] = arr as string[];
  if (!HEX64.test(owner)) throw new BuzzSetupError("BUZZ_AUTH_TAG: the owner pubkey should be 64 lowercase hex characters.");
  if (!/^[0-9a-f]{128}$/.test(sig)) throw new BuzzSetupError("BUZZ_AUTH_TAG: the signature should be 128 lowercase hex characters.");
  if (owner === agentPubkey) throw new BuzzSetupError("BUZZ_AUTH_TAG names the agent as its own owner.");
  let ok = false;
  try { ok = schnorr.verify(fromHex(sig), new Uint8Array(sha256(authPreimage(agentPubkey, conditions))), fromHex(owner)); } catch { ok = false; }
  if (!ok) throw new BuzzSetupError("BUZZ_AUTH_TAG doesn't match BUZZ_PRIVATE_KEY: it was signed for a different agent key. Make both again with scripts/buzz-agent-key.mjs.");
  for (const c of conditions ? conditions.split("&") : []) {
    const m = /^created_at([<>])(\d+)$/.exec(c);
    if (m && (m[1] === "<" ? !(now() < Number(m[2])) : !(now() > Number(m[2])))) throw new BuzzSetupError(`BUZZ_AUTH_TAG has run out (${c}). Make a new one with scripts/buzz-agent-key.mjs.`);
  }
  return { tag: arr as string[], json: JSON.stringify(arr), owner };
}

/** BUZZ_RELAY_URL as Buzz's CLI uses it: https, no trailing slash. */
export function relayBase(input: string): string {
  const s = input.trim().replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://").replace(/\/+$/, "");
  let u: URL;
  try { u = new URL(s); } catch { throw new BuzzSetupError(`BUZZ_RELAY_URL isn't a web address (starts "${s.slice(0, 20)}").`); }
  if (u.protocol !== "https:") throw new BuzzSetupError("BUZZ_RELAY_URL should start with https:// (or wss://).");
  if (/\/hooks\//.test(u.pathname)) throw new BuzzSetupError(`BUZZ_RELAY_URL is a webhook address: use just https://${u.host}`);
  if (u.search || u.hash) throw new BuzzSetupError("BUZZ_RELAY_URL should have no ? or # part.");
  return s;
}

type Agent = { sk: Uint8Array; pubkey: string; relay: string; auth: Auth | null };
let cached: { from: string; agent: Agent } | null = null;
function load(): Agent {
  const key = envOf("BUZZ_PRIVATE_KEY"), relay = envOf("BUZZ_RELAY_URL"), tag = envOf("BUZZ_AUTH_TAG");
  const from = `${key}\n${relay}\n${tag}`;
  if (cached?.from === from) return cached.agent;
  const missing = [!key && "BUZZ_PRIVATE_KEY", !relay && "BUZZ_RELAY_URL"].filter(Boolean);
  if (missing.length) throw new BuzzSetupError(`Buzz for Claude is off: set ${missing.join(" and ")} in Vercel, then redeploy (see the README, "Buzz for Claude").`);
  const sk = parseSecretKey(key), pubkey = pubkeyOf(sk);
  const agent = { sk, pubkey, relay: relayBase(relay), auth: tag ? parseAuthTag(tag, pubkey) : null };
  cached = { from, agent };
  return agent;
}
export const buzzAgentOn = () => !!(envOf("BUZZ_PRIVATE_KEY") && envOf("BUZZ_RELAY_URL"));
/** What the app is set up as, for the status tool and the setup page. Never throws; never shows the key. */
export function buzzAgentSetup(): { on: boolean; problem?: string; pubkey?: string; npub?: string; relay?: string; owner?: string; ownerNpub?: string } {
  try {
    const a = load();
    return { on: true, pubkey: a.pubkey, npub: npubOf(a.pubkey), relay: a.relay, ...(a.auth ? { owner: a.auth.owner, ownerNpub: npubOf(a.auth.owner) } : {}) };
  } catch (e) { return { on: false, problem: (e as Error).message }; }
}
export const agentPubkey = () => load().pubkey;

/** Signs an event as the agent. The NIP-OA tag goes on every event it publishes (as Buzz's CLI does), never on NIP-98 proofs. */
export function signEvent(t: Template, withAuthTag = true): NostrEvent {
  const a = load();
  if (!Number.isInteger(t.kind) || t.kind < 0 || t.kind > 65535) throw new BuzzInput(`kind should be a whole number from 0 to 65535, not ${t.kind}.`);
  const tags = (t.tags || []).map((x) => x.map((v) => wellFormed(String(v))));
  if (tags.some((x) => x[0] === "auth")) throw new BuzzInput("Don't add an auth tag: the app adds its own.");
  if (withAuthTag && a.auth) tags.push(a.auth.tag);
  const content = wellFormed(t.content ?? "");
  const created_at = t.created_at ?? now();
  const id = sha256(JSON.stringify([0, a.pubkey, created_at, t.kind, tags, content]));
  return { id: id.toString("hex"), pubkey: a.pubkey, created_at, kind: t.kind, tags, content, sig: hex(schnorr.sign(new Uint8Array(id), a.sk)) };
}

/** A fresh NIP-98 proof for one request, as the Authorization value. */
function proof(method: string, url: string, body?: string) {
  const tags = [["u", url], ["method", method], ["nonce", randomUUID()]];
  if (body !== undefined) tags.push(["payload", createHash("sha256").update(body, "utf8").digest("hex")]);
  return `Nostr ${Buffer.from(JSON.stringify(signEvent({ kind: 27235, tags }, false)), "utf8").toString("base64")}`;
}

const relayMessage = (body: string) => {
  try { const j = JSON.parse(body); const m = j?.error ?? j?.message; if (typeof m === "string" && m) return m; } catch { /* not JSON */ }
  return body.trim().slice(0, 300);
};
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const ATTEMPT_MS = 12_000;

/** One relay request, signed afresh for each try. once: never repeated (moderation commands run on arrival, so a resend could run twice). */
async function call(method: "GET" | "POST", path: string, body?: unknown, once = false): Promise<unknown> {
  const a = load();
  if (!path.startsWith("/") || path.startsWith("//")) throw new BuzzInput("The path should start with a single /, e.g. /moderation/reports?limit=20.");
  const url = `${a.relay}${path}`, text = body === undefined ? undefined : JSON.stringify(body);
  const tries = once ? 1 : 2;
  for (let i = 0; i < tries; i++) {
    const headers: Record<string, string> = { Authorization: proof(method, url, text), Accept: "application/json", "User-Agent": "dogwise-trainers-buzz-agent" };
    if (text !== undefined) headers["Content-Type"] = "application/json";
    if (a.auth) headers["x-auth-tag"] = a.auth.json;
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), ATTEMPT_MS);
    let r: Response;
    try {
      // Never follow a redirect: the proof is for this address only
      r = await fetch(url, { method, headers, body: text, redirect: "manual", cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      const timedOut = (e as Error).name === "AbortError";
      if (!timedOut && i < tries - 1) { await sleep(800); continue; }
      throw new BuzzRelayError(0, timedOut ? `Buzz didn't answer within ${ATTEMPT_MS / 1000} seconds.` : `Couldn't reach Buzz at ${a.relay}: ${(e as Error).message}`);
    }
    const reply = await r.text().catch(() => "");
    clearTimeout(timer);
    if (r.status === 204) return null;
    if (r.ok) { try { return JSON.parse(reply); } catch { return reply; } }
    const message = relayMessage(reply) || `HTTP ${r.status}`;
    if (i < tries - 1 && (r.status === 429 || (r.status >= 502 && r.status <= 504))) {
      const hint = /retry in (\d+)s/i.exec(message);
      await sleep(Math.min(4000, hint ? Number(hint[1]) * 1000 : 1000));
      continue;
    }
    throw new BuzzRelayError(r.status, r.status >= 300 && r.status < 400 ? `Buzz redirected the request (HTTP ${r.status}): check BUZZ_RELAY_URL.` : message);
  }
  throw new BuzzRelayError(0, "Buzz didn't answer.");
}

/** POST /query with one or more filters (ORed). Most filters return an array of events; a few (effective_edit) return an object. */
export const buzzQueryRaw = (filters: object[]) => call("POST", "/query", filters);
export async function buzzEvents(...filters: object[]): Promise<NostrEvent[]> {
  const out = await buzzQueryRaw(filters);
  if (!Array.isArray(out)) throw new BuzzRelayError(200, "Buzz answered the query with something other than a list of events.");
  return out.filter((e): e is NostrEvent => !!e && typeof e === "object" && typeof (e as NostrEvent).id === "string" && Array.isArray((e as NostrEvent).tags));
}
/** Signs and publishes an event (POST /events). Throws when Buzz doesn't accept it. relayMessage: Buzz's note (some kinds answer "response:{…}"). */
export async function buzzPublish(t: Template): Promise<{ event: NostrEvent; relayMessage: string }> {
  const event = signEvent(t);
  const once = event.kind >= 9040 && event.kind <= 9044;
  const r = (await call("POST", "/events", event, once)) as { event_id?: string; accepted?: boolean; message?: string } | null;
  if (r && typeof r === "object" && r.accepted === false) throw new BuzzRelayError(400, r.message || "Buzz didn't accept it.");
  return { event, relayMessage: (r && typeof r === "object" && typeof r.message === "string" && r.message) || "" };
}
/** The JSON part of a "response:{…}" note, if any. */
export function relayResponse(message: string): Record<string, unknown> | null {
  if (!message.startsWith("response:")) return null;
  try { const v = JSON.parse(message.slice(9)); return v && typeof v === "object" ? v : null; } catch { return null; }
}
export const buzzGet = (path: string) => call("GET", path);
export const buzzPost = (path: string, body: unknown) => call("POST", path, body, true);
