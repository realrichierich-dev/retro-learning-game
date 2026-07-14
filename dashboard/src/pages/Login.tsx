import { useState } from "react";
import { supabase } from "../lib/supabase";

type Mode = "sign_in" | "sign_up";

export default function Login() {
  const [mode, setMode] = useState<Mode>("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { error: authError } =
      mode === "sign_in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    setSubmitting(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    if (mode === "sign_up") {
      // Cloud projects require email confirmation by default (local dev
      // has it disabled for fast testing -- see dashboard/README.md), so
      // signUp() succeeding doesn't mean there's a session yet.
      setConfirmSent(true);
    }
    // On sign-in success, TenantContext's onAuthStateChange listener picks
    // up the new session automatically -- nothing else to do here.
  }

  async function handleGoogle() {
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOAuth({ provider: "google" });
    if (authError) setError(authError.message);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-center mb-1" style={{ color: "var(--theme-primary)" }}>
          Retro Learning Game
        </h1>
        <p className="text-center text-sm text-gray-400 mb-6">Sign in to manage your organization</p>

        <div className="bg-white/5 border border-white/10 rounded-lg p-6">
          {confirmSent ? (
            <p className="text-sm text-center" style={{ color: "var(--theme-primary)" }}>
              Check your email for a confirmation link, then come back and sign in.
            </p>
          ) : (
            <>
              <form onSubmit={handleSubmit}>
                <label className="block text-sm mb-1" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  className="w-full rounded border border-white/20 bg-black/30 px-3 py-2 mb-3 outline-none focus:border-[var(--theme-primary)]"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <label className="block text-sm mb-1" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  className="w-full rounded border border-white/20 bg-black/30 px-3 py-2 mb-4 outline-none focus:border-[var(--theme-primary)]"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded px-3 py-2 font-medium disabled:opacity-50"
                  style={{ background: "var(--theme-primary)", color: "var(--theme-bg)" }}
                >
                  {submitting ? "..." : mode === "sign_in" ? "Sign in" : "Sign up"}
                </button>
              </form>

              <button
                onClick={() => {
                  setMode(mode === "sign_in" ? "sign_up" : "sign_in");
                  setError(null);
                }}
                className="w-full text-center text-sm text-gray-400 hover:text-gray-200 mt-3"
              >
                {mode === "sign_in" ? "Need an account? Sign up" : "Already have an account? Sign in"}
              </button>

              <div className="flex items-center gap-2 my-4">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-xs text-gray-500">or</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <button
                onClick={handleGoogle}
                className="w-full rounded border border-white/20 px-3 py-2 text-sm font-medium hover:bg-white/5"
              >
                Sign in with Google
              </button>
              <p className="text-xs text-gray-500 mt-2 text-center">
                Only works once Google OAuth is configured in the Supabase project -- see
                supabase/CLOUD-SETUP.md.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
