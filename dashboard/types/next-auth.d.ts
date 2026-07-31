import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/users/store";

/**
 * The session carries the authorisation decision, so pages read one shape
 * regardless of whether the user signed in with Google or a password.
 */
declare module "next-auth" {
  interface Session {
    user: {
      /** Null when the account exists but may not see anything. */
      role: Role | null;
      /** Set only for `client` — the single client they may see. */
      clientId: string | null;
      mustChangePassword: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role | null;
    clientId?: string | null;
    mustChangePassword?: boolean;
  }
}
