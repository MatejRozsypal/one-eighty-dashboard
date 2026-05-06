"use client";

import { signIn } from "next-auth/react";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-2xl font-bold">One Eighty Dashboard</h1>
        <p className="mb-6 text-sm text-slate-500">
          Sign in with your <code>@oneeighty.cz</code> Google account.
        </p>
        <button
          onClick={() => signIn("google", { callbackUrl: "/" })}
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Continue with Google
        </button>
      </div>
    </main>
  );
}
