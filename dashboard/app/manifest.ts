import type { MetadataRoute } from "next";

/**
 * PWA manifest — makes the dashboard installable to the macOS dock and the
 * iPhone home screen.
 *
 * `display: standalone` is what removes the URL bar and makes it read as an app
 * rather than a bookmarked page. The dark theme color matches the shell's
 * sidebar so the OS chrome blends in instead of framing it.
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
      {
        src: "/brand/oneeighty-mark.png",
        sizes: "any",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/oneeighty-mark-white.png",
        sizes: "any",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
