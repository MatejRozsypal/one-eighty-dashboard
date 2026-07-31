import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

/**
 * Sign-in failure.
 *
 * A server component reading the error from searchParams directly. The previous
 * version used `useSearchParams()` in a client component, which requires a
 * Suspense boundary and broke the production build — there's no reason for this
 * page to be interactive at all.
 *
 * The wrong-domain message is deliberately not blaming: being turned away from
 * an internal tool usually means you're signed into a personal Google account,
 * not that you did something wrong.
 */

export const dynamic = "force-dynamic";

export default function AuthErrorPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const isDomain = searchParams.error === "AccessDenied";

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-inverse p-5">
      <div className="flex w-full max-w-[420px] flex-col gap-7">
        <Logo tone="inverse" size={32} />

        <div className="flex flex-col gap-2.5">
          <h1 className="m-0 text-[22px] font-bold tracking-heading text-content-inverse">
            {isDomain ? "That account isn't on the allow-list." : "Sign-in didn't complete."}
          </h1>
          <p className="m-0 text-[13.5px] leading-[1.6] text-gray-300">
            {isDomain ? (
              <>
                This dashboard is restricted to{" "}
                <code className="font-mono text-[12.5px] text-growth-300">
                  @oneeighty.cz
                </code>{" "}
                accounts. If you have one, you may be signed into a personal
                Google account instead — pick the right one on the next screen.
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
