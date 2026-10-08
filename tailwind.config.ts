import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#281870", soft: "#9878F8", faint: "#AEB4B2" },
        mint: { DEFAULT: "#9878F8", deep: "#3F2578", wash: "#F0E8F8" },
        fern: "#3F2578",
        biscuit: { DEFAULT: "#C9B59E", wash: "#F0E8F8" },
        heart: { DEFAULT: "#904B27", wash: "#F0E8F8" },
        paper: "#F0E8F8",
        line: "#C1C5DB"
      },
      fontFamily: { sans: ["'Bricolage Grotesque Variable'", "system-ui", "sans-serif"] },
      borderRadius: { kennel: "10px" }
    }
  },
  plugins: []
} satisfies Config;
