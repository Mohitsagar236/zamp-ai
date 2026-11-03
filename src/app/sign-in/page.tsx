"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export default function SignInPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(data: FormData) {
    setBusy(true);
    setError("");
    const result = await authClient.signIn.email({
      email: String(data.get("email") ?? "").trim(),
      password: String(data.get("password") ?? ""),
      callbackURL: "/",
    });
    setBusy(false);
    if (result.error) setError("Email or password was not accepted.");
    else router.push("/");
  }
  return (
    <main className="min-h-screen bg-[#f6f8fb] px-5 py-16 text-slate-900">
      <section className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold text-blue-700">InvoiceLens</p>
        <h1 className="mt-2 text-2xl font-semibold">
          Sign in to your workspace
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Use your individual account. Contact your company’s workspace
          administrator if you need account recovery.
        </p>
        <form action={submit} className="mt-7 space-y-4">
          <label className="block text-sm font-medium">
            Email
            <input
              required
              name="email"
              type="email"
              autoComplete="username"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5"
            />
          </label>
          <label className="block text-sm font-medium">
            Password
            <input
              required
              name="password"
              type="password"
              autoComplete="current-password"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            className="w-full rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
