/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        line: "var(--border)",
        ink: "var(--text)",
        muted: "var(--muted)",
        primary: "var(--primary)",
        "primary-ink": "var(--primary-text)",
        accent: "var(--accent)",
        "accent-strong": "var(--accent-strong)",
        "accent-soft": "var(--accent-soft)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
      },
      fontFamily: {
        sans: ['"Inter Tight"', "Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ['"Inter Tight"', "Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        card: "1.15rem",
        pill: "999px",
      },
      boxShadow: {
        lift: "0 22px 45px -28px rgba(11,10,9,0.45)",
        glow: "0 0 0 1px var(--accent), 0 18px 45px -22px var(--accent)",
        soft: "0 1px 2px rgba(11,10,9,0.05), 0 14px 40px -30px rgba(11,10,9,0.4)",
      },
      transitionTimingFunction: {
        expo: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};
