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
 *
 * ── Why colours go through `token()` rather than a bare "var(--x)" ──────────
 * Tailwind cannot apply an opacity modifier to a plain `var()` colour: it does
 * not know the channels, so it silently emits **no rule at all**. Classes like
 * `border-negative/35`, `border-warning/40` and `bg-growth-500/20` were used
 * across the app and never rendered — the error and warning cards had been
 * drawing invisible borders, and the sidebar avatar an invisible tint.
 *
 * `token()` returns the raw `var()` when no opacity is asked for, and a
 * `color-mix()` when one is, so the tokens stay hex in their own files (the
 * handoff can still overwrite them verbatim) while `/opacity` works everywhere.
 *
 * The cast is needed because Tailwind's `colors` type only admits strings, while
 * the runtime has always also accepted this callback. Returning a plain
 * `color-mix(...)` string with `<alpha-value>` would type cleanly, but then
 * *every* colour in the app would route through `color-mix` — so a browser
 * without support loses the entire palette instead of only the translucent
 * few. The callback keeps full-opacity colours as a bare `var()`.
 */
const token = (name: string) =>
  ((({ opacityValue }: { opacityValue?: string }) =>
    opacityValue === undefined
      ? `var(${name})`
      : `color-mix(in srgb, var(${name}) calc(${opacityValue} * 100%), transparent)`) as unknown as string);

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Ink / near-black scale — brand black comes from the logo mark
        ink: {
          950: token("--ink-950"),
          900: token("--ink-900"),
          800: token("--ink-800"),
          700: token("--ink-700"),
          600: token("--ink-600"),
          500: token("--ink-500"),
        },
        gray: {
          400: token("--gray-400"),
          300: token("--gray-300"),
          250: token("--gray-250"),
          200: token("--gray-200"),
          150: token("--gray-150"),
          100: token("--gray-100"),
          50: token("--gray-50"),
        },
        paper: token("--paper"),

        // The single signature accent
        growth: {
          700: token("--growth-700"),
          600: token("--growth-600"),
          500: token("--growth-500"),
          400: token("--growth-400"),
          300: token("--growth-300"),
          100: token("--growth-100"),
          50: token("--growth-50"),
        },

        // Semantic status — red/amber/blue exist ONLY as status, never decoration
        positive: token("--positive"),
        negative: token("--negative"),
        warning: token("--warning"),
        info: token("--info"),

        // Platform colors. Per the brand guide these appear *only* inside
        // product/dashboard UI — which is exactly what this app is. They tag a
        // metric with the system it came from, mirroring the source badges on
        // the reference dashboard.
        platform: {
          shopify: token("--shopify"),
          meta: token("--meta"),
          klaviyo: token("--klaviyo"),
          google: token("--google"),
          shoptet: token("--shoptet"),
          ecomail: token("--ecomail"),
        },

        // Semantic aliases — prefer these in components over raw scale steps
        bg: {
          DEFAULT: token("--bg"),
          subtle: token("--bg-subtle"),
          inverse: token("--bg-inverse"),
          "inverse-2": token("--bg-inverse-2"),
        },
        surface: {
          card: token("--surface-card"),
          "card-subtle": token("--surface-card-subtle"),
          "card-inverse": token("--surface-card-inverse"),
        },
        content: {
          strong: token("--text-strong"),
          body: token("--text-body"),
          muted: token("--text-muted"),
          inverse: token("--text-inverse"),
          "inverse-muted": token("--text-inverse-muted"),
          accent: token("--text-accent"),
        },
        hairline: {
          DEFAULT: token("--border"),
          strong: token("--border-strong"),
          inverse: token("--border-inverse"),
        },
        accent: {
          DEFAULT: token("--accent"),
          hover: token("--accent-hover"),
          contrast: token("--accent-contrast"),
          soft: token("--accent-soft"),
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
