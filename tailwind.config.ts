import type { Config } from "tailwindcss";
// Dogwise palette. Brand colours unchanged; supporting tones tuned so small text passes WCAG AA (4.5:1).
//  ink      #281870  text, primary buttons
//  lav      #9878F8  the brand lavender: accents, active states, the logo dog (bg-mint is the same colour)
//  lav-deep #6E4FE0  lavender that white text can sit on (5.0:1)
//  fern     #3F2578  deep plum: "done / good" text
//  paper    #F0E8F8  lilac wash: surfaces, hovers
//  heart    #904B27  rust: urgent
//  biscuit  #C9B59E  sand: needs attention (backgrounds only); warn #7A5418 is its text colour
//
// Type scale: use these, never text-[NNpx]. Inputs stay 16px on phones so iPhone doesn't zoom in when you tap them.
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#281870", soft: "#5D5880", faint: "#6B6689" },
        lav: { DEFAULT: "#9878F8", deep: "#6E4FE0" },
        mint: { DEFAULT: "#9878F8", deep: "#3F2578", wash: "#F0E8F8" },
        fern: "#3F2578",
        biscuit: { DEFAULT: "#C9B59E", wash: "#F7F1E8" },
        warn: "#7A5418",
        heart: { DEFAULT: "#904B27", wash: "#FBEEE8" },
        paper: "#F0E8F8",
        canvas: "#F8F6FD",
        line: "#E3DEF2"
      },
      fontSize: {
        micro: ["11px", { lineHeight: "14px" }],
        caption: ["12px", { lineHeight: "16px" }],
        small: ["13px", { lineHeight: "18px" }],
        body: ["15px", { lineHeight: "22px" }],
        input: ["16px", { lineHeight: "22px" }],
        lead: ["17px", { lineHeight: "24px" }],
        h3: ["20px", { lineHeight: "26px" }],
        h2: ["24px", { lineHeight: "30px" }],
        h1: ["30px", { lineHeight: "36px" }],
        display: ["40px", { lineHeight: "44px" }],
        hero: ["44px", { lineHeight: "46px" }],
        "hero-lg": ["56px", { lineHeight: "58px" }]
      },
      fontFamily: { sans: ["'Bricolage Grotesque Variable'", "system-ui", "sans-serif"] },
      borderRadius: { kennel: "10px" },
      boxShadow: {
        card: "0 1px 2px rgba(40,24,112,.05), 0 2px 8px -2px rgba(40,24,112,.06)",
        lift: "0 8px 24px -8px rgba(40,24,112,.25)"
      },
      keyframes: { shimmer: { "0%": { backgroundPosition: "-400px 0" }, "100%": { backgroundPosition: "400px 0" } } },
      animation: { shimmer: "shimmer 1.4s linear infinite" }
    }
  },
  plugins: []
} satisfies Config;
