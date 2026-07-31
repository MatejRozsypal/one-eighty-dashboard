import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
// NOTE: access is decided by the `app_users` table, not by email domain — see
// lib/auth.ts. The copy here must not promise a domain rule that isn't applied.

/**
 * Sign-in failure.
 *
 * A server component reading the error from searchParams directly. The previous
 * version used `useSearchParams()` in a client component, which requires a
 * Suspense boundary and broke the production build — there's no reason for this
 * page to be interactive at all.
 *
 * The refusal message is deliberately not blaming, and deliberately vague about
 * *why*: it is the same screen whether the address has no account, has been
 * deactivated, or is simply the wrong one of someone's several Google logins.
 * Spelling out which would let anyone enumerate who has access here.
 */

export const dynamic = "force-dynamic";

export default function AuthErrorPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const noAccess = searchParams.error === "AccessDenied";

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-inverse p-5">
      <div className="flex w-full max-w-[420px] flex-col gap-7">
        <Logo tone="inverse" size={32} />

        <div className="flex flex-col gap-2.5">
          <h1 className="m-0 text-[22px] font-bold tracking-heading text-content-inverse">
            {noAccess ? "This account doesn't have access." : "Sign-in didn't complete."}
          </h1>
          <p className="m-0 text-[13.5px] leading-[1.6] text-gray-300">
            {noAccess ? (
              <>
                Access is granted per account by a One Eighty admin — ask them
                to add you. If you know you already have access, you may have
                picked the wrong Google account; choose another on the next
                screen.
              </>
            ) : (
              "Something went wrong between here and Google. Trying again usually resolves it."
            )}
          </p>
        </div>

        <Link
          href="/auth/signin"
          className="inline-flex w-fit items-center justify-center rounded-control border border-hairline-inverse bg-white/[0.06] px-4 py-2.5 text-[13.5px] font-medium text-content-inverse transition-colors duration-fast hover:bg-white/[0.11]"
        >
          Try again
        </Link>
      </div>
    </main>
  );
}
