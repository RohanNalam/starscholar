// Downloads a short-form video with yt-dlp so Gemini can watch it (speech +
// on-screen text). yt-dlp is an optional dependency: if the binary isn't on
// PATH (e.g. on Vercel) every function here degrades to null and the pipeline
// falls back to caption/thumbnail analysis.
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readFile, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const pExecFile = promisify(execFile);

const MAX_BYTES = 19 * 1024 * 1024; // Gemini inline request cap is ~20MB

// The dev server may have been launched before yt-dlp was installed, so PATH
// alone isn't reliable — probe known locations too (winget links/packages).
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
  console.warn("yt-dlp not found — video-watching rung disabled (set YTDLP_PATH to enable)");
  return ytdlpBin;
}

const EXT_MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
};

export async function downloadVideo(
  url: string
): Promise<{ base64: string; mimeType: string } | null> {
  const bin = await resolveYtDlp();
  if (!bin) return null;

  const dir = await mkdtemp(path.join(tmpdir(), "starscholar-"));
  try {
    // smallest available rendition — we only need legible text and audio
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
