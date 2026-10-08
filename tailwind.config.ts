import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#1D3557", soft: "#41587A", faint: "#8796AD" },  // Dogwise navy
        mint: { DEFAULT: "#BFF6C3", deep: "#8FE29A", wash: "#EEFBEF" },  // Dogwise mint: free kennels
        fern: "#21734A",                                                 // readable green text
        biscuit: { DEFAULT: "#FDBE5B", wash: "#FFF3DC" },                // the dog's coat: "now", highlights
        heart: { DEFAULT: "#E9506A", wash: "#FDE8EC" },                  // the hearts: time off, blocked
        paper: "#F6FAF7",
        line: "#DCE5E0"
      },
      fontFamily: { sans: ["'Bricolage Grotesque Variable'", "system-ui", "sans-serif"] },
      borderRadius: { kennel: "10px" }
    }
  },
  plugins: []
} satisfies Config;
