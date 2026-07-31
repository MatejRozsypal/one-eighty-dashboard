import type { MetadataRoute } from "next";

/**
 * PWA manifest — makes the dashboard installable to the macOS dock and the
 * iPhone home screen.
 *
 * `display: standalone` is what removes the URL bar and makes it read as an app
 * rather than a bookmarked page. The dark theme color matches the shell's
 * sidebar so the OS chrome blends in instead of framing it.
 *
 * ── Icons are pre-composited, not the transparent brand mark ────────────────
 * These used to point straight at `brand/oneeighty-mark.png`, a 4168px
 * transparent PNG declared `sizes: "any"`. That is wrong in three ways on a
 * phone: the launcher has to downscale 4168px itself, `"any"` gives it no size
 * to choose from, and a transparent icon lands on the home screen as a black
 * square because iOS composites alpha onto black.
 *
 * `public/icons/*` are generated at real sizes with the black mark already sat
 * on the brand green, and the mark is held to 62% of the width — inside the
 * central 80% that Android crops a maskable icon to, so one piece of artwork
 * serves both `any` and `maskable` without being clipped.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "One Eighty Dashboard",
    short_name: "One Eighty",
    description:
      "Contribution-margin analytics across every One Eighty client.",
    start_url: "/snapshot",
    display: "standalone",
    background_color: "#0A0A0B",
    theme_color: "#0A0A0B",
    orientation: "portrait-primary",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
