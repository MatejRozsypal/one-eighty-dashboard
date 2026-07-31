/**
 * NextAuth configuration — Google SSO for the agency, email + password for
 * everyone else.
 *
 * Google alone was fine while the only users were @oneeighty.cz. A client who
 * should see one client's numbers has no such account, so there is a second
 * provider backed by `app_users`. Both land in the same session shape, and the
 * role in that session is the only thing the rest of the app consults.
 *
 * ── `app_users` is the allow-list ───────────────────────────────────────────
 * There is no domain restriction on ordinary sign-in. There used to be, from
 * when Google was the only way in and every user was @oneeighty.cz — but a
 * client invited to see their own numbers signs in with their own address, and
 * a domain check refuses them before their row is ever consulted. Having a
 * user table *and* a domain rule means two allow-lists that disagree; the
 * table wins, and it is the one an admin can actually edit.
 *
 * ── Where the domain check survives, and why it must ────────────────────────
 * Exactly two places, both about the state where nobody can administer the app:
 *
 *  1. **No user store configured** — before Postgres exists there is no table
 *     to consult, so an allowed-domain Google account gets in as admin.
 *  2. **No active admin** — an allowed-domain Google sign-in claims admin and
 *     writes the row, so the rule closes behind them.
 *
 * Dropping the domain check from *those* would let any Google account on the
 * internet claim admin the moment the app had none. It stays.
 *
 * Rule 2 originally keyed on the table being *empty*, which bit immediately:
 * the first account created was `agency`, the table stopped being empty, and
 * from that moment nobody could bootstrap while the only existing account
 * couldn't reach user management either.
 */

import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { userStoreConfigured } from "@/lib/users/db";
import {
  claimAdminIfNoneExists,
  findUserByEmail,
  verifyPassword,
  type Role,
} from "@/lib/users/store";

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

    // Recovery: an allowed-domain account claims admin when there is none.
    if (isAllowedDomain(lower) && (await claimAdminIfNoneExists(lower))) {
      console.warn(`[auth] ${lower} claimed admin — no active admin existed`);
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
