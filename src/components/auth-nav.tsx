"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

// Header links for accounts. Renders nothing until Supabase is configured.
export function AuthNav() {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const supabase = supabaseBrowser();

  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!supabase || !ready) {
    return (
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/browse" className="font-medium opacity-70 hover:opacity-100">
          Browse
        </Link>
      </nav>
    );
  }

  return (
    <nav className="flex items-center gap-4 text-sm">
      <Link href="/browse" className="font-medium opacity-70 hover:opacity-100">
        Browse
      </Link>
      <Link href="/my" className="font-medium opacity-70 hover:opacity-100">
        My List
      </Link>
      {email ? (
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            router.refresh();
          }}
          className="opacity-70 hover:opacity-100"
          title={email}
        >
          Sign out
        </button>
      ) : (
        <Link href="/login" className="opacity-70 hover:opacity-100">
          Sign in
        </Link>
      )}
    </nav>
  );
}
