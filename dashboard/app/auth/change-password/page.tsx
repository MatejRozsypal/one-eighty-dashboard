/**
 * Forced password change.
 *
 * Lives outside the `(app)` group on purpose: that layout redirects here
 * whenever `mustChangePassword` is set, so a page inside it would redirect to
 * itself forever.
 *
 * The flag clears in the session automatically — `resolveAccess` runs on every
 * token refresh — so there is nothing to sign out and back in for.
 */

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { setOwnPassword } from "@/lib/users/store";
import { Logo } from "@/components/ui/Logo";

export const dynamic = "force-dynamic";

async function changePassword(formData: FormData) {
  "use server";

  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/auth/signin");

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 10) {
    redirect("/auth/change-password?error=short");
  }
  if (password !== confirm) {
    redirect("/auth/change-password?error=mismatch");
  }

  await setOwnPassword(email, password);
  redirect("/snapshot");
}

const ERRORS: Record<string, string> = {
  short: "Use at least 10 characters.",
  mismatch: "The two passwords don't match.",
};

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/auth/signin");

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
            You signed in with a temporary password. Pick your own to carry on —
            it&apos;s the only thing on this screen.
          </p>
        </div>

        <form action={changePassword} className="flex flex-col gap-3">
          <input
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            placeholder="New password"
            className={field}
          />
          <input
            name="confirm"
            type="password"
            required
            minLength={10}
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
