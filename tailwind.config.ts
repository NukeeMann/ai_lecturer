import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,js,jsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        "bg-elevated": "var(--bg-elevated)",
        "bg-subtle": "var(--bg-subtle)",
        "bg-hover": "var(--bg-hover)",
        "bg-active": "var(--bg-active)",
        "bg-inverse": "var(--bg-inverse)",

        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        "border-focus": "var(--border-focus)",

        text: "var(--text)",
        "text-secondary": "var(--text-secondary)",
        "text-tertiary": "var(--text-tertiary)",
        "text-quaternary": "var(--text-quaternary)",
        "text-inverse": "var(--text-inverse)",
        "text-on-accent": "var(--text-on-accent)",

        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        "accent-active": "var(--accent-active)",
        "accent-subtle": "var(--accent-subtle)",
        "accent-subtle-hover": "var(--accent-subtle-hover)",
        "accent-border": "var(--accent-border)",
        "accent-text": "var(--accent-text)",

        success: "var(--success)",
        "success-subtle": "var(--success-subtle)",
        "success-border": "var(--success-border)",

        warning: "var(--warning)",
        "warning-subtle": "var(--warning-subtle)",
        "warning-border": "var(--warning-border)",

        danger: "var(--danger)",
        "danger-subtle": "var(--danger-subtle)",
        "danger-border": "var(--danger-border)",

        insight: "var(--insight)",
        "insight-subtle": "var(--insight-subtle)",
        "insight-border": "var(--insight-border)",

        "widget-theory": "var(--widget-theory)",
        "widget-demo": "var(--widget-demo)",
        "widget-quiz": "var(--widget-quiz)",
        "widget-code": "var(--widget-code)",
        "widget-sandbox": "var(--widget-sandbox)",

        "code-bg": "var(--code-bg)",
        "code-text": "var(--code-text)",
        "code-keyword": "var(--code-keyword)",
        "code-string": "var(--code-string)",
        "code-comment": "var(--code-comment)",
        "code-fn": "var(--code-fn)",
        "code-number": "var(--code-number)",
      },
      fontFamily: {
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
        prose: "var(--font-prose)",
        display: "var(--font-display)",
      },
      fontSize: {
        xs: "var(--fs-xs)",
        sm: "var(--fs-sm)",
        base: "var(--fs-base)",
        md: "var(--fs-md)",
        lg: "var(--fs-lg)",
        xl: "var(--fs-xl)",
        "2xl": "var(--fs-2xl)",
        "3xl": "var(--fs-3xl)",
        "4xl": "var(--fs-4xl)",
        "5xl": "var(--fs-5xl)",
      },
      spacing: {
        1: "var(--space-1)",
        2: "var(--space-2)",
        3: "var(--space-3)",
        4: "var(--space-4)",
        5: "var(--space-5)",
        6: "var(--space-6)",
        7: "var(--space-7)",
        8: "var(--space-8)",
        9: "var(--space-9)",
        10: "var(--space-10)",
        section: "var(--space-section)",
      },
      borderRadius: {
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        focus: "var(--shadow-focus)",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      transitionDuration: {
        fast: "120ms",
        base: "180ms",
        slow: "280ms",
      },
    },
  },
  plugins: [],
};

export default config;
