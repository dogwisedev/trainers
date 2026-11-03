/** How many separate visits this device has made (counted once per browser session). Safe to call from anywhere, any order. */
export function visitCount(): number {
  try {
    if (!sessionStorage.getItem("dw-visit")) { sessionStorage.setItem("dw-visit", "1"); localStorage.setItem("dw-visits", String(Number(localStorage.getItem("dw-visits") || 0) + 1)); }
    return Number(localStorage.getItem("dw-visits") || 1);
  } catch { return 2; } // private mode: behave as a returning visitor
}
