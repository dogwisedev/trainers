import type { Config } from "tailwindcss";
// Dogwise palette. Brand colours unchanged; the supporting tones are tuned so small text stays readable.
//  ink      #281870  text, primary buttons
//  lav      #9878F8  the brand lavender: accents, active states, the logo dog (bg-mint is the same colour)
//  fern     #3F2578  deep plum: "done / good" text
//  paper    #F0E8F8  lilac wash: surfaces, hovers
//  heart    #904B27  rust: urgent
//  biscuit  #C9B59E  sand: needs attention
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#281870", soft: "#5D5880", faint: "#8D88A8" },
        lav: { DEFAULT: "#9878F8", deep: "#7B5BEA" },
        mint: { DEFAULT: "#9878F8", deep: "#3F2578", wash: "#F0E8F8" },
        fern: "#3F2578",
        biscuit: { DEFAULT: "#C9B59E", wash: "#F7F1E8" },
        heart: { DEFAULT: "#904B27", wash: "#FBEEE8" },
        paper: "#F0E8F8",
        canvas: "#F8F6FD",
        line: "#E3DEF2"
      },
      fontFamily: { sans: ["'Bricolage Grotesque Variable'", "system-ui", "sans-serif"] },
      borderRadius: { kennel: "10px" },
      boxShadow: {
        card: "0 1px 2px rgba(40,24,112,.05), 0 2px 8px -2px rgba(40,24,112,.06)",
        lift: "0 8px 24px -8px rgba(40,24,112,.25)"
      }
    }
  },
  plugins: []
} satisfies Config;
