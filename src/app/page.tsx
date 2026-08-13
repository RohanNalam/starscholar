"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { AuthNav } from "@/components/auth-nav";
import MagicBento from "@/components/reactbits/MagicBento";
import GlassSurface from "@/components/reactbits/GlassSurface";

// WebGL hero background — client-only and lazy so it never blocks the page.
const Dither = dynamic(() => import("@/components/reactbits/Dither"), { ssr: false });

export default function Home() {
  const [url, setUrl] = useState("");
  const router = useRouter();

  const go = () => {
    const trimmed = url.trim();
    if (trimmed) router.push(`/check?url=${encodeURIComponent(trimmed)}`);
  };

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      {/* ── Hero: dithered wave background + glass paste box ─────────────── */}
      <section className="relative flex min-h-[92vh] flex-col overflow-hidden">
        <div className="absolute inset-0">
          <Dither
            waveColor={[0.5, 0.5, 0.5]}
            colorNum={4}
            pixelSize={2}
            waveAmplitude={0.3}
            waveFrequency={3}
            waveSpeed={0.05}
            enableMouseInteraction
            mouseRadius={0.4}
          />
        </div>
        {/* fade the waves into the bento section below */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-[#050505]" />

        <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold tracking-wide drop-shadow">★ StarScholar</span>
            <AuthNav />
          </div>

          <div className="flex flex-1 flex-col items-center justify-center pb-16 text-center">
            <h1 className="text-4xl font-bold tracking-tight drop-shadow-[0_2px_16px_rgba(0,0,0,0.7)] sm:text-6xl">
              The link they never
              <br />
              put in the caption.
            </h1>
            <p className="mt-5 max-w-md text-lg text-white/85 drop-shadow">
              Paste any TikTok, Reel, or Short about a scholarship or internship — get the
              verified application link, real deadline, and a step-by-step checklist.
            </p>

            <div className="mt-9 w-full max-w-xl">
              <GlassSurface width="100%" height={64} borderRadius={32} backgroundOpacity={0.12}>
                <div className="flex w-full items-center gap-2 px-2.5">
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && go()}
                    placeholder="https://www.tiktok.com/@…/video/…"
                    className="min-w-0 flex-1 bg-transparent px-3 text-sm text-white placeholder-white/50 outline-none"
                  />
                  <button
                    onClick={go}
                    disabled={!url.trim()}
                    className="shrink-0 rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    Find it
                  </button>
                </div>
              </GlassSurface>
              <p className="mt-3 text-xs text-white/50 drop-shadow">
                Works with TikTok, Instagram Reels, and YouTube Shorts
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Bento: how it works + features ───────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-4 pb-16 pt-4">
        <h2 className="mb-8 text-center text-2xl font-bold sm:text-3xl">
          From doomscroll to deadline in 20 seconds
        </h2>
        <MagicBento
          textAutoHide={false}
          enableStars
          enableSpotlight
          enableBorderGlow
          enableTilt
          enableMagnetism
          clickEffect
          spotlightRadius={300}
          particleCount={12}
          glowColor="132, 0, 255"
        />
      </section>

      <footer className="pb-10 text-center text-xs text-white/40">
        StarScholar checks official sources in real time. Always confirm details on the
        official site before applying.
      </footer>
    </main>
  );
}
