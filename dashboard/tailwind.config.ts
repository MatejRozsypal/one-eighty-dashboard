import type { Config } from "tailwindcss";

/**
 * Tailwind theme, bound to the One Eighty design tokens.
 *
 * Every value here points at a CSS custom property defined in styles/tokens/*.
 * Those token files are copied verbatim from the design system handoff and are
 * the single source of truth — when the brand ships an update, they get replaced
 * and nothing in this config or in any component needs to change.
 *
 * That indirection is the point: no hex code should ever appear in a component.
 * If you find yourself reaching for one, the token is missing.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Ink / near-black scale — brand black comes from the logo mark
        ink: {
          950: "var(--ink-950)",
          900: "var(--ink-900)",
          800: "var(--ink-800)",
          700: "var(--ink-700)",
          600: "var(--ink-600)",
          500: "var(--ink-500)",
        },
        gray: {
          400: "var(--gray-400)",
          300: "var(--gray-300)",
          250: "var(--gray-250)",
          200: "var(--gray-200)",
          150: "var(--gray-150)",
          100: "var(--gray-100)",
          50: "var(--gray-50)",
        },
        paper: "var(--paper)",

        // The single signature accent
        growth: {
          700: "var(--growth-700)",
          600: "var(--growth-600)",
          500: "var(--growth-500)",
          400: "var(--growth-400)",
          300: "var(--growth-300)",
          100: "var(--growth-100)",
          50: "var(--growth-50)",
        },

        // Semantic status — red/amber/blue exist ONLY as status, never decoration
        positive: "var(--positive)",
        negative: "var(--negative)",
        warning: "var(--warning)",
        info: "var(--info)",

        // Platform colors. Per the brand guide these appear *only* inside
        // product/dashboard UI — which is exactly what this app is. They tag a
        // metric with the system it came from, mirroring the source badges on
        // the reference dashboard.
        platform: {
          shopify: "var(--shopify)",
          meta: "var(--meta)",
          klaviyo: "var(--klaviyo)",
          google: "var(--google)",
          shoptet: "var(--shoptet)",
          ecomail: "var(--ecomail)",
        },

        // Semantic aliases — prefer these in components over raw scale steps
        bg: {
          DEFAULT: "var(--bg)",
          subtle: "var(--bg-subtle)",
          inverse: "var(--bg-inverse)",
          "inverse-2": "var(--bg-inverse-2)",
        },
        surface: {
          card: "var(--surface-card)",
          "card-subtle": "var(--surface-card-subtle)",
          "card-inverse": "var(--surface-card-inverse)",
        },
        content: {
          strong: "var(--text-strong)",
          body: "var(--text-body)",
          muted: "var(--text-muted)",
          inverse: "var(--text-inverse)",
          "inverse-muted": "var(--text-inverse-muted)",
          accent: "var(--text-accent)",
        },
        hairline: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
          inverse: "var(--border-inverse)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          contrast: "var(--accent-contrast)",
          soft: "var(--accent-soft)",
        },
      },

      fontFamily: {
        sans: ["var(--font-sans)"],
        // Mono carries every number, metric, label and eyebrow — a core brand
        // motif, not a stylistic flourish.
        mono: ["var(--font-mono)"],
      },

      fontSize: {
        "display-2xl": ["var(--text-display-2xl)", { lineHeight: "var(--lh-tight)" }],
        "display-xl": ["var(--text-display-xl)", { lineHeight: "var(--lh-tight)" }],
        "display-lg": ["var(--text-display-lg)", { lineHeight: "var(--lh-snug)" }],
        heading: ["var(--text-heading)", { lineHeight: "var(--lh-heading)" }],
        title: ["var(--text-title)", { lineHeight: "var(--lh-heading)" }],
        subtitle: ["var(--text-subtitle)", { lineHeight: "var(--lh-body)" }],
        body: ["var(--text-body)", { lineHeight: "var(--lh-body)" }],
        "body-sm": ["var(--text-body-sm)", { lineHeight: "var(--lh-body)" }],
        caption: ["var(--text-caption)", { lineHeight: "var(--lh-body)" }],
        eyebrow: ["var(--text-eyebrow)", { lineHeight: "1" }],
      },

      fontWeight: {
        light: "var(--fw-light)",
        normal: "var(--fw-regular)",
        medium: "var(--fw-medium)",
        semibold: "var(--fw-semibold)",
        bold: "var(--fw-bold)",
        extrabold: "var(--fw-extrabold)",
      },

      letterSpacing: {
        display: "var(--tracking-display)",
        heading: "var(--tracking-heading)",
        eyebrow: "var(--tracking-eyebrow)",
      },

      borderRadius: {
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        pill: "var(--radius-pill)",
        card: "var(--radius-card)",
        control: "var(--radius-control)",
      },

      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        accent: "var(--shadow-accent)",
        "ring-inverse": "var(--shadow-ring-inverse)",
      },

      spacing: {
        gutter: "var(--gutter)",
        section: "var(--section-y)",
      },

      maxWidth: {
        container: "var(--container-xl)",
        editorial: "var(--container-md)",
      },

      transitionTimingFunction: {
        out: "var(--ease-out)",
        "in-out": "var(--ease-in-out)",
        standard: "var(--ease-standard)",
      },

      transitionDuration: {
        fast: "var(--dur-fast)",
        base: "var(--dur-base)",
        slow: "var(--dur-slow)",
        reveal: "var(--dur-reveal)",
      },

      keyframes: {
        // The "LIVE" pulse — a signature motion from the brand system.
        "live-pulse": {
          "0%": { transform: "scale(1)", opacity: "0.5" },
          "70%": { transform: "scale(2.2)", opacity: "0" },
          "100%": { opacity: "0" },
        },
      },
      animation: {
        "live-pulse": "live-pulse 1.6s var(--ease-out) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
