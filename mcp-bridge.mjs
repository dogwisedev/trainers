// mcp-bridge.mjs
import readline from 'readline';

const VERCEL_URL = "https://dogwisecommunication.vercel.app/api/mcp";
const API_KEY = process.env.CLAUDE_MCP_KEY;

if (!API_KEY || API_KEY.length < 32) {
  console.error("Error: CLAUDE_MCP_KEY environment variable is missing or too short.");
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// Listen for messages from Claude Desktop via standard input
rl.on('line', async (line) => {
  if (!line.trim()) return;
  
  try {
    const res = await fetch(VERCEL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: line // Forward the exact JSON from Claude to Vercel
    });
    
    if (res.status === 202) return; // No content
    
    const out = await res.text();
    if (out) {
      // Send the response back to Claude Desktop via standard output
      console.log(out);
    }
  } catch (err) {
    // Send errors to Claude's internal error log
    console.error("Bridge Error:", err);
  }
});
