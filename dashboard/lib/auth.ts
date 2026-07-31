/**
 * NextAuth configuration — Google SSO for the agency, email + password for
 * everyone else.
 *
 * Google alone was fine while the only users were @oneeighty.cz. A client who
 * should see one client's numbers has no such account, so there is a second
 * provider backed by `app_users`. Both land in the same session shape, and the
 * role in that session is the only thing the rest of the app consults.
 *
 * ── Not locking anybody out ─────────────────────────────────────────────────
 * Two fallbacks, both deliberate:
 *
 *  1. **No user store configured** — before the Postgres database exists,
 *     `app_users` cannot be read at all. Rather than refuse every sign-in, the
 *     old behaviour stands: any allowed-domain Google account gets in as admin.
 *  2. **Store configured but empty** — the first allowed-domain Google sign-in
 *     is admin, so there is a way to create the first real user. Once one row
 *     exists this stops, and a Google account with no active row is rejected.
 *
 * Without those, attaching the database would have locked everyone out of the
 * page needed to add the first account.
 */

import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { userStoreConfigured } from "@/lib/users/db";
import { countUsers, findUserByEmail, verifyPassword, type Role } from "@/lib/users/store";

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN ?? "oneeighty.cz";
const ALLOWED_DOMAINS = ALLOWED_DOMAIN.split(",").map((d) => d.trim().toLowerCase());

export interface SessionAccess {
  role: Role;
  /** Non-null only for `client` — the one client they may see. */
  clientId: string | null;
  mustChangePassword: boolean;
}

function isAllowedDomain(email: string): boolean {
  return ALLOWED_DOMAINS.includes(email.split("@")[1] ?? "");
}

/**
 * Resolve what an email may do. Single source of truth for both providers.
 * Returns null when the account may not sign in at all.
 */
export async function resolveAccess(email: string): Promise<SessionAccess | null> {
  const lower = email.toLowerCase();

  if (!userStoreConfigured()) {
    return isAllowedDomain(lower)
      ? { role: "admin", clientId: null, mustChangePassword: false }
      : null;
  }

  try {
    const user = await findUserByEmail(lower);

    if (user) {
      if (!user.isActive) return null;
      return {
        role: user.role,
        clientId: user.clientId,
        mustChangePassword: user.mustChangePassword,
      };
    }

    // Bootstrap: an empty table plus an allowed domain is the only way in.
    if (isAllowedDomain(lower) && (await countUsers()) === 0) {
      return { role: "admin", clientId: null, mustChangePassword: false };
    }

    return null;
  } catch (error) {
    // A database that is configured but unreachable must not silently downgrade
    // to "everyone from the domain is an admin" — that would turn an outage
    // into an authorisation bypass. Refuse instead, loudly.
    console.error("[auth] user store unreachable, refusing sign-in", error);
    return null;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        // Force the account chooser — several of us have multiple Google logins.
        params: { prompt: "select_account" },
      },
    }),

    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        if (!userStoreConfigured()) return null;

        const user = await verifyPassword(credentials.email, credentials.password);
        if (!user) return null;

        return { id: user.id, email: user.email, name: user.name ?? user.email };
      },
    }),
  ],

  callbacks: {
    async signIn({ user, account }) {
      const email = user.email?.toLowerCase() ?? "";

      // The credentials provider already proved the password in `authorize`;
      // re-running the lookup here would only add a round trip.
      if (account?.provider === "credentials") return true;

      const access = await resolveAccess(email);
      if (!access) {
        console.warn(`[auth] Rejected sign-in: ${email}`);
        return false;
      }
      return true;
    },

    // Access is resolved on every token refresh rather than pinned at sign-in,
    // so revoking a user or changing their client takes effect without waiting
    // for their session to expire.
    async jwt({ token }) {
      if (token.email) {
        const access = await resolveAccess(token.email);
        token.role = access?.role ?? null;
        token.clientId = access?.clientId ?? null;
        token.mustChangePassword = access?.mustChangePassword ?? false;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.role = (token.role as Role | null) ?? null;
        session.user.clientId = (token.clientId as string | null) ?? null;
        session.user.mustChangePassword = Boolean(token.mustChangePassword);
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
