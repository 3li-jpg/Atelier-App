import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Admin client — server-side only, never expose to the browser.
// Used to verify user JWTs and look up users by ID.
// Lazy: created on first use so importing this module without SUPABASE_URL
// (unit tests, deployments without Supabase auth) doesn't throw.
let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient | null {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return client;
}
