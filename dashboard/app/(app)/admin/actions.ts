"use server";

/**
 * Admin mutations.
 *
 * Every action re-checks that the caller is an admin. The nav already hides
 * these screens from everyone else, but hiding a button is not authorisation —
 * a server action is a public HTTP endpoint, callable by anyone who knows it
 * exists. The check has to live here, next to the write.
 */

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  createUser,
  deleteUser,
  resetPassword,
  updateUser,
  type Role,
} from "@/lib/users/store";
import { saveClientSettings } from "@/lib/users/settings";
import { requireInternalForConfig } from "@/lib/authz";

async function requireAdmin(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== "admin") {
    throw new Error("Not authorised.");
  }
  return session.user.email!.toLowerCase();
}

function parseRole(value: FormDataEntryValue | null): Role {
  const role = String(value ?? "");
  if (role !== "admin" && role !== "agency" && role !== "client") {
    throw new Error(`Unknown role: ${role}`);
  }
  return role;
}

export interface ActionResult {
  ok: boolean;
  message?: string;
  /** Present only right after a create or reset — shown once, never stored. */
  temporaryPassword?: string;
  email?: string;
}

export async function createUserAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin();

    const email = String(formData.get("email") ?? "").trim();
    if (!email.includes("@")) return { ok: false, message: "That isn't an email address." };

    const role = parseRole(formData.get("role"));
    const clientId = String(formData.get("clientId") ?? "") || null;

    if (role === "client" && !clientId) {
      return { ok: false, message: "A client user needs a client to be assigned to." };
    }

    const { temporaryPassword } = await createUser({
      email,
      name: String(formData.get("name") ?? "") || null,
      role,
      clientId,
    });

    revalidatePath("/admin");
    return { ok: true, temporaryPassword, email };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    // Postgres's unique-violation code, surfaced as something a human can act on.
    if (message.includes("duplicate key")) {
      return { ok: false, message: "That email already has an account." };
    }
    return { ok: false, message };
  }
}

export async function resetPasswordAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const id = String(formData.get("id") ?? "");
    const email = String(formData.get("email") ?? "");
    const temporaryPassword = await resetPassword(id);
    revalidatePath("/admin");
    return { ok: true, temporaryPassword, email };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Failed." };
  }
}

export async function updateUserAction(formData: FormData): Promise<void> {
  const adminEmail = await requireAdmin();

  const id = String(formData.get("id") ?? "");
  const email = String(formData.get("email") ?? "").toLowerCase();
  const role = parseRole(formData.get("role"));
  const isActive = formData.get("isActive") === "on";

  // Locking yourself out is a one-way door: there is no other way back into
  // this screen, and no second admin is guaranteed to exist.
  if (email === adminEmail && (role !== "admin" || !isActive)) {
    throw new Error("You can't remove your own admin access.");
  }

  await updateUser(id, {
    role,
    clientId: String(formData.get("clientId") ?? "") || null,
    isActive,
  });

  revalidatePath("/admin");
}

export async function deleteUserAction(formData: FormData): Promise<void> {
  const adminEmail = await requireAdmin();
  const email = String(formData.get("email") ?? "").toLowerCase();

  if (email === adminEmail) throw new Error("You can't delete your own account.");

  await deleteUser(String(formData.get("id") ?? ""));
  revalidatePath("/admin");
}

export async function saveSettingsAction(formData: FormData): Promise<void> {
  // Agency, not admin. A cost assumption is the same class of thing as a
  // target: a stated input about how the business runs, which is the agency's
  // job. Access grants stay admin-only, because those are what reach other
  // clients' data.
  const { email: adminEmail } = await requireInternalForConfig();

  // Empty means "not stated" and must stay null. Coercing a blank field to 0
  // would silently assert that fulfilment costs nothing, which is exactly the
  // false-precision this table exists to remove.
  const numberOrNull = (key: string): number | null => {
    const raw = String(formData.get(key) ?? "").trim().replace(",", ".");
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const opexPct = numberOrNull("opexPct");

  await saveClientSettings(
    String(formData.get("clientId") ?? ""),
    {
      // Entered as a percentage because that is how people say it; stored as a
      // share, because that is how it is used.
      opexRate: opexPct === null ? null : opexPct / 100,
      fulfilmentPerOrder: numberOrNull("fulfilmentPerOrder"),
      otherCm1PerOrder: numberOrNull("otherCm1PerOrder"),
    },
    adminEmail
  );

  revalidatePath("/admin");
  revalidatePath("/snapshot");
}
