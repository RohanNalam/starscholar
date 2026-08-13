// Probe: which no-auth technique can read an Instagram caption?
// Run: node scripts/probe-instagram.mjs <reel url>
const url = process.argv[2] ?? "https://www.instagram.com/reel/DajJNLNRh9k/";
const code = url.match(/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/)?.[1];
console.log("shortcode:", code);

const BOT_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function probe(label, target, ua) {
  try {
    const res = await fetch(target, {
      headers: { "User-Agent": ua, Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    const html = res.ok ? await res.text() : "";
    const ogDesc = html.match(
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i
    )?.[1] ?? html.match(
      /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i
    )?.[1];
    const ogTitle = html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i
    )?.[1];
    const jsonCaption = html.match(/"edge_media_to_caption"[\s\S]{0,200}?"text":"((?:[^"\\]|\\.)*)"/)?.[1];
    const captionDiv = html.match(/<div class="Caption"[\s\S]{0,3000}?<\/div>/)?.[0];
    console.log(`\n─── ${label} ─── status=${res.status} len=${html.length}`);
    console.log("og:title:", ogTitle?.slice(0, 120) ?? null);
    console.log("og:description:", ogDesc?.slice(0, 300) ?? null);
    console.log("json caption:", jsonCaption?.slice(0, 300) ?? null);
    console.log("Caption div present:", Boolean(captionDiv), captionDiv ? `(${captionDiv.length} chars)` : "");
  } catch (e) {
    console.log(`\n─── ${label} ─── ERROR: ${e.message}`);
  }
}

await probe("embed/captioned + bot UA", `https://www.instagram.com/p/${code}/embed/captioned/`, BOT_UA);
await probe("embed/captioned + chrome UA", `https://www.instagram.com/p/${code}/embed/captioned/`, CHROME_UA);
await probe("main URL + bot UA", url, BOT_UA);
await probe("main URL + chrome UA", url, CHROME_UA);
