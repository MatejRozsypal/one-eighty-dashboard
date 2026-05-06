"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function AuthErrorPage() {
  const params = useSearchParams();
  const error = params.get("error");

  const message =
    error === "AccessDenied"
      ? "Your email domain is not allowed. Sign in with an @oneeighty.cz account."
      : "Something went wrong during sign-in. Try again.";

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-xl font-bold text-rose-600">Sign-in failed</h1>
        <p className="mb-6 text-sm text-slate-600">{message}</p>
        <Link
          href="/auth/signin"
          className="inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Try again
        </Link>
      </div>
    </main>
  );
}
