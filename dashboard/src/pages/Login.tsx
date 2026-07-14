import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { supabase } from "../lib/supabase";

export default function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-center mb-1" style={{ color: "var(--theme-primary)" }}>
          Retro Learning Game
        </h1>
        <p className="text-center text-sm text-gray-400 mb-6">Sign in to manage your organization</p>
        <div className="bg-white/5 border border-white/10 rounded-lg p-6">
          <Auth
            supabaseClient={supabase}
            appearance={{ theme: ThemeSupa }}
            providers={["google"]}
            // Google sign-in only works once Google OAuth credentials are
            // configured in the Supabase project (Authentication ->
            // Providers -> Google) -- see dashboard/README.md. Email
            // sign-up/sign-in works with zero extra setup either way.
            theme="dark"
          />
        </div>
      </div>
    </div>
  );
}
