import { NextRequest, NextResponse } from "next/server";
import { fetchVideoText } from "@/lib/video";
import {
  extractOpportunity,
  fetchImagePart,
  fetchPageText,
  verifyClaim,
  hasSearchProvider,
  type SourcePage,
} from "@/lib/pipeline";
import { downloadVideo } from "@/lib/videofile";
import type {
  CheckResult,
  CheckError,
  CheckEvent,
  Extraction,
  ExtractedOpportunity,
  VerifiedOpportunity,
  CardData,
} from "@/lib/types";
import { supabaseServer } from "@/lib/supabase/server";

export const maxDuration = 120; // the video-watching rung needs headroom

const MAX_OPPORTUNITIES = 5; // per video, bounds search credits and latency

function err(message: string, status = 400, needsCaption = false) {
  const body: CheckError = { ok: false, error: message, needsCaption };
  return NextResponse.json(body, { status });
}

// Stage timings, printed per lookup so slow steps are visible instead of
// hiding inside one long spinner.
function stopwatch() {
  const t0 = Date.now();
  let last = t0;
  const marks: string[] = [];
  return {
    mark(label: string) {
      const now = Date.now();
      marks.push(`${label} ${((now - last) / 1000).toFixed(1)}s`);
      last = now;
    },
    report(prefix: string) {
      console.log(
        `[check] ${prefix}, ${marks.join(" · ")} · TOTAL ${((Date.now() - t0) / 1000).toFixed(1)}s`
      );
    },
  };
}

function fail(error: string, status = 400, needsCaption = false): CheckEvent {
  return { type: "error", error, status, needsCaption };
}

async function* runCheck(
  videoUrl: string,
  pastedCaption: string | null,
  refresh = false
): AsyncGenerator<CheckEvent> {
  let parsed: URL;
  try {
    parsed = new URL(videoUrl);
  } catch {
    yield fail("That doesn't look like a valid URL.");
    return;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    yield fail("Only http(s) links are supported.");
    return;
  }
  if (!process.env.GEMINI_API_KEY) {
    yield fail("The server is missing GEMINI_API_KEY. Add it to .env.local.", 500);
    return;
  }
  if (!hasSearchProvider()) {
    yield fail(
      "The server has no search API key. Add TAVILY_API_KEY to .env.local, free at app.tavily.com.",
      500
    );
    return;
  }

  // 0. Shared cache, if anyone already verified this video recently, serve it
  //    instantly: zero Gemini/Tavily quota, sub-second response.
  if (!pastedCaption && !refresh) {
    const cached = await readSharedCache(videoUrl);
    if (cached) {
      yield { type: "meta", result: { ...cached, opportunities: [] }, claimed: [] };
      yield { type: "done", result: cached };
      await saveAllToMyList(videoUrl, cached); // still lands in this user's My List
      return;
    }
  }

  // 1. Fetch the platform metadata AND the video file itself, in parallel.
  //    The caption/cover are hints; the video is ground truth, the details
  //    usually live in the spoken audio and on-screen text, not in metadata.
  const timer = stopwatch();
  const [video, file] = await Promise.all([fetchVideoText(videoUrl), downloadVideo(videoUrl)]);
  timer.mark(file ? `download(${(file.base64.length / 1.37e6).toFixed(1)}MB)` : "download(none)");
  const caption = pastedCaption?.trim() || video.caption;

  let extraction: Extraction | null = null;
  let analyzedWith = "the caption";

  const hasOpps = (e: Extraction | null): boolean =>
    Boolean(e?.is_opportunity && e.opportunities.length > 0);

  // Primary rung: the model watches the actual video (plus the caption).
  if (file) {
    extraction = await extractOpportunity(caption, video.author, {
      part: { inlineData: { mimeType: file.mimeType, data: file.base64 } },
      kind: "video",
    });
    analyzedWith = "the full video (audio + on-screen text)";
    timer.mark("watch-video");
  }

  // Fallback rungs, only when the video couldn't be downloaded (e.g. yt-dlp
  // missing on the server) or watching it identified nothing.
  if (!hasOpps(extraction)) {
    const thumbPart = video.thumbnail ? await fetchImagePart(video.thumbnail) : null;
    if (caption || thumbPart) {
      const fromMeta = await extractOpportunity(
        caption,
        video.author,
        thumbPart ? { part: thumbPart, kind: "image" } : undefined
      );
      if (hasOpps(fromMeta) || !extraction) {
        extraction = fromMeta;
        analyzedWith =
          caption && thumbPart
            ? "the caption + cover image"
            : thumbPart
              ? "the cover image"
              : "the caption";
      }
    }
  }

  if (!extraction) {
    yield fail(
      "We couldn't read anything off this video. The platform blocked us. Paste the caption text and try again.",
      422,
      true
    );
    return;
  }

  const checkedAt = new Date().toISOString();
  const body: CheckResult = {
    ok: true,
    videoUrl,
    platform: video.platform,
    caption,
    author: video.author,
    checkedAt,
    analyzedWith,
    opportunities: [],
  };

  const claimedList = extraction.is_opportunity
    ? extraction.opportunities.filter((o) => o.search_query?.trim()).slice(0, MAX_OPPORTUNITIES)
    : [];

  // The names are known now, but verifying them takes another ~20s. Send them
  // immediately so the page can show what it found and fill in the details.
  yield { type: "meta", result: body, claimed: claimedList };

  if (claimedList.length === 0) {
    yield { type: "done", result: body }; // not an opportunity video
    return;
  }

  // 2. Follow links in the caption, creators' pages (often aggregator blogs)
  //    usually deep-link the real application URLs. The verifier may mine
  //    them for official links but never cites them as official.
  const captionUrls = (caption?.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? [])
    .filter((u) => !/instagram\.com|tiktok\.com|youtube\.com|youtu\.be/i.test(u))
    .slice(0, 2);
  //    These are a bonus signal, not the source of truth, so they get a hard
  //    budget: a slow aggregator once held every card back by 43 seconds.
  const CREATOR_LINK_BUDGET_MS = 15000;
  const captionPages = (
    await Promise.all(
      captionUrls.map(async (u) => ({
        url: u,
        title: `[linked by the creator] ${u}`,
        text:
          (await Promise.race([
            fetchPageText(u),
            new Promise<null>((r) => setTimeout(() => r(null), CREATOR_LINK_BUDGET_MS)),
          ])) ?? "",
      }))
    )
  ).filter((p) => p.text.length > 200);

  // 3. Verify every opportunity in parallel, each gets its own search,
  //    official-page scrape, and fact-check. One failure never sinks the rest.
  const todayISO = checkedAt.slice(0, 10);
  timer.mark("creator-links");

  // All verifications run at once; each is emitted the instant it finishes, so
  // a slow one never holds up the cards behind it. `results` stays in the
  // video's original order regardless of who finishes first.
  const results: VerifiedOpportunity[] = new Array(claimedList.length);
  const pending = new Map<number, Promise<{ index: number; data: VerifiedOpportunity }>>();
  claimedList.forEach((claimed, index) => {
    pending.set(
      index,
      verifyOne(claimed, caption, todayISO, captionPages).then((data) => ({ index, data }))
    );
  });
  while (pending.size > 0) {
    const { index, data } = await Promise.race(pending.values());
    pending.delete(index);
    results[index] = data;
    yield { type: "opportunity", index, data };
  }
  body.opportunities = results;
  timer.mark(`verify(${claimedList.length})`);

  // Persistence happens after the cards are already on screen, so the two
  // Supabase round trips never sit between the user and their results.
  await Promise.all([writeSharedCache(body), saveAllToMyList(videoUrl, body)]);
  timer.mark("save");
  timer.report(videoUrl);
  yield { type: "done", result: body };
}

const CACHE_FRESH_DAYS = 7;

// Names currently stored for a video that this check didn't produce, leftovers
// from an earlier run that named the same program differently.
async function staleNames(
  query: PromiseLike<{ data: { name: string | null }[] | null }>,
  keep: string[]
): Promise<string[]> {
  const { data } = await query;
  const fresh = new Set(keep);
  return (data ?? [])
    .map((row) => row.name)
    .filter((name): name is string => Boolean(name) && !fresh.has(name!));
}

// Serve a recent verification of the same video from the shared directory.
async function readSharedCache(videoUrl: string): Promise<CheckResult | null> {
  try {
    const supabase = await supabaseServer();
    if (!supabase) return null;
    const { data, error } = await supabase
      .from("opportunities")
      .select("*")
      .eq("video_url", videoUrl);
    if (error || !data || data.length === 0) return null;

    const newest = data.reduce((a, b) => (a.checked_at > b.checked_at ? a : b));
    const ageMs = Date.now() - new Date(newest.checked_at).getTime();
    if (ageMs > CACHE_FRESH_DAYS * 24 * 3600 * 1000) return null; // stale, re-verify

    // Every row a single check produces shares one checked_at, so keeping just
    // the newest batch drops rows left over from an earlier run that named the
    // same program differently, otherwise one video looks like three.
    const batch = data.filter((row) => row.checked_at === newest.checked_at);

    return {
      ok: true,
      videoUrl,
      platform: newest.platform ?? "unknown",
      caption: newest.caption ?? null,
      author: newest.author ?? null,
      checkedAt: newest.checked_at,
      analyzedWith: `${newest.analyzed_with ?? "a previous check"}, cached, verified ${new Date(newest.checked_at).toLocaleDateString()}`,
      opportunities: batch.map((row) => row.result as VerifiedOpportunity),
    };
  } catch (e) {
    console.warn("shared cache read failed:", e);
    return null;
  }
}

// Every verified opportunity joins the public directory (archive-not-delete:
// nightly rechecks flip status to expired, rows stay for cycle prediction).
async function writeSharedCache(result: CheckResult): Promise<void> {
  try {
    const supabase = await supabaseServer();
    if (!supabase) return;
    // One upsert for every opportunity, a five-opportunity video used to cost
    // five sequential round trips before the response could be returned.
    const rows = result.opportunities
      .filter((opp) => opp.verification)
      .map((opp) => {
        const v = opp.verification!;
        return {
          video_url: result.videoUrl,
          platform: result.platform,
          author: result.author,
          caption: result.caption,
          analyzed_with: result.analyzedWith,
          name: v.name,
          organization: v.organization,
          type: v.type,
          status: v.status,
          deadline: v.deadline,
          deadline_date: v.deadline_iso,
          result: opp,
          checked_at: result.checkedAt,
        };
      });
    if (rows.length === 0) return;
    const { error } = await supabase
      .from("opportunities")
      .upsert(rows, { onConflict: "video_url,name" });
    if (error) {
      console.warn("shared cache write failed:", error.message);
      return;
    }

    // Rows are keyed by (video_url, name), so if a re-check names the same
    // program slightly differently ("Stardance" → "Stardance Challenge") the old
    // row survives and the video appears to contain two opportunities. Drop any
    // row for this video that this check didn't just produce.
    const stale = await staleNames(
      supabase.from("opportunities").select("name").eq("video_url", result.videoUrl),
      rows.map((r) => r.name)
    );
    if (stale.length > 0) {
      await supabase
        .from("opportunities")
        .delete()
        .eq("video_url", result.videoUrl)
        .in("name", stale);
    }
  } catch (e) {
    console.warn("shared cache write failed:", e);
  }
}

async function verifyOne(
  claimed: ExtractedOpportunity,
  caption: string | null,
  todayISO: string,
  captionPages: SourcePage[] = []
): Promise<VerifiedOpportunity> {
  try {
    const { verification, sources } = await verifyClaim(claimed, caption, todayISO, captionPages);
    return { claimed, verification, sources };
  } catch (e) {
    console.warn(`verify failed for "${claimed.program_name ?? claimed.search_query}":`, e);
    return { claimed, verification: null, sources: [] };
  }
}

// Each verified opportunity becomes its own private My List row, so each can
// expire (and auto-delete) on its own deadline. RLS scopes rows to the user;
// save failures never break the lookup.
async function saveAllToMyList(videoUrl: string, result: CheckResult): Promise<void> {
  try {
    const supabase = await supabaseServer();
    if (!supabase) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const saved = result.opportunities.filter((opp) => opp.verification);
    if (saved.length === 0) return;
    const rows = saved.map((opp) => {
      const v = opp.verification!;
      const card: CardData & { videoUrl: string; analyzedWith?: string } = {
        verification: v,
        sources: opp.sources,
        checkedAt: result.checkedAt,
        videoUrl,
        analyzedWith: result.analyzedWith,
      };
      return {
        user_id: user.id,
        video_url: videoUrl,
        result: card,
        status: v.status,
        type: v.type,
        name: v.name,
        organization: v.organization,
        deadline: v.deadline,
        deadline_date: v.deadline_iso,
      };
    });
    const { error } = await supabase
      .from("lookups")
      .upsert(rows, { onConflict: "user_id,video_url,name" });
    if (error) {
      console.warn("My List save failed:", error.message);
      return;
    }
    for (const opp of saved) opp.saved = true;

    // Same name-drift cleanup as the shared directory, scoped to this user.
    const stale = await staleNames(
      supabase
        .from("lookups")
        .select("name")
        .eq("user_id", user.id)
        .eq("video_url", videoUrl),
      rows.map((r) => r.name)
    );
    if (stale.length > 0) {
      await supabase
        .from("lookups")
        .delete()
        .eq("user_id", user.id)
        .eq("video_url", videoUrl)
        .in("name", stale);
    }
  } catch (e) {
    console.warn("My List save failed:", e);
  }
}

// Replay the event stream into a single response, what the Shortcut, the
// regression script, and any plain API caller get.
async function buffered(events: AsyncGenerator<CheckEvent>) {
  let last: CheckResult | null = null;
  for await (const ev of events) {
    if (ev.type === "error") return err(ev.error, ev.status, ev.needsCaption);
    if (ev.type === "meta" || ev.type === "done") last = ev.result;
  }
  if (!last) return err("Something went wrong.", 500);
  return NextResponse.json(last);
}

// Newline-delimited JSON: one event per line, flushed as it happens.
function streamed(events: AsyncGenerator<CheckEvent>) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of events) {
          controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
        }
      } catch (e) {
        console.error(e);
        const message = e instanceof Error ? e.message : "Something went wrong.";
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ type: "error", error: message, status: 500 })}\n`)
        );
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // stop any proxy from buffering the whole stream before forwarding it
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return err("Missing ?url= parameter.");
  try {
    return await buffered(runCheck(url, null));
  } catch (e) {
    console.error(e);
    return err(e instanceof Error ? e.message : "Something went wrong.", 500);
  }
}

export async function POST(req: NextRequest) {
  let body: { url?: string; caption?: string; refresh?: boolean; stream?: boolean };
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body.");
  }
  if (!body.url) return err("Missing 'url' in body.");
  const events = runCheck(body.url, body.caption ?? null, body.refresh === true);
  if (body.stream) return streamed(events);
  try {
    return await buffered(events);
  } catch (e) {
    console.error(e);
    return err(e instanceof Error ? e.message : "Something went wrong.", 500);
  }
}
