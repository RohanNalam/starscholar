// Gets the video file so Gemini can watch it (speech + on-screen text), which
// is the only rung that works when the caption is bait.
//
// Two ways to get it, tried in order:
//
//   1. yt-dlp on this machine. Free and fast, but it needs the binary AND a
//      residential IP. Instagram and TikTok block datacenter ranges, so this
//      works while developing and never works on Vercel.
//   2. Apify. A hosted scraping service with its own proxy pool, which is what
//      makes it work from a serverless host. Costs a fraction of a cent per
//      lookup, so it runs only after yt-dlp has failed or is missing.
//
// If neither is available the pipeline falls back to caption/cover analysis.
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readFile, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const pExecFile = promisify(execFile);

const MAX_BYTES = 19 * 1024 * 1024; // Gemini inline request cap is ~20MB

// The dev server may have been launched before yt-dlp was installed, so PATH
// alone isn't reliable, probe known locations too (winget links/packages).
function ytDlpCandidates(): string[] {
  const c = [process.env.YTDLP_PATH, "yt-dlp"];
  const local = process.env.LOCALAPPDATA;
  if (local) {
    c.push(
      `${local}\\Microsoft\\WinGet\\Links\\yt-dlp.exe`,
      `${local}\\Microsoft\\WinGet\\Packages\\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\\yt-dlp.exe`
    );
  }
  return c.filter((x): x is string => Boolean(x));
}

let ytdlpBin: string | null | undefined; // undefined = not probed yet

export async function resolveYtDlp(): Promise<string | null> {
  if (ytdlpBin !== undefined) return ytdlpBin;
  for (const candidate of ytDlpCandidates()) {
    try {
      await pExecFile(candidate, ["--version"], { timeout: 15000 });
      ytdlpBin = candidate;
      return ytdlpBin;
    } catch {
      // try the next one
    }
  }
  ytdlpBin = null;
  console.warn("yt-dlp not found, video-watching rung disabled (set YTDLP_PATH to enable)");
  return ytdlpBin;
}

const EXT_MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
};

export type VideoFile = { base64: string; mimeType: string };

export async function downloadVideo(url: string): Promise<VideoFile | null> {
  // yt-dlp first: it costs nothing, so Apify credit is only spent when the
  // free path is unavailable (which on a deployed server is always).
  const local = await downloadWithYtDlp(url);
  if (local) return local;
  return downloadViaApify(url);
}

async function downloadWithYtDlp(url: string): Promise<VideoFile | null> {
  const bin = await resolveYtDlp();
  if (!bin) return null;

  const dir = await mkdtemp(path.join(tmpdir(), "starscholar-"));
  try {
    // smallest available rendition, we only need legible text and audio
    await pExecFile(
      bin,
      [
        "-f",
        "worst[ext=mp4]/worst",
        "--max-filesize",
        "19M",
        "--no-playlist",
        // Default retry counts are tuned for unattended archiving; here a slow
        // failure just delays the caption fallback, so give up quickly.
        "--retries",
        "2",
        "--fragment-retries",
        "2",
        "--socket-timeout",
        "15",
        "--concurrent-fragments",
        "4",
        "--no-warnings",
        "--no-part",
        "-o",
        path.join(dir, "video.%(ext)s"),
        url,
      ],
      { timeout: 60000 }
    );

    const files = await readdir(dir);
    const file = files.find((f) => f.startsWith("video."));
    if (!file) return null;
    const ext = file.split(".").pop()?.toLowerCase() ?? "";
    const mimeType = EXT_MIME[ext];
    if (!mimeType) return null;

    const buf = await readFile(path.join(dir, file));
    if (buf.length === 0 || buf.length > MAX_BYTES) return null;
    return { base64: buf.toString("base64"), mimeType };
  } catch (e) {
    console.warn("yt-dlp download failed:", e instanceof Error ? e.message : e);
    return null;
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Apify ───────────────────────────────────────────────────────────────────
// Actors are addressed with a tilde in the API path (apify~instagram-scraper).
// Both are overridable, because the actor that works best for a platform
// changes over time and swapping one should not need a code change.
const ACTORS = {
  instagram: process.env.APIFY_INSTAGRAM_ACTOR || "apify~instagram-scraper",
  tiktok: process.env.APIFY_TIKTOK_ACTOR || "clockworks~tiktok-scraper",
};

function actorFor(url: string): string | null {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (host.includes("instagram")) return ACTORS.instagram;
  if (host.includes("tiktok")) return ACTORS.tiktok;
  return null; // YouTube captions are readable without scraping
}

const VIDEO_KEYS =
  /^(videourl|videourlnowatermark|video_url|downloadurl|download_url|mediaurl|mp4|videolink)$/i;

// Actors disagree about what the video field is called, and a new one appears
// every few months. Rather than pin to one actor's schema, walk the response
// for anything that looks like a video URL.
function findVideoUrl(node: unknown, depth = 0): string | null {
  if (depth > 6 || node === null) return null;
  if (typeof node === "string") {
    return /^https?:\/\/\S+\.mp4(\?|$)/i.test(node) ? node : null;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findVideoUrl(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node === "object") {
    const entries = Object.entries(node as Record<string, unknown>);
    // a field actually named like a video URL wins over an incidental .mp4
    for (const [key, value] of entries) {
      if (VIDEO_KEYS.test(key) && typeof value === "string" && /^https?:\/\//.test(value)) {
        return value;
      }
    }
    for (const [, value] of entries) {
      const hit = findVideoUrl(value, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

async function downloadViaApify(url: string): Promise<VideoFile | null> {
  const token = process.env.APIFY_TOKEN;
  const actor = actorFor(url);
  if (!token || !actor) return null;

  try {
    // run-sync-get-dataset-items runs the actor and returns its output in one
    // request, so there is no run to poll. The token goes in a header rather
    // than the query string to keep it out of logs.
    const res = await fetch(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=90`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          directUrls: [url],
          urls: [url], // some actors name the input differently
          resultsType: "posts",
          resultsLimit: 1,
        }),
        signal: AbortSignal.timeout(100000),
      }
    );
    if (!res.ok) {
      console.warn(`Apify ${actor} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return null;
    }

    const videoUrl = findVideoUrl(await res.json());
    if (!videoUrl) {
      console.warn(`Apify ${actor} returned no video URL for ${url}`);
      return null;
    }
    return fetchVideoBytes(videoUrl);
  } catch (e) {
    console.warn("Apify lookup failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// The CDN link Apify hands back is signed and fetchable from anywhere, so this
// part works fine from a serverless host.
async function fetchVideoBytes(videoUrl: string): Promise<VideoFile | null> {
  try {
    const res = await fetch(videoUrl, { signal: AbortSignal.timeout(45000) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type")?.split(";")[0] ?? "";
    const mimeType = type.startsWith("video/") || type.startsWith("audio/") ? type : "video/mp4";

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) {
      console.warn(`video is ${(buf.length / 1e6).toFixed(1)}MB, too big to inline`);
      return null;
    }
    return { base64: buf.toString("base64"), mimeType };
  } catch (e) {
    console.warn("fetching the video file failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
