import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "One Eighty",
    template: "%s · One Eighty",
  },
  description:
    "Contribution-margin analytics across every One Eighty client — shop, paid media and email in one place.",
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
  // Zoom is deliberately left enabled — disabling it on a dashboard full of
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
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
