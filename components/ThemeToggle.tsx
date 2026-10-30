"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";
const KEY = "dw-theme";

/** Your account → Appearance: light (the default) or dark. Saved on this device and kept when the app is reopened. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => { try { setTheme(localStorage.getItem(KEY) === "dark" ? "dark" : "light"); } catch { /* private mode: light */ } }, []);
  const pick = (t: Theme) => {
    setTheme(t);
    try { localStorage.setItem(KEY, t); } catch { /* still switches for this visit */ }
    if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
  };
  const opt = (t: Theme, label: string, Icon: typeof Sun) => (
    <button type="button" role="radio" aria-checked={theme === t} onClick={() => pick(t)}
      className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-body font-semibold ${theme === t ? "bg-ink text-white" : "text-ink-soft hover:bg-paper hover:text-ink"}`}>
      <Icon size={17} aria-hidden />{label}
    </button>
  );
  return (
    <div>
      <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-2 gap-1 rounded-2xl border border-line bg-white p-1">
        {opt("light", "Light", Sun)}
        {opt("dark", "Dark", Moon)}
      </div>
      <p className="mt-2 text-small text-ink-faint">Saved on this device, and kept when you reopen the app.</p>
    </div>
  );
}
