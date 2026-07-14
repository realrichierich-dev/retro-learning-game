import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY -- copy dashboard/.env.example to " +
      "dashboard/.env and fill them in (see dashboard/README.md)."
  );
}

// Only ever the publishable key here (Supabase's current name for what used
// to be called the "anon key" -- same role, same createClient() call, just
// newer naming/format: sb_publishable_... instead of a JWT). It's safe to
// ship in client JS by design (RLS is what actually restricts access, not
// this key's secrecy). The secret key (formerly "service_role") bypasses
// RLS entirely and must never end up in a VITE_-prefixed env var, since
// Vite inlines those into the public bundle.
export const supabase = createClient(supabaseUrl, supabasePublishableKey);
