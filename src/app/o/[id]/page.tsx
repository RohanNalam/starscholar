import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { ResultCard } from "@/components/result-card";
import type { VerifiedOpportunity } from "@/lib/types";

// Public, shareable page for one verified opportunity, each cached lookup
// becomes a durable page (and, once deployed, a search-indexable one).
export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await supabaseServer();

  let row: {
    result: VerifiedOpportunity;
    checked_at: string;
    video_url: string;
    author: string | null;
  } | null = null;

  if (supabase) {
    const { data } = await supabase
      .from("opportunities")
      .select("result, checked_at, video_url, author")
      .eq("id", id)
      .single();
    row = data;
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/" className="text-sm font-semibold opacity-70 hover:opacity-100">
          ★ StarScholar
        </Link>
        <Link href="/browse" className="text-sm opacity-70 hover:opacity-100">
          Browse all
        </Link>
      </div>

      {!row || !row.result?.verification ? (
        <div className="rounded-2xl border border-black/10 p-6 text-sm opacity-70 dark:border-white/15">
          This opportunity doesn&apos;t exist (or was removed).{" "}
          <Link href="/browse" className="underline">
            Browse the directory
          </Link>{" "}
          instead.
        </div>
      ) : (
        <>
          <ResultCard
            r={{
              verification: row.result.verification,
              sources: row.result.sources,
              checkedAt: row.checked_at,
            }}
          />
          <div className="mt-4 flex items-center justify-between text-xs opacity-60">
            <a
              href={row.video_url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:opacity-100"
            >
              Original video{row.author ? ` by ${row.author}` : ""}
            </a>
            <Link href="/" className="underline hover:opacity-100">
              Check your own video →
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
