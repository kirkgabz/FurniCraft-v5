import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      /**
       * The house easing curve, named.
       *
       * It is the one CLAUDE.md specifies for kinetic transitions, and it was
       * being written inline as `ease-[cubic-bezier(0.16,1,0.3,1)]`, which
       * Tailwind reports as ambiguous on every build: an arbitrary value with
       * unbracketed commas can be read as more than one utility. Naming it
       * silences that, and means the curve is defined once instead of retyped
       * at each call site where a digit could be fumbled.
       */
      transitionTimingFunction: {
        fc: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      colors: {
        /**
         * The FurniCraft palette, as Tailwind utilities.
         *
         * These CSS variables have always existed in globals.css, and the app
         * has always written `bg-fc-panel`, `text-fc-online`, `bg-fc-btn` and
         * friends -- but they were never registered here, so Tailwind emitted
         * nothing for any of them. Fifty-six class usages were silently dead.
         *
         * The visible symptom was a customer's own chat bubble: `bg-fc-btn`
         * produced no background, leaving white text on the page itself, so a
         * sent message was invisible in the light theme and floated without its
         * bubble in the dark one. The sidebar's `bg-fc-panel` was transparent
         * for the same reason.
         *
         * Mapped straight to var() rather than to channel triples: no call site
         * uses an opacity modifier (`bg-fc-btn/50`), and plain hex variables
         * keep the tokens readable in devtools.
         */
        "fc-bg": "var(--fc-bg)",
        "fc-panel": "var(--fc-panel)",
        "fc-text": "var(--fc-text)",
        "fc-muted": "var(--fc-muted)",
        "fc-border": "var(--fc-border)",
        "fc-accent": "var(--fc-accent)",
        "fc-accent-2": "var(--fc-accent-2)",
        "fc-ink-accent": "var(--fc-ink-accent)",
        "fc-btn": "var(--fc-btn)",
        "fc-btn-hover": "var(--fc-btn-hover)",
        "fc-btn-fg": "var(--fc-btn-fg)",
        "fc-danger": "var(--fc-danger)",
        "fc-danger-fg": "var(--fc-danger-fg)",
        "fc-danger-soft": "var(--fc-danger-soft)",
        "fc-online": "var(--fc-online)",
        "fc-star": "var(--fc-star)",
        "fc-verify": "var(--fc-verify)",
        "fc-cane": "var(--fc-cane)",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      /* `shadow-fc-lg` was dead for the same reason as the colours above: the
         drawer and the modals asked for an elevation the build never emitted. */
      boxShadow: {
        "fc-lg": "0 18px 50px -12px rgba(20, 12, 6, 0.34)",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
