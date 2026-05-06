/**
 * Auth gate. Any request that isn't to /auth/* or /api/auth/* requires a session.
 * Redirects to /auth/signin if unauthenticated.
 */

import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/auth/signin" },
});

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - /auth/* (sign-in / error pages)
     * - /api/auth/* (NextAuth endpoints)
     * - /_next/static, /_next/image (Next.js assets)
     * - /favicon.ico
     */
    "/((?!auth|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
