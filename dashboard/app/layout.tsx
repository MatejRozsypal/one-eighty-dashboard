import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { NAV_COLLAPSE_BOOT } from "@/components/shell/NavCollapseToggle";

export const metadata: Metadata = {
  title: {
    default: "One Eighty",
    template: "%s · One Eighty",
  },
  // Installed to a home screen, this is the name under the icon.
  applicationName: "One Eighty",
  appleWebApp: {
    capable: true,
    title: "One Eighty",
    // Matches the dark app bar, so the status bar blends into the shell.
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    // 180px and deliberately flattened to RGB. iOS composites any alpha channel
    // in an apple-touch-icon onto black, so the transparent brand mark that used
    // to be pointed at here landed on the home screen as a black square.
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
  },
};

export const viewport: Viewport = {
  // Zoom is deliberately left enabled, disabling it on a dashboard full of
  // small tabular figures is an accessibility failure, not a polish win.
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0A0A0B",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // `oe-health` is the whole of the Apple Health look (styles/skins/health.css).
    // Every rule in that file is scoped to it, so removing this one class puts
    // the product back on the house look with no other edit anywhere.
    //
    // The Geist variables stay declared: globals.css still names them as the
    // fallback family, and they are what the page renders in if the skin is
    // ever taken off again.
    <html
      lang="en"
      className={`oe-health ${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        {/*
          The skin's one font, fetched as the document streams rather than
          after the stylesheet has been parsed. The Goals pilot preloaded it
          from its own page; now that every page is set in it, it belongs here.
        */}
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          href="/fonts/InterVariable-subset.woff2"
          crossOrigin="anonymous"
        />
        {/*
          Applies a remembered collapse before the first paint. Without it the
          panel renders open and snaps shut on hydration, which reads as a bug
          rather than as a preference being restored.
        */}
        <script dangerouslySetInnerHTML={{ __html: NAV_COLLAPSE_BOOT }} />
        {children}
      </body>
    </html>
  );
}
