/**
 * Forced password change.
 *
 * Lives outside the `(app)` group on purpose: that layout redirects here
 * whenever `mustChangePassword` is set, so a page inside it would redirect to
 * itself forever.
 *
 * Reachable only while `mustChangePassword` is set: a session alone is not
 * proof of the old password, so it must not be enough to choose a new one.
 *
 * The flag clears in the session automatically, `resolveAccess` runs on every
 * token refresh, so there is nothing to sign out and back in for.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { setOwnPassword, verifyPassword } from "@/lib/users/store";
import { MAX_BYTES, MIN_LENGTH, PASSWORD_PROBLEMS, passwordProblem } from "@/lib/users/passwordPolicy";
import { Logo } from "@/components/ui/Logo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Choose a password" };

async function changePassword(formData: FormData) {
  "use server";

  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/auth/signin");
  // Only a temporary password may be replaced here. Otherwise anyone at an
  // unlocked laptop could set a new password without knowing the old one and
  // keep the account. A lost password goes through an admin reset.
  if (!session.user.mustChangePassword) redirect("/");

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password !== confirm) {
    redirect("/auth/change-password?error=mismatch");
  }
  // Rules and the breach check: lib/users/passwordPolicy.ts.
  const problem = await passwordProblem(password, email);
  if (problem) redirect(`/auth/change-password?error=${problem}`);
  // The temporary password was seen by the admin who issued it, so it cannot stay.
  if (await verifyPassword(email, password)) {
    redirect("/auth/change-password?error=reused");
  }

  await setOwnPassword(email, password);
  redirect("/");
}

const ERRORS: Record<string, string> = {
  ...PASSWORD_PROBLEMS,
  mismatch: "The two passwords don't match.",
  reused: "Choose a new password, not the temporary one.",
};

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/auth/signin");
  if (!session.user.mustChangePassword) redirect("/");

  const error = searchParams.error ? ERRORS[searchParams.error] : null;
  const field =
    "rounded-control border border-white/[0.14] bg-white/[0.06] px-3 py-2.5 text-[14px] text-content-inverse placeholder:text-gray-400";

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-900 px-6">
      <div className="flex w-full max-w-[400px] flex-col gap-6">
        <Logo size={28} />

        <div className="flex flex-col gap-2">
          <h1 className="text-[26px] font-bold tracking-heading text-content-inverse">
            Choose a password
          </h1>
          <p className="text-[13.5px] leading-[1.6] text-gray-300">
            At least {MIN_LENGTH} characters, not your email address, and not
            one that has leaked in a data breach.
          </p>
        </div>

        <form action={changePassword} className="flex flex-col gap-3">
          <label htmlFor="new-password" className="sr-only">
            New password
          </label>
          <input
            id="new-password"
            name="password"
            type="password"
            required
            minLength={MIN_LENGTH}
            maxLength={MAX_BYTES}
            autoComplete="new-password"
            placeholder="New password"
            className={field}
          />
          <label htmlFor="confirm-password" className="sr-only">
            Repeat the new password
          </label>
          <input
            id="confirm-password"
            name="confirm"
            type="password"
            required
            minLength={MIN_LENGTH}
            maxLength={MAX_BYTES}
            autoComplete="new-password"
            placeholder="Repeat it"
            className={field}
          />

          {error && <span className="text-[12.5px] text-negative">{error}</span>}

          <button
            type="submit"
            className="rounded-control bg-accent px-4 py-2.5 text-[14px] font-semibold text-accent-contrast transition-colors duration-fast hover:bg-accent-hover"
          >
            Save and continue
          </button>
        </form>
      </div>
    </main>
  );
}
