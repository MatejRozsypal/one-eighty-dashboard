"use client";

/**
 * Sign-in. One button, on the brand's dark "product" surface.
 *
 * The domain restriction is stated up front rather than discovered after a
 * failed attempt — being bounced without knowing why is the worst version of
 * this screen.
 */

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Logo } from "@/components/ui/Logo";

export default function SignInPage() {
  const [busy, setBusy] = useState(false);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-inverse p-5">
      <div className="flex w-full max-w-[380px] flex-col gap-7">
        <Logo tone="inverse" size={32} />

        <div className="flex flex-col gap-2.5">
          <h1 className="m-0 text-[26px] font-bold tracking-heading text-content-inverse">
            Contribution margin, <i className="font-medium">not vanity revenue.</i>
          </h1>
          <p className="m-0 text-[13.5px] leading-[1.6] text-gray-300">
            Shop, paid media and email for every client, in one place. Restricted
            to <code className="font-mono text-[12.5px] text-growth-300">@oneeighty.cz</code>{" "}
            accounts.
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
      </div>
    </main>
  );
}
