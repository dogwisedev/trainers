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
//
// Dark mode: every colour is a CSS variable (app/globals.css), switched by <html data-theme="dark"> (Your account → Appearance).
// Text and background versions of a colour can differ, so white text stays readable on buttons and badges in both themes:
// bg-ink, bg-fern, bg-heart, bg-lav/mint, bg-biscuit stay strong in dark mode; text-ink and friends turn light. bg-white is the
// card surface (dark in dark mode); text-white is always white. Use bg-[#fff] for things that must stay white (document previews).
//
// Type scale: use these, never text-[NNpx]. Inputs stay 16px on phones so iPhone doesn't zoom in when you tap them.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: v("ink"), soft: v("ink-soft"), faint: v("ink-faint") },
        lav: { DEFAULT: v("lav"), deep: v("lav-deep") },
        mint: { DEFAULT: v("lav"), deep: v("mint-deep"), wash: v("mint-wash") },
        fern: v("fern"),
        biscuit: { DEFAULT: v("biscuit"), wash: v("biscuit-wash") },
        warn: v("warn"),
        heart: { DEFAULT: v("heart"), wash: v("heart-wash") },
        paper: v("paper"),
        canvas: v("canvas"),
        line: v("line")
      },
      // Backgrounds that carry white text keep their own (strong) colour in dark mode; bg-white is the card surface
      backgroundColor: {
        white: v("surface"),
        ink: { DEFAULT: v("ink-bg") },
        fern: v("fern-bg"),
        heart: { DEFAULT: v("heart-bg") },
        lav: { DEFAULT: v("lav-bg"), deep: v("lav-deep-bg") },
        mint: { DEFAULT: v("mint-bg"), deep: v("mint-deep-bg") },
        biscuit: { DEFAULT: v("biscuit-bg") }
      },
      borderColor: { white: v("surface") },
      ringColor: { white: v("surface") },
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
