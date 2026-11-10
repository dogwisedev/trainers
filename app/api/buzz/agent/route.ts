import { getViewer } from "@/lib/data";
import { BuzzRelayError, buzzAgentSetup, relayBase } from "@/lib/buzzAgent";
import { BUZZ_TOOLS } from "@/lib/buzzTools";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The app's own Buzz account (Dogwise App), which Claude reads and writes through. Admins only, in the browser:
//   /api/buzz/agent                          what's set up, a real signed test against Buzz, and the channels it's in
//   /api/buzz/agent?do=profile               gives the account its name in Buzz: Dogwise App (&name=… for another)
//   /api/buzz/agent?do=join                  joins every open channel it isn't in yet (private ones: add it in Buzz)
//   /api/buzz/agent?do=hello&channel=<name>  posts one TEST line there, to see it end to end
// Nothing else changes in Buzz from here.
type Run = (a: Record<string, unknown>) => Promise<unknown>;
const tool = (name: string): Run => {
  const t = BUZZ_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t.run;
};
const why = (e: unknown) => {
  if (e instanceof BuzzRelayError) {
    const hint = e.status === 401 ? "\n  Buzz didn't accept the app's signed request. Check BUZZ_RELAY_URL is the community address, and that BUZZ_AUTH_TAG was made with your own Buzz key (scripts/buzz-agent-key.mjs)."
      : e.status === 403 ? "\n  Buzz knows the request but won't let the account in: the owner named in BUZZ_AUTH_TAG must be a member of this community. If Buzz mentions federated identity (NIP-FI), the community requires a sign-in this setup doesn't have: tell Claude what it says."
      : e.status === 0 ? "\n  Check BUZZ_RELAY_URL." : "";
    return `Buzz said${e.status ? ` (HTTP ${e.status})` : ""}: ${e.message}${hint}`;
  }
  return (e as Error)?.message || String(e);
};
const show = (v: unknown) => JSON.stringify(v, null, 2).split("\n").map((l) => `  ${l}`).join("\n");

export async function GET(req: Request) {
  const v = await getViewer();
  if (v?.role !== "admin") return new Response("Admins only: sign in to the app as an admin, then open this again.", { status: 401 });
  const q = new URL(req.url).searchParams, act = q.get("do") || "";
  const out: string[] = ["Buzz for Claude: the app's Buzz account", ""];
  const done = () => new Response(out.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

  const s = buzzAgentSetup();
  out.push(`BUZZ_PRIVATE_KEY: ${process.env.BUZZ_PRIVATE_KEY ? "set" : "NOT SET"} · BUZZ_AUTH_TAG: ${process.env.BUZZ_AUTH_TAG ? "set" : "NOT SET"} · BUZZ_RELAY_URL: ${process.env.BUZZ_RELAY_URL ? "set" : "NOT SET"}`, "");
  if (!s.on) { out.push(`OFF: ${s.problem}`, "", "Make the key and tag with scripts/buzz-agent-key.mjs (README, \"Buzz for Claude\"), put them in Vercel, redeploy, open this again."); return done(); }
  out.push(`Account: ${s.npub}`, `Owner:   ${s.ownerNpub || "none (BUZZ_AUTH_TAG not set)"}`, `Buzz:    ${s.relay}`, "");

  // 1. Is it a Buzz relay at all? (public, unsigned)
  try {
    const r = await fetch(`${relayBase(process.env.BUZZ_RELAY_URL || "")}/info`, { headers: { Accept: "application/nostr+json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    const info = await r.json().catch(() => null) as { name?: string; software?: string; version?: string } | null;
    out.push(`1. The address answers: ${r.ok && info ? `yes ✓ (${[info.name, info.software, info.version].filter(Boolean).join(", ") || "a relay"})` : `HTTP ${r.status}: check BUZZ_RELAY_URL`}`);
  } catch (e) { out.push(`1. The address answers: NO (${(e as Error).message}): check BUZZ_RELAY_URL`); }

  // 2. A real signed request, as Claude's tools make them
  let ok = false;
  try {
    const st = await tool("buzz_status")({}) as { connected: boolean; as?: string; channelsIn?: string[]; dmsIn?: number };
    ok = st.connected;
    out.push(`2. Buzz accepts the account: yes ✓ (shows as "${st.as}")`, `   In ${st.channelsIn?.length || 0} channels${st.channelsIn?.length ? `: ${st.channelsIn.join(", ")}` : ""} · ${st.dmsIn || 0} DMs`, "");
  } catch (e) { out.push(`2. Buzz accepts the account: NO`, `  ${why(e)}`, ""); }
  if (!ok) return done();

  if (act === "profile") {
    try { out.push("Setting its profile:", show(await tool("buzz_profile")({ name: q.get("name") || "Dogwise App", about: "The Dogwise app's Buzz account: Claude reads and posts through it for the team." })), ""); }
    catch (e) { out.push(`Profile NOT set: ${why(e)}`, ""); }
  }
  if (act === "join") {
    try {
      const r = await tool("buzz_channels")({}) as { channels: { name: string; id: string; visibility: string; dogwiseAppIsIn: boolean }[] };
      const toJoin = r.channels.filter((c) => c.visibility === "open" && !c.dogwiseAppIsIn);
      out.push(`Joining ${toJoin.length} open channel${toJoin.length === 1 ? "" : "s"}:`);
      for (const c of toJoin) {
        try { await tool("buzz_channel_admin")({ action: "join", channel: c.id }); out.push(`  #${c.name} ✓`); }
        catch (e) { out.push(`  #${c.name}: NOT joined: ${why(e)}`); }
      }
      out.push("");
    } catch (e) { out.push(`Couldn't list channels: ${why(e)}`, ""); }
  }
  if (act === "hello") {
    const channel = q.get("channel") || "";
    if (!channel) out.push("Add &channel=<name> to say where.", "");
    else {
      try { out.push(`Posting a TEST line in ${channel}:`, show(await tool("buzz_send")({ channel, text: "🧪 **TEST**: Claude can now read and post in Buzz through the Dogwise app. Nothing to do." })), ""); }
      catch (e) { out.push(`NOT posted: ${why(e)}`, ""); }
    }
  }

  // 3. What it can see
  try {
    const r = await tool("buzz_channels")({}) as { channels: { name: string; visibility: string; type: string; dogwiseAppIsIn: boolean; members?: number }[] };
    out.push("3. Channels it can see (✓ = it's in, so Claude can read them):");
    for (const c of r.channels) out.push(`  ${c.dogwiseAppIsIn ? "✓" : "·"} #${c.name} (${c.type}, ${c.visibility}${c.members !== undefined ? `, ${c.members} members` : ""})`);
    if (!r.channels.length) out.push("  none yet");
    out.push("", "Open channels: ?do=join adds it to all of them. Private channels: add Dogwise App to each in Buzz (channel → members).");
  } catch (e) { out.push(`3. Couldn't list channels: ${why(e)}`); }
  out.push("", "Next: ?do=profile (its name), ?do=join, then ?do=hello&channel=<name> to see a post arrive.");
  return done();
}
