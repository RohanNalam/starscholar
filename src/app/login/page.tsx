"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

function LoginInner() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const params = useSearchParams();
  const router = useRouter();
  const supabase = supabaseBrowser();

  const signIn = async () => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "That email and password don't match, or you don't have an account yet. Try “Create account” below."
          : error.message
      );
    } else {
      router.push("/my");
    }
  };

  const signUp = async () => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (error) {
      setError(
        error.message.includes("rate limit")
          ? "Signing up still sends a confirmation email because “Confirm email” is on in Supabase, and the email quota is used up. Site owner: go to Supabase, Authentication, Sign In / Providers, Email, and turn OFF “Confirm email”, then try again. (Or sign in above with an existing password, which never sends email.)"
          : error.message.includes("already registered")
            ? "That email already has an account. Sign in above with its password."
            : error.message
      );
    } else if (data.session) {
      router.push("/my");
    } else {
      setNotice(
        "Account created. Email confirmation is on, so check your inbox. (Site owner: turn off “Confirm email” in Supabase under Authentication to make this instant.)"
      );
    }
  };

  const sendMagicLink = async () => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/my` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  const inputClass =
    "w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:bg-black dark:focus:border-white/50";

  return (
    <main className="mx-auto min-h-screen max-w-md px-4 py-16">
      <Link href="/" className="mb-8 inline-block text-sm font-semibold opacity-70 hover:opacity-100">
        ★ StarScholar
      </Link>
      <h1 className="text-3xl font-bold">Sign in</h1>
      <p className="mt-2 text-sm opacity-70">
        Your saved opportunities are private to your account.
      </p>

      {!supabase ? (
        <div className="mt-8 rounded-2xl border border-black/10 p-5 text-sm opacity-70 dark:border-white/15">
          Accounts aren&apos;t set up yet, the site owner needs to add Supabase keys to{" "}
          <code>.env.local</code>. Everything else works without signing in.
        </div>
      ) : sent ? (
        <div className="mt-8 rounded-2xl border border-green-300/50 bg-green-50 p-5 text-sm dark:bg-green-950/30">
          <p className="font-medium text-green-800 dark:text-green-300">
            Check your email 📬, tap the link inside to finish signing in.
          </p>
          <p className="mt-2 text-xs text-green-700 dark:text-green-400/80">
            Open it on this same device and browser, the link only works where it was
            requested. It expires after about an hour.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {params.get("error") && (
            <p className="text-sm text-red-600 dark:text-red-400">
              That sign-in link didn&apos;t work, it may have expired, or it was opened in a
              different browser than the one that requested it.
            </p>
          )}

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputClass}
          />

          {mode === "password" ? (
            <>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void signIn()}
                placeholder="password (6+ characters)"
                className={inputClass}
              />
              <button
                onClick={() => void signIn()}
                disabled={busy || !email.includes("@") || password.length < 6}
                className="w-full rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-black"
              >
                {busy ? "Working…" : "Sign in"}
              </button>
              <button
                onClick={() => void signUp()}
                disabled={busy || !email.includes("@") || password.length < 6}
                className="w-full rounded-xl border border-black/20 px-5 py-3 text-sm font-semibold disabled:opacity-40 dark:border-white/25"
              >
                Create account
              </button>
              <button
                onClick={() => setMode("magic")}
                className="w-full text-center text-xs underline opacity-60 hover:opacity-100"
              >
                or email me a magic link instead
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => void sendMagicLink()}
                disabled={busy || !email.includes("@")}
                className="w-full rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-black"
              >
                {busy ? "Sending…" : "Email me a sign-in link"}
              </button>
              <button
                onClick={() => setMode("password")}
                className="w-full text-center text-xs underline opacity-60 hover:opacity-100"
              >
                or use a password instead
              </button>
            </>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {notice && <p className="text-sm text-yellow-700 dark:text-yellow-400">{notice}</p>}
        </div>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
