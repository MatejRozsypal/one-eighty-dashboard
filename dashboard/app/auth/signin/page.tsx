"use client";

/**
 * Sign-in. Two ways in, on the brand's dark "product" surface.
 *
 * Google is for the agency, whose accounts are all on the allowed domain.
 * Clients have no such account, so they get email and password — the same
 * screen, not a separate hidden one, because a second sign-in URL is a thing
 * people lose.
 *
 * Google leads, since it is what the agency uses daily. The failure message is
 * deliberately identical for a wrong password and an unknown address: telling
 * them apart hands out a free list of who has an account here.
 */

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Logo } from "@/components/ui/Logo";

export default function SignInPage() {
  const [busy, setBusy] = useState(false);
  const [credentialsBusy, setCredentialsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithPassword(formData: FormData) {
    setError(null);
    setCredentialsBusy(true);

    const result = await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirect: false,
    });

    if (result?.error) {
      setError("That email and password don't match an active account.");
      setCredentialsBusy(false);
      return;
    }

    // A full load, not a client push: the session cookie has just changed and
    // the shell needs to re-read it server-side to know the role.
    window.location.href = "/snapshot";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-inverse p-5">
      <div className="flex w-full max-w-[380px] flex-col gap-7">
        <Logo tone="inverse" size={32} />

        <div className="flex flex-col gap-2.5">
          <h1 className="m-0 text-[26px] font-bold tracking-heading text-content-inverse">
            Contribution margin, <i className="font-medium">not vanity revenue.</i>
          </h1>
          <p className="m-0 text-[13.5px] leading-[1.6] text-gray-300">
            Shop, paid media and email for every client, in one place.
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            signIn("google", { callbackUrl: "/snapshot" });
          }}
          className="inline-flex items-center justify-center gap-2 rounded-control bg-accent px-4 py-3 text-[14px] font-semibold text-accent-contrast transition-all duration-fast hover:bg-accent-hover hover:shadow-accent active:translate-y-px disabled:opacity-60"
        >
          {busy ? "Opening Google…" : "Continue with Google"}
        </button>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-white/[0.12]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-400">
            or
          </span>
          <span className="h-px flex-1 bg-white/[0.12]" />
        </div>

        <form action={signInWithPassword} className="flex flex-col gap-2.5">
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            placeholder="Email"
            className="rounded-control border border-white/[0.14] bg-white/[0.06] px-3 py-2.5 text-[14px] text-content-inverse placeholder:text-gray-400"
          />
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            className="rounded-control border border-white/[0.14] bg-white/[0.06] px-3 py-2.5 text-[14px] text-content-inverse placeholder:text-gray-400"
          />

          {error && <span className="text-[12.5px] text-negative">{error}</span>}

          <button
            type="submit"
            disabled={credentialsBusy}
            className="rounded-control border border-white/[0.16] px-4 py-2.5 text-[14px] font-medium text-content-inverse transition-colors duration-fast hover:bg-white/[0.08] disabled:opacity-60"
          >
            {credentialsBusy ? "Signing in…" : "Sign in with password"}
          </button>

          <span className="text-[12px] leading-[1.5] text-gray-400">
            No password? Ask One Eighty to set one up — accounts are created by
            an admin, there is no self-service sign-up.
          </span>
        </form>
      </div>
    </main>
  );
}
