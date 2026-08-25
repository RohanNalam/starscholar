# StarScholar

**The link they never put in the caption.**

You have seen these videos. "This scholarship gives you $10,000 and nobody applies."
"Google just opened applications for freshmen." Then you check the caption and there is
no link, just "comment LINK and I'll send it," and 4,000 people in the replies asking
for something that never arrives.

StarScholar takes that video and gives you the actual thing: where to apply, when it
closes, whether you qualify, and which parts of the video were not true.

## How it works

Paste a TikTok, Instagram Reel, or YouTube Short. About twenty seconds later you get a
card for every opportunity the video mentioned.

Here is a real one. The video was about a NASA and Hack Club coding challenge:

| | |
|---|---|
| **Status** | Exaggerated |
| **Deadline** | September 30, 2026 |
| **Apply** | stardance.hackclub.com |
| **Cost** | Free |
| **Who can apply** | Ages 13 to 18 |
| **What the video got wrong** | It said winners get flown to San Francisco to present at AMD's AI conference. The official page does not offer that. It also said your project has to use real NASA data. It does not, you can build anything open source. |

That last row is the point. The deadline and the link matter, but so does knowing the
video oversold it before you spend a weekend on an application.

## Why not just ask ChatGPT

People try. Two things go wrong.

The chatbot usually cannot see the video, because Instagram and TikTok block it. So it
guesses from the URL and its training data, and it sounds confident either way.

Even when it can see the video, it does not know today's deadline. Scholarship cycles
reopen every year with new dates, and a model trained months ago will hand you last
year's. Missing a deadline because something invented one is worse than getting no
answer at all.

StarScholar reads the official page while you wait and stamps the card with the date it
checked. Everything on the card comes off that page. If the page does not say something,
the card says it does not say, instead of filling in a plausible guess.

## What the app has

**Fact-check badges.** Green means the official page backs up the video. Yellow means
something got left out, like a GPA cutoff or a citizenship requirement. Red means it
already closed. Grey means we could not find an official page, and we tell you that
rather than pretending.

**Deep application links.** The info page is rarely the application. The real form is
usually a click or two further in, on a portal like Submittable or Workday. StarScholar
follows those links and gives you the one you actually need.

**Add to calendar.** One tap puts the deadline in Google Calendar or Apple Calendar,
with reminders a week out and the day before.

**Deadline emails.** If you save something, you get an email when it is about to close.
Once a week out, once the day before.

**A saved list.** Sign in and everything you look up is kept for you. Nobody else can
see it, and items drop off on their own once the deadline passes.

**A public directory.** Every opportunity anyone has looked up is browsable at `/browse`,
sorted by deadline, and rechecked on a schedule so closed ones do not sit around looking
open.

**Two taps from TikTok.** An iOS Shortcut puts StarScholar in your share sheet, so you
never have to copy a link or leave the app you were scrolling.

## What happens under the hood

1. **It watches the video.** Not the caption, the video. Creators put the real
   information in the audio and in text on screen, and leave bait in the caption. Gemini
   watches the file and reads both.
2. **It pulls out every opportunity.** One video often lists five. Each gets its own card.
3. **It searches for the official page**, then crawls that site for the page that
   actually holds the deadline and the application form.
4. **It compares.** What the video claimed versus what the official page says, which is
   where the badge and the "what the video got wrong" list come from.

Results stream in as they finish, so you see what the video mentioned within a few
seconds and each card fills itself in as its check completes, instead of watching one
spinner for the whole thing.

Three rules the code sticks to: a fact never comes from the video or from the model's
memory, only from the official page. Anything the page does not state stays blank. And
if the only pages found describe last year's cycle, it says so rather than showing you
old dates as if they were current.

## Running it yourself

```bash
npm install
npm run dev
```

Two keys in `.env.local`, both free and neither needs a card:

| Key | Where |
|---|---|
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com), "Get API key" |
| `TAVILY_API_KEY` | [app.tavily.com](https://app.tavily.com), 1,000 searches a month |

`BRAVE_API_KEY` and `SERPER_API_KEY` work too, whichever is set gets used. Check your
Gemini key with `node --env-file=.env.local scripts/smoke-gemini.mjs`.

### Watching the video

This is the rung that matters, because a creator who says "comment for the link" has put
everything you need in the audio. There are two ways to get the file, and the app tries
them in that order.

**yt-dlp** (`winget install yt-dlp.yt-dlp`) is free and fast, and it is all you need
while developing. It will not work on a deployed server: Instagram and TikTok block
datacenter IP ranges, and every serverless host runs on those.

**Apify** is the answer for anything deployed. It is a hosted scraping service with its
own proxy pool, so the request does not come from a blocked address. Sign up at
[apify.com](https://apify.com), take the token from Settings, Integrations, and set:

| Key | Notes |
|---|---|
| `APIFY_TOKEN` | The only one required |
| `APIFY_INSTAGRAM_ACTOR` | Optional, defaults to `apify~instagram-scraper` |
| `APIFY_TIKTOK_ACTOR` | Optional, defaults to `clockworks~tiktok-scraper` |

The free plan gives $5 of credit every month and needs no card. Reel scraping runs about
$1 per thousand, so that covers a few thousand lookups a month. The actor IDs are
configurable because the best one for a platform changes over time, and swapping it
should not need a code change.

With neither of these the app still runs, it just falls back to the caption and cover
image, and asks you to type what the video said when the caption is pure bait.

### Accounts, saved lists, and the directory

Create a free project at [supabase.com](https://supabase.com), run
[supabase/schema.sql](supabase/schema.sql) in its SQL Editor, then add
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from Project Settings, API.

### Deadline emails and daily upkeep

| Key | What it does |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Lets the scheduled job read saved rows. A cron has no signed-in user, so row-level security hides everything from the normal key. Keep this secret. |
| `RESEND_API_KEY` | Sending, via [resend.com](https://resend.com). Without it the job still runs and reports what it would have sent, so you can test first. |
| `RECHECK_SECRET` | Any random string. Guards the scheduled endpoints. |
| `NEXT_PUBLIC_SITE_URL` | Your deployed URL, used for links inside the emails. |

[.github/workflows/daily.yml](.github/workflows/daily.yml) runs it once a day on GitHub
Actions for free. Preview it without sending anything:

```
GET /api/remind?secret=<RECHECK_SECRET>&dry=1
```

## The API

Everything goes through one endpoint, whether it came from the paste box, the Shortcut,
or something else:

- `GET /api/check?url=<video>` returns one JSON object
- `POST /api/check` with `{ url, caption? }` does the same, plus an optional caption you
  typed yourself for when a platform blocks us
- `POST /api/check` with `{ url, stream: true }` streams newline-delimited JSON, one
  event per line. This is what the site uses.

## Where the code lives

| Path | What's in it |
|---|---|
| [src/lib/video.ts](src/lib/video.ts) | Caption and cover image from a URL |
| [src/lib/videofile.ts](src/lib/videofile.ts) | Downloading the video with yt-dlp |
| [src/lib/pipeline.ts](src/lib/pipeline.ts) | The Gemini calls, search, page fetching, crawling |
| [src/lib/types.ts](src/lib/types.ts) | Zod schemas, shared by the API and the frontend |
| [src/app/api/check/route.ts](src/app/api/check/route.ts) | Runs the whole thing and streams it |
| [src/components/result-card.tsx](src/components/result-card.tsx) | The card |
| [scripts/regression.mjs](scripts/regression.mjs) | Runs every known test video through the live pipeline |

Built with Next.js, Gemini, Tavily, and Supabase.
