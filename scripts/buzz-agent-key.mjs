// Makes the app's Buzz account ("Dogwise App", a Buzz agent) and the tag that says you own it: the two values that go
// into Vercel as BUZZ_PRIVATE_KEY and BUZZ_AUTH_TAG (see the README, "Buzz for Claude"). Run it on your own computer,
// in the repo, after `npm install`, with your own Buzz private key from Buzz's Settings (private key backup):
//
//   $s = Read-Host "Your Buzz private key (nsec)" -AsSecureString; $env:BUZZ_OWNER_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)); node scripts/buzz-agent-key.mjs; Remove-Item Env:BUZZ_OWNER_KEY
//
// Your key is only used here, to sign the tag (NIP-OA: a Schnorr signature over sha256("nostr:agent-auth:<agent pubkey>:")),
// the same tag Buzz Desktop makes for its own agents. It's never printed, saved or sent anywhere, and it doesn't go into
// Vercel: only the new agent key does. To sign a new tag for the agent key already in Vercel instead of making a new
// one, also set $env:BUZZ_AGENT_KEY to it first.
import { schnorr } from "@noble/curves/secp256k1.js";
import { bech32 } from "@scure/base";
import { createHash } from "node:crypto";

const hex = (b) => Buffer.from(b).toString("hex");
const fromHex = (h) => Uint8Array.from(Buffer.from(h, "hex"));
const fail = (m) => { console.error(`\n${m}\n`); process.exit(1); };
function secretKey(input, what) {
  const s = (input || "").trim().replace(/^["']+|["']+$/g, "");
  let key;
  if (/^nsec1/i.test(s)) {
    try { const d = bech32.decode(s.toLowerCase(), 1500); if (d.prefix !== "nsec") throw 0; key = Uint8Array.from(bech32.fromWords(d.words)); }
    catch { fail(`${what} looks like an nsec but isn't a valid one: copy it again, whole.`); }
  } else if (/^[0-9a-f]{64}$/i.test(s)) key = fromHex(s.toLowerCase());
  else fail(`${what} should be an nsec1… key (or 64 hex characters).`);
  try { schnorr.getPublicKey(key); } catch { fail(`${what} isn't a usable key.`); }
  return key;
}
const npub = (pk) => bech32.encode("npub", bech32.toWords(fromHex(pk)), 1500);
const nsec = (sk) => bech32.encode("nsec", bech32.toWords(sk), 1500);

if (!process.env.BUZZ_OWNER_KEY) fail("BUZZ_OWNER_KEY isn't set: run the PowerShell line at the top of this file, which asks for your key.");
const owner = secretKey(process.env.BUZZ_OWNER_KEY, "Your key");
const agent = process.env.BUZZ_AGENT_KEY ? secretKey(process.env.BUZZ_AGENT_KEY, "BUZZ_AGENT_KEY") : schnorr.utils.randomSecretKey();
const ownerPk = hex(schnorr.getPublicKey(owner)), agentPk = hex(schnorr.getPublicKey(agent));
if (ownerPk === agentPk) fail("The agent key is your own key: the app needs a key of its own.");

const conditions = "";
const message = new Uint8Array(createHash("sha256").update(`nostr:agent-auth:${agentPk}:${conditions}`, "utf8").digest());
const sig = schnorr.sign(message, owner);
if (!schnorr.verify(sig, message, fromHex(ownerPk))) fail("The signature didn't check out. Nothing was made; try again.");
const tag = JSON.stringify(["auth", ownerPk, conditions, hex(sig)]);

console.log(`
Owner (you):  ${npub(ownerPk)}
  Check this is the npub on your own Buzz profile. If it isn't, that wasn't your key: nothing made here will work.
App account:  ${npub(agentPk)}${process.env.BUZZ_AGENT_KEY ? "  (the key you gave)" : "  (new)"}

Vercel → Settings → Environment Variables (Production), each marked Sensitive:

BUZZ_PRIVATE_KEY
${process.env.BUZZ_AGENT_KEY ? "(unchanged: keep the one already there)" : nsec(agent)}

BUZZ_AUTH_TAG
${tag}

BUZZ_RELAY_URL
https://dogwise-academy.communities.buzz.xyz

Then redeploy and open /api/buzz/agent in the app as an admin.
BUZZ_PRIVATE_KEY is the app account's password: anyone with it can post as Dogwise App. Keep it only in Vercel.
`);
