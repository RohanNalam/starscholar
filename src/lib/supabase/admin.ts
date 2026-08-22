import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client, BYPASSES row-level security. Only ever import this from
// server code (route handlers). A scheduled job has no signed-in user, so the
// normal anon client would see zero rows: RLS scopes `lookups` to auth.uid(),
// and a cron has no uid. This is the one place that legitimately needs to read
// every user's saved rows, and it is also what can read their email address.
//
// The key must be the *service_role* key from Supabase → Project Settings → API.
// It is a secret: never expose it with a NEXT_PUBLIC_ prefix.
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
