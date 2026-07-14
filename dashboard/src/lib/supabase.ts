import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY -- copy dashboard/.env.example to " +
      "dashboard/.env and fill them in (see dashboard/README.md)."
  );
}

// Only ever the anon key here -- it's safe to ship in client JS by design
// (RLS is what actually restricts access, not this key's secrecy). The
// service_role key bypasses RLS entirely and must never end up in a
// VITE_-prefixed env var, since Vite inlines those into the public bundle.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
