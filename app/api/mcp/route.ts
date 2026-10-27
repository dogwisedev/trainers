import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { CLAUDE_TOOLS, runClaudeTool, toolInputSchema } from "@/lib/claudeConnector";

// The app's Claude connector: a small MCP server (Streamable HTTP, stateless, JSON replies). Tools: lib/claudeConnector.ts.
// In Claude: Organization settings > Connectors > Add > Custom > Web, address https://<app address>/api/mcp,
// "No sign in", request header Authorization: Bearer CLAUDE_MCP_KEY. Off until CLAUDE_MCP_KEY is 32+ characters.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];   // newest first
const SERVER = { name: "dogwise-app", title: "Dogwise App", version: "1.0.0" };
const INSTRUCTIONS = "Dogwise Academy's board-and-train app: bookings (one per dog), dogs in care, each dog's chat with the client, trainer and team, the trainer forms (intake, weekly health check, handover report), the before-training checklist and trainer availability. Dates are US Eastern. A booking's drop-off date is the day the dog goes home. Read only: to change anything, use the links into the app.";

type Rpc = { jsonrpc?: unknown; id?: string | number | null; method?: unknown; params?: Record<string, unknown> };
const result = (id: Rpc["id"], r: unknown) => ({ jsonrpc: "2.0", id, result: r });
const error = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function allowed(req: Request) {
  const key = process.env.CLAUDE_MCP_KEY || "";
  if (key.length < 32) return false;
  const sent = Buffer.from((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")), want = Buffer.from(key);
  return sent.length === want.length && timingSafeEqual(sent, want);
}

async function handle(m: Rpc): Promise<object | null> {
  const isRequest = !!m && typeof m === "object" && "id" in m && m.id !== null && m.id !== undefined;
  if (!m || typeof m !== "object" || typeof m.method !== "string") return isRequest ? error(m.id, -32600, "Invalid request") : null;
  if (!isRequest) return null;                         // notifications (initialized, cancelled...) need no answer
  const p = m.params || {};
  switch (m.method) {
    case "initialize": {
      const asked = String(p.protocolVersion || "");
      return result(m.id, { protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: INSTRUCTIONS });
    }
    case "ping":
      return result(m.id, {});
    case "tools/list":
      return result(m.id, {
        tools: CLAUDE_TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: toolInputSchema(t), annotations: { title: t.title, readOnlyHint: true, openWorldHint: false } }))
      });
    case "tools/call": {
      const name = typeof p.name === "string" ? p.name : "";
      if (!CLAUDE_TOOLS.some((t) => t.name === name)) return error(m.id, -32602, `Unknown tool: ${name || "(none)"}`);
      const args = p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments) ? (p.arguments as Record<string, unknown>) : {};
      const r = await runClaudeTool(name, args);
      return result(m.id, r.ok ? { content: [{ type: "text", text: JSON.stringify(r.result) }] } : { content: [{ type: "text", text: r.error }], isError: true });
    }
    default:
      return error(m.id, -32601, `Method not found: ${m.method}`);
  }
}

export async function POST(req: Request) {
  if (!allowed(req)) return NextResponse.json(error(null, -32001, "Unauthorized. Add the Authorization header in Claude's connector settings."), { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json(error(null, -32700, "Parse error"), { status: 400 }); }
  const headers = { "Cache-Control": "no-store" };
  if (Array.isArray(body)) {                            // batches (older protocol versions)
    const out = (await Promise.all(body.map((x) => handle(x as Rpc)))).filter(Boolean);
    return out.length ? NextResponse.json(out, { headers }) : new NextResponse(null, { status: 202 });
  }
  const out = await handle(body as Rpc);
  return out ? NextResponse.json(out, { headers }) : new NextResponse(null, { status: 202 });
}

// No server-to-client stream: Claude only POSTs.
const notAllowed = () => new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
