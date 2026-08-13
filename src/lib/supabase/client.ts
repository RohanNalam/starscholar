"use client";

import { createBrowserClient } from "@supabase/ssr";

// Null when Supabase isn't configured yet — the whole app works without it,
// accounts and My List just stay dormant.
export function supabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createBrowserClient(url, anon);
}
