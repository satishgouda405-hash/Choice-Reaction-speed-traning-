/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0f",
        "bg-elevated": "#12121a",
        "bg-card": "#1a1a24",
        border: "#2a2a3a",
        text: "#e0e0e0",
        "text-muted": "#8888a0",
        accent: "#00d4aa",
        danger: "#ff4757",
        warning: "#ffa502",
        success: "#2ed573",
        info: "#1e90ff",
      }
    }
  },
  plugins: []
}
