# ★ StarScholar

**The link they never put in the caption.**

Paste any TikTok / Instagram Reel / YouTube Short about a scholarship, internship,
job, or summer program, and StarScholar:

1. **Watches the video** — Gemini reads the spoken audio and on-screen text, because
   the details are almost never in the caption ("comment for the link!"). Falls back
   to the caption + cover image when the video can't be downloaded
2. Extracts *every* opportunity the video names (one video often lists five)
3. Searches the web for the **official** page (Tavily / Brave / Serper — auto-detected),
   then crawls that site for the page that actually holds the deadline and apply form
4. Cross-checks the video's claims against the official page with Gemini
5. Returns a card with a fact-check badge (🟢 verified / 🟡 exaggerated / 🔴 expired / ⚪ unverified),
   the direct application link, the real deadline, eligibility, and a step-by-step
   application checklist

Results **stream in as they're verified**: the opportunities are named within a few
seconds and each card fills itself in as its own fact-check lands.

## Setup

```bash
npm install
copy .env.local.example .env.local   # then fill in your keys
npm run dev
```

You need two keys in `.env.local` — both free, no credit card:

| Key | Where to get it |
|---|---|
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) → "Get API key" (free tier) |
| `TAVILY_API_KEY` | [app.tavily.com](https://app.tavily.com) — 1,000 free searches/month |

`BRAVE_API_KEY` and `SERPER_API_KEY` also work (the search step auto-detects
whichever is set). Optional: `GEMINI_MODEL` overrides the default
`gemini-2.5-flash`.

Smoke-test your Gemini key any time with:

```bash
node --env-file=.env.local scripts/smoke-gemini.mjs
```

**Optional but recommended: yt-dlp** (`winget install yt-dlp.yt-dlp`). With it
installed, videos whose captions are engagement bait ("comment for the link!")
get downloaded and *watched* by Gemini — speech and on-screen text included.
Without it, the pipeline still works from captions and cover images and the
video rung is skipped automatically. If the binary isn't on the server's PATH,
set `YTDLP_PATH=C:\path\to\yt-dlp.exe` in `.env.local`.

## How it's wired

Everything funnels into one endpoint:

- `GET /api/check?url=<video url>` — the single front door (works for the paste box,
  an iOS Shortcut, a future PWA share target, or a bot)
- `POST /api/check` with `{ url, caption? }` — same thing, plus an optional pasted
  caption for when the platform blocks automatic reading (Instagram often does)
- `POST /api/check` with `{ url, stream: true }` — newline-delimited JSON, one event
  per line (`meta`, then an `opportunity` per card, then `done`). The web UI uses this;
  the plain forms return a single buffered JSON object and stay unchanged

Code map:

- [src/lib/video.ts](src/lib/video.ts) — pulls the caption + cover image via oEmbed (TikTok/YouTube) or `og:` meta tags (Instagram)
- [src/lib/videofile.ts](src/lib/videofile.ts) — downloads the actual video with yt-dlp when the caption/cover aren't enough
- [src/lib/pipeline.ts](src/lib/pipeline.ts) — the multimodal Gemini calls (extract from text/image/video → verify) + search (Tavily/Brave/Serper) + page scraping
- [src/lib/types.ts](src/lib/types.ts) — Zod schemas used for the structured outputs and shared with the frontend
- [src/app/api/check/route.ts](src/app/api/check/route.ts) — orchestrates the pipeline
- [src/app/check/page.tsx](src/app/check/page.tsx) — the result card
- [src/app/page.tsx](src/app/page.tsx) — landing page with paste box + Shortcut instructions

## Accounts & My List (optional)

Signed-in users get a private **My List**: every video they check is saved
automatically (row-level security — only they can read their rows) so they can
revisit cards without re-pasting links. Re-checking the same URL updates the
saved card instead of duplicating it.

To enable it (free, no card):

1. Create a project at [supabase.com](https://supabase.com)
2. Open the project's **SQL Editor**, paste [supabase/schema.sql](supabase/schema.sql), Run
3. Copy **Project Settings → API** values into `.env.local`:
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Until those vars exist, the whole feature stays dormant and the app works
exactly as before. Sign-in is passwordless (emailed magic link).

## iOS Shortcut (two taps from inside TikTok)

1. Shortcuts app → **+** → rename it "StarScholar"
2. Shortcut settings → enable **Show in Share Sheet**, accept **URLs**
3. Add one action: **Open URL** → `https://<your-deployment>/check?url=` + `Shortcut Input`
4. Now: watch video → Share → StarScholar → verified card

## Regression testing

Every real video that ever exposed a bug lives in
[scripts/test-links.json](scripts/test-links.json). Run the whole set through
the pipeline any time:

```bash
node scripts/regression.mjs          # allows cache hits (fast, free)
node scripts/regression.mjs --fresh  # full re-verification of every link
```

When a result looks wrong: add the link to `test-links.json`, fix the
pipeline, and re-run the suite — a fix for one video must never break another.

## Design principles

- **Unknown means null, never a guess.** If the official page doesn't state a fact,
  the card says "Not listed — check the official page."
- **Every field comes from the verification scrape, not the video.** The video only
  tells us what to search for.
- **Social video is ephemeral input.** We extract facts and link back to the original —
  we never download or rehost media.
