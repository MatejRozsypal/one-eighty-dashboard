/**
 * NextAuth configuration: Google SSO for the agency, email + password for
 * everyone else.
 *
 * Google alone was fine while the only users were @oneeighty.cz. A client who
 * should see one client's numbers has no such account, so there is a second
 * provider backed by `app_users`. Both land in the same session shape, and the
 * role in that session is the only thing the rest of the app consults.
 *
 * ── `app_users` is the allow-list ───────────────────────────────────────────
 * There is no domain restriction on ordinary sign-in. There used to be, from
 * when Google was the only way in and every user was @oneeighty.cz, but a
 * client invited to see their own numbers signs in with their own address, and
 * a domain check refuses them before their row is ever consulted. Having a
 * user table *and* a domain rule means two allow-lists that disagree; the
 * table wins, and it is the one an admin can actually edit.
 *
 * ── Where the domain check survives, and why it must ────────────────────────
 * Exactly two places, both about the state where nobody can administer the app:
 *
 *  1. **No user store configured**: before Postgres exists there is no table
 *     to consult, so an allowed-domain Google account gets in as admin.
 *  2. **No active admin**: an allowed-domain Google sign-in claims admin and
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

import * as React from "react";
import { getServerSession, type NextAuthOptions, type Session } from "next-auth";
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
  /** Non-null only for `client`, the one client they may see. */
  clientId: string | null;
  mustChangePassword: boolean;
}

function isAllowedDomain(email: string): boolean {
  return ALLOWED_DOMAINS.includes(email.split("@")[1] ?? "");
}

// ---------------------------------------------------------------------------
// Lookup coalescing and short reuse
// ---------------------------------------------------------------------------
//
// next-auth runs the `jwt` callback below on EVERY `getServerSession` call,
// not only at sign-in, so every call is one Postgres round trip. A page render
// made two or three (layout, `resolveClient`, a section layout) and a Reports
// widget request six to eight (route gate, run, store, clients, benchmarks),
// all on the small pool an instance shares between every request it serves.
// Under a burst those lookups queued for the pool (QA N-06).
//
//   1. Concurrent lookups for the same email share one query (in flight).
//   2. A settled answer is reused for ACCESS_TTL_MS across requests. A revoked
//      account, a changed role or client assignment, or a newly issued
//      temporary password therefore takes effect within that window instead
//      of on the very next request (owner limit: at most 30 s).
//   3. Never reused: a failed lookup (an outage is not remembered as a
//      refusal), and an answer with `mustChangePassword: true`, so the account
//      that has just replaced its temporary password is let through on its
//      next request rather than bounced back to the change page.
// Per-request dedupe of the whole session read is `getSession()` below; route
// handlers and server actions have no render scope, so they rely on 1 and 2.

export const ACCESS_TTL_MS = 15_000;
const ACCESS_CACHE_MAX = 1_000;

interface Lookup {
  access: SessionAccess | null;
  /** False for a lookup that failed and returned the fail-closed null. */
  reusable: boolean;
}

const globalForAccess = globalThis as unknown as {
  oeAccessInFlight?: Map<string, Promise<Lookup>>;
  oeAccessSettled?: Map<string, { at: number; access: SessionAccess | null }>;
};

/**
 * Resolve what an email may do. Single source of truth for both providers.
 * Returns null when the account may not sign in at all.
 */
export async function resolveAccess(email: string): Promise<SessionAccess | null> {
  const lower = email.toLowerCase();
  const settled = (globalForAccess.oeAccessSettled ??= new Map());
  const hit = settled.get(lower);
  if (hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit.access;

  const inFlight = (globalForAccess.oeAccessInFlight ??= new Map());
  let lookup = inFlight.get(lower);
  if (!lookup) {
    const started = Date.now();
    const created: Promise<Lookup> = uncachedResolveAccess(lower)
      .then((result) => {
        if (result.reusable && !result.access?.mustChangePassword) {
          if (settled.size >= ACCESS_CACHE_MAX) settled.clear();
          // Stamped with the start, so the window never exceeds the TTL
          // measured from when Postgres was asked.
          settled.set(lower, { at: started, access: result.access });
        } else {
          settled.delete(lower);
        }
        return result;
      })
      .finally(() => {
        if (inFlight.get(lower) === created) inFlight.delete(lower);
      });
    inFlight.set(lower, created);
    lookup = created;
  }
  return (await lookup).access;
}

/** Drop reused answers (one account, or all). For tests and account changes. */
export function forgetAccess(email?: string): void {
  if (email === undefined) globalForAccess.oeAccessSettled?.clear();
  else globalForAccess.oeAccessSettled?.delete(email.toLowerCase());
}

async function uncachedResolveAccess(lower: string): Promise<Lookup> {
  if (!userStoreConfigured()) {
    return {
      access: isAllowedDomain(lower)
        ? { role: "admin", clientId: null, mustChangePassword: false }
        : null,
      reusable: true,
    };
  }

  try {
    const user = await findUserByEmail(lower);

    if (user) {
      if (!user.isActive) return { access: null, reusable: true };
      return {
        access: {
          role: user.role,
          clientId: user.clientId,
          mustChangePassword: user.mustChangePassword,
        },
        reusable: true,
      };
    }

    // Recovery: an allowed-domain account claims admin when there is none.
    if (isAllowedDomain(lower) && (await claimAdminIfNoneExists(lower))) {
      console.warn(`[auth] ${lower} claimed admin, no active admin existed`);
      return { access: { role: "admin", clientId: null, mustChangePassword: false }, reusable: true };
    }

    return { access: null, reusable: true };
  } catch (error) {
    // A database that is configured but unreachable must not silently downgrade
    // to "everyone from the domain is an admin", that would turn an outage
    // into an authorisation bypass. Refuse instead, loudly.
    console.error("[auth] user store unreachable, refusing sign-in", error);
    return { access: null, reusable: false };
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        // Force the account chooser: several of us have multiple Google logins.
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

// ---------------------------------------------------------------------------
// Per-request session
// ---------------------------------------------------------------------------

/**
 * React's per-request memo where the runtime provides it (server components
 * inside Next), a plain call elsewhere (scripts, which load the stable React
 * build that has no `cache`). Outside a render, for example in a route handler
 * or a server action, React's `cache` itself calls straight through.
 */
const perRequest: <F extends (...args: never[]) => unknown>(fn: F) => F =
  (React as unknown as { cache?: <F>(fn: F) => F }).cache ?? ((fn) => fn);

/**
 * The signed-in session, read once per server render.
 *
 * `getServerSession` decodes the JWT and runs the `jwt` callback, which reads
 * Postgres, every time it is called. The app layout, a section layout and
 * `resolveClient` each need the session for the same request; through this
 * they share one read. Use it instead of `getServerSession(authOptions)` in
 * server components and the helpers they call.
 */
export const getSession: () => Promise<Session | null> = perRequest(() =>
  getServerSession(authOptions),
);
