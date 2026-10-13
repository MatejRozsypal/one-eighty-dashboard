import type { Metadata } from "next";

// The sign-in page is a client component and cannot export metadata itself,
// so its document title lives here. The root layout's template adds the brand.
export const metadata: Metadata = { title: "Sign in" };

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
