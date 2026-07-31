import "server-only";

/**
 * The user store — who may open the dashboard, and what they may see.
 *
 * ── Roles ───────────────────────────────────────────────────────────────────
 *   admin   every client, plus user management
 *   agency  every client
 *   client  exactly one client, and no way to reach another
 *
 * ── Passwords ───────────────────────────────────────────────────────────────
 * An admin never types or sees a lasting password. Creating a user and
 * resetting one both mint a random temporary password, return it exactly once
 * for the admin to hand over, and set `mustChangePassword`. Nothing reads a
 * hash back out; `verifyPassword` compares and returns a boolean.
 */

import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { sql } from "@/lib/users/db";

export type Role = "admin" | "agency" | "client";

export interface AppUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  /** Only meaningful for `client`. */
  clientId: string | null;
  hasPassword: boolean;
  mustChangePassword: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface UserRow extends Record<string, unknown> {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  client_id: string | null;
  has_password: boolean;
  must_change_password: boolean;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
}

// Every read goes through this so a password hash can never be selected into a
// shape that might get serialised to the client by accident.
const COLUMNS = `
  id::text, email, name, role, client_id,
  (password_hash IS NOT NULL) AS has_password,
  must_change_password, is_active, last_login_at, created_at
`;

function toUser(row: UserRow): AppUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    clientId: row.client_id,
    hasPassword: row.has_password,
    mustChangePassword: row.must_change_password,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listUsers(): Promise<AppUser[]> {
  const rows = await sql<UserRow>(
    `SELECT ${COLUMNS} FROM app_users ORDER BY role, LOWER(email)`
  );
  return rows.map(toUser);
}

export async function findUserByEmail(email: string): Promise<AppUser | null> {
  const rows = await sql<UserRow>(
    `SELECT ${COLUMNS} FROM app_users WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function countUsers(): Promise<number> {
  const rows = await sql<{ n: string }>(`SELECT COUNT(*)::text AS n FROM app_users`);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Readable but not guessable: 4 words plus digits beats a 12-char scramble
 * that gets written on a sticky note because nobody can dictate it over a
 * call. `randomInt` is the CSPRNG — `Math.random()` is not.
 */
const WORDS = [
  "amber", "basalt", "cedar", "delta", "ember", "fjord", "granite", "harbor",
  "indigo", "juniper", "kestrel", "lantern", "meadow", "nimbus", "onyx",
  "pepper", "quartz", "ridge", "summit", "tundra", "umber", "verdant",
  "willow", "zenith",
];

export function generateTemporaryPassword(): string {
  const words = Array.from({ length: 3 }, () => WORDS[randomInt(WORDS.length)]);
  return `${words.join("-")}-${randomInt(1000, 10000)}`;
}

async function hash(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export interface CreatedUser {
  user: AppUser;
  /** Shown to the admin once. Never stored, never retrievable again. */
  temporaryPassword: string;
}

export async function createUser(input: {
  email: string;
  name?: string | null;
  role: Role;
  clientId?: string | null;
}): Promise<CreatedUser> {
  const temporaryPassword = generateTemporaryPassword();

  const rows = await sql<UserRow>(
    `INSERT INTO app_users (email, name, role, client_id, password_hash, must_change_password)
     VALUES (LOWER($1), $2, $3, $4, $5, TRUE)
     RETURNING ${COLUMNS}`,
    [
      input.email.trim(),
      input.name?.trim() || null,
      input.role,
      input.role === "client" ? input.clientId : null,
      await hash(temporaryPassword),
    ]
  );

  return { user: toUser(rows[0]), temporaryPassword };
}

export async function resetPassword(id: string): Promise<string> {
  const temporaryPassword = generateTemporaryPassword();
  await sql(
    `UPDATE app_users
        SET password_hash = $2, must_change_password = TRUE, updated_at = NOW()
      WHERE id = $1::bigint`,
    [id, await hash(temporaryPassword)]
  );
  return temporaryPassword;
}

/** The user choosing their own password — clears the forced-change flag. */
export async function setOwnPassword(
  email: string,
  password: string
): Promise<void> {
  await sql(
    `UPDATE app_users
        SET password_hash = $2, must_change_password = FALSE, updated_at = NOW()
      WHERE LOWER(email) = LOWER($1)`,
    [email, await hash(password)]
  );
}

export async function updateUser(
  id: string,
  input: { role: Role; clientId?: string | null; isActive: boolean }
): Promise<void> {
  await sql(
    `UPDATE app_users
        SET role = $2, client_id = $3, is_active = $4, updated_at = NOW()
      WHERE id = $1::bigint`,
    [id, input.role, input.role === "client" ? input.clientId : null, input.isActive]
  );
}

export async function deleteUser(id: string): Promise<void> {
  await sql(`DELETE FROM app_users WHERE id = $1::bigint`, [id]);
}

/**
 * Password check for the credentials sign-in.
 *
 * Returns the user only on a match, and only when active. Deliberately gives
 * the caller nothing to distinguish "no such user" from "wrong password" —
 * that difference is a free account-existence oracle.
 */
export async function verifyPassword(
  email: string,
  password: string
): Promise<AppUser | null> {
  const rows = await sql<{ password_hash: string | null; is_active: boolean }>(
    `SELECT password_hash, is_active FROM app_users WHERE LOWER(email) = LOWER($1)`,
    [email]
  );

  const row = rows[0];
  if (!row?.password_hash || !row.is_active) {
    // Spend roughly the same time as a real comparison would, so response
    // timing doesn't reveal whether the address exists.
    await bcrypt.compare(password, "$2a$12$" + "x".repeat(53));
    return null;
  }

  if (!(await bcrypt.compare(password, row.password_hash))) return null;

  await sql(
    `UPDATE app_users SET last_login_at = NOW() WHERE LOWER(email) = LOWER($1)`,
    [email]
  );

  return findUserByEmail(email);
}
