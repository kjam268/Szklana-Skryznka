/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#111827",
        panel: "#1F2937",
        accent: "#06B6D4",
        onair: "#F97316",
        border: "#374151",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      boxShadow: {
        glow: "0 0 15px -3px rgba(6, 182, 212, 0.4)",
        "glow-orange": "0 0 15px -3px rgba(249, 115, 22, 0.4)",
      }
    },
  },
  plugins: [],
}
