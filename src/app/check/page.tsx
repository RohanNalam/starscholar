"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type {
  CheckResult,
  CheckError,
  CheckEvent,
  ExtractedOpportunity,
  VerifiedOpportunity,
} from "@/lib/types";
import { ResultCard } from "@/components/result-card";
import { AuthNav } from "@/components/auth-nav";

const LOADING_STEPS = [
  "Fetching the video…",
  "Watching it — the details are usually in the audio…",
  "Reading the on-screen text…",
  "Working out which opportunities it names…",
];

function CheckInner() {
  const params = useSearchParams();
  const url = params.get("url") ?? "";

  // The lookup streams: `meta` lands once the video has been read, then each
  // card fills in as its own verification finishes.
  const [meta, setMeta] = useState<CheckResult | null>(null);
  const [claimed, setClaimed] = useState<ExtractedOpportunity[]>([]);
  const [cards, setCards] = useState<(VerifiedOpportunity | null)[]>([]);
  const [error, setError] = useState<CheckError | null>(null);
  const [finished, setFinished] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [pastedCaption, setPastedCaption] = useState("");

  const run = useCallback(
    async (caption?: string, refresh?: boolean) => {
      setLoading(true);
      setMeta(null);
      setClaimed([]);
      setCards([]);
      setError(null);
      setFinished(false);
      setStep(0);
      const stepTimer = setInterval(
        () => setStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)),
        5000
      );
      try {
        const res = await fetch("/api/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, caption, refresh, stream: true }),
        });
        if (!res.body) throw new Error("no stream");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // the last piece may be a partial line — keep it for the next chunk
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const ev = JSON.parse(line) as CheckEvent;
            if (ev.type === "error") {
              setError({ ok: false, error: ev.error, needsCaption: ev.needsCaption });
            } else if (ev.type === "meta") {
              clearInterval(stepTimer);
              setMeta(ev.result);
              setClaimed(ev.claimed);
              setCards(new Array(ev.claimed.length).fill(null));
            } else if (ev.type === "opportunity") {
              setCards((prev) => {
                const next = [...prev];
                next[ev.index] = ev.data;
                return next;
              });
            } else if (ev.type === "done") {
              setMeta(ev.result);
              setCards(ev.result.opportunities); // picks up cached results + saved flags
              setFinished(true);
            }
          }
        }
      } catch {
        setError({ ok: false, error: "Network error — is the server running?" });
      } finally {
        clearInterval(stepTimer);
        setLoading(false);
      }
    },
    [url]
  );

  useEffect(() => {
    if (url) void run();
  }, [url, run]);

  if (!url) {
    return (
      <Shell>
        <p className="text-center opacity-70">
          No link provided. <Link href="/" className="underline">Go paste one.</Link>
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="mb-6 break-all text-xs opacity-50">{url}</p>

      {loading && !meta && (
        <div className="rounded-2xl border border-black/10 p-8 text-center dark:border-white/15">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-current border-t-transparent opacity-60" />
          <p className="text-lg font-medium">{LOADING_STEPS[step]}</p>
          <p className="mt-2 text-sm opacity-60">
            Results appear one by one as each is verified.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-300/50 bg-red-50 p-6 dark:bg-red-950/30">
          <p className="font-medium text-red-800 dark:text-red-300">{error.error}</p>
          {error.needsCaption && (
            <div className="mt-4">
              <textarea
                value={pastedCaption}
                onChange={(e) => setPastedCaption(e.target.value)}
                placeholder="Paste the video's caption here…"
                rows={4}
                className="w-full rounded-lg border border-black/15 bg-white p-3 text-sm dark:border-white/20 dark:bg-black"
              />
              <button
                onClick={() => void run(pastedCaption)}
                disabled={!pastedCaption.trim()}
                className="mt-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
              >
                Try again with this caption
              </button>
            </div>
          )}
        </div>
      )}

      {finished && !error && cards.length === 0 && (
        <div className="rounded-2xl border border-black/10 p-6 dark:border-white/15">
          <p className="font-medium">
            We couldn&apos;t tell which opportunity this video is about.
          </p>
          {meta?.caption && (
            <p className="mt-2 text-sm opacity-60">Caption we read: “{meta.caption}”</p>
          )}
          <p className="mt-4 text-sm opacity-70">
            Creators often keep the details in the audio (&quot;comment for the link!&quot;).
            Type what the video mentioned — program name, company, anything — and
            we&apos;ll hunt down the official page:
          </p>
          <textarea
            value={pastedCaption}
            onChange={(e) => setPastedCaption(e.target.value)}
            placeholder='e.g. "free Google AI certificates for students" or "NASA high school internship"'
            rows={3}
            className="mt-3 w-full rounded-lg border border-black/15 bg-white p-3 text-sm dark:border-white/20 dark:bg-black"
          />
          <button
            onClick={() => void run(pastedCaption)}
            disabled={!pastedCaption.trim()}
            className="mt-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            Search with this instead
          </button>
        </div>
      )}

      {cards.length > 0 && (
        <>
          {cards.length > 1 && (
            <p className="mb-4 text-sm font-semibold opacity-80">
              This video mentions {cards.length} opportunities
              {!finished && ` · verified ${cards.filter(Boolean).length} of ${cards.length}`}
            </p>
          )}
          <div className="space-y-6">
            {cards.map((opp, i) => {
              // still verifying — show what the video claimed so the wait has
              // something to read instead of a blank spinner
              if (!opp) {
                const c = claimed[i];
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-2xl border border-black/10 p-6 dark:border-white/15"
                  >
                    <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" />
                    <p className="text-sm opacity-70">
                      Verifying{" "}
                      <span className="font-medium opacity-100">
                        {c?.program_name ?? c?.organization ?? "this opportunity"}
                      </span>
                      …
                    </p>
                  </div>
                );
              }
              return opp.verification ? (
                <ResultCard
                  key={i}
                  r={{
                    verification: opp.verification,
                    sources: opp.sources,
                    checkedAt: meta?.checkedAt ?? new Date().toISOString(),
                  }}
                />
              ) : (
                <div
                  key={i}
                  className="rounded-2xl border border-black/10 p-6 dark:border-white/15"
                >
                  <p className="font-medium">
                    The video mentioned “
                    {opp.claimed.program_name ?? opp.claimed.organization ?? "an opportunity"}”
                    but we couldn&apos;t confirm an official page for it.
                  </p>
                  <a
                    href={`https://www.google.com/search?q=${encodeURIComponent(opp.claimed.search_query)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-sm text-blue-600 underline dark:text-blue-400"
                  >
                    Search it yourself →
                  </a>
                </div>
              );
            })}
          </div>
          {finished && (
            <>
              <p className="mt-4 text-center text-xs opacity-60">
                {meta?.analyzedWith && <>Identified from {meta.analyzedWith}</>}
                {meta?.analyzedWith && cards.some((o) => o?.saved) && " · "}
                {cards.some((o) => o?.saved) && (
                  <>
                    ✓ {cards.filter((o) => o?.saved).length > 1
                      ? `${cards.filter((o) => o?.saved).length} saved`
                      : "Saved"}{" "}
                    to <Link href="/my" className="underline">My List</Link>
                  </>
                )}
              </p>
              <p className="mt-2 text-center">
                <button
                  onClick={() => void run(undefined, true)}
                  className="text-xs underline opacity-50 hover:opacity-100"
                >
                  Something look wrong? Re-check from scratch
                </button>
              </p>
            </>
          )}
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/" className="text-sm font-semibold opacity-70 hover:opacity-100">
          ★ StarScholar
        </Link>
        <AuthNav />
      </div>
      {children}
    </main>
  );
}

export default function CheckPage() {
  return (
    <Suspense fallback={<Shell><p className="text-center opacity-60">Loading…</p></Shell>}>
      <CheckInner />
    </Suspense>
  );
}
