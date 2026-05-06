/**
 * NextAuth configuration. Google SSO restricted to @oneeighty.cz.
 *
 * The signIn callback is the security gate — it rejects any non-allowed domain.
 * The session callback exposes the email + role to server components and API routes.
 */

import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const ALLOWED_DOMAIN =
  process.env.ALLOWED_EMAIL_DOMAIN ?? "oneeighty.cz";

const ALLOWED_DOMAINS = ALLOWED_DOMAIN.split(",").map((d) => d.trim().toLowerCase());

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          // Force account chooser every login (helps when devs have multiple google accounts)
          prompt: "select_account",
        },
      },
    }),
  ],

  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase() ?? "";
      const domain = email.split("@")[1] ?? "";
      if (!ALLOWED_DOMAINS.includes(domain)) {
        console.warn(`[auth] Rejected sign-in: ${email} (domain not allowed)`);
        return false;
      }
      return true;
    },

    async session({ session, token }) {
      // Phase 4 expansion: enrich session with role + allowed client_ids
      // For MVP: every @oneeighty.cz user is agency_admin
      if (session.user) {
        (session.user as typeof session.user & { role: string }).role = "agency_admin";
      }
      return session;
    },
  },

  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },

  session: { strategy: "jwt" },
};
