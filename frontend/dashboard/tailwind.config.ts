import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        graphite: "#1f2933",
        signal: "#0f766e",
        voltage: "#eab308",
        fault: "#dc2626"
      }
    }
  },
  plugins: []
} satisfies Config;
