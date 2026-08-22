// Pull whatever public text we can get for a short-form video URL.
// Strategy per platform:
//  - TikTok / YouTube: public oEmbed endpoints (no auth)
//  - Instagram: crawler user-agent (IG serves og: tags to link-preview bots),
//    then the /embed/captioned/ endpoint (built for blog embeds, no login wall)
//  - anything else: og: meta tags
// If everything fails we return nulls and the API asks the user to paste the caption.

export type VideoText = {
  platform: "tiktok" | "instagram" | "youtube" | "unknown";
  caption: string | null;
  author: string | null;
  thumbnail: string | null; // cover image URL, often has the hook text baked in
};

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
// Instagram login-walls browsers but serves link-preview crawlers.
const BOT_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

function detectPlatform(url: string): VideoText["platform"] {
  const h = new URL(url).hostname.toLowerCase();
  if (h.includes("tiktok")) return "tiktok";
  if (h.includes("instagram")) return "instagram";
  if (h.includes("youtube") || h.includes("youtu.be")) return "youtube";
  return "unknown";
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": CHROME_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fetchHtml(url: string, ua: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": ua, Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function metaContent(html: string, property: string): string | null {
  // matches <meta property="og:title" content="..."> in either attribute order
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1]);
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// Instagram og:title looks like: `Author Name on Instagram: "caption text"`
// og:description looks like: `18 likes, 1 comments - username on July 8, 2026: "caption text"`
async function fetchInstagramText(videoUrl: string): Promise<VideoText | null> {
  const html = await fetchHtml(videoUrl, BOT_UA);
  if (html) {
    const thumbnail = metaContent(html, "og:image");
    const title = metaContent(html, "og:title");
    const fromTitle = title?.match(/^([\s\S]+?) on Instagram:\s*"([\s\S]+)"\s*$/);
    if (fromTitle?.[2]) {
      return {
        platform: "instagram",
        caption: fromTitle[2].trim(),
        author: fromTitle[1].trim(),
        thumbnail,
      };
    }
    const desc = metaContent(html, "og:description");
    if (desc) {
      const fromDesc = desc.match(
        /^[\d,.]+[KM]? likes?, [\d,.]+[KM]? comments? - ([A-Za-z0-9._]+) on [^:]+:\s*"([\s\S]+)"\s*$/
      );
      if (fromDesc?.[2]) {
        return {
          platform: "instagram",
          caption: fromDesc[2].trim(),
          author: fromDesc[1],
          thumbnail,
        };
      }
      return { platform: "instagram", caption: desc.trim(), author: null, thumbnail };
    }
    if (thumbnail) {
      return { platform: "instagram", caption: null, author: null, thumbnail };
    }
  }

  // Backup: the embed page ships the caption in a <div class="Caption">
  const code = videoUrl.match(/(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/)?.[1];
  if (code) {
    const embedHtml = await fetchHtml(
      `https://www.instagram.com/p/${code}/embed/captioned/`,
      BOT_UA
    );
    const div = embedHtml?.match(/<div class="Caption"[\s\S]{0,5000}?<\/div>/)?.[0];
    if (div) {
      const text = decodeEntities(
        div.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      );
      if (text) return { platform: "instagram", caption: text, author: null, thumbnail: null };
    }
  }
  return null;
}

export async function fetchVideoText(videoUrl: string): Promise<VideoText> {
  const platform = detectPlatform(videoUrl);

  if (platform === "tiktok") {
    const data = await fetchJson(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`
    );
    if (data) {
      return {
        platform,
        caption: typeof data.title === "string" ? data.title : null,
        author: typeof data.author_name === "string" ? data.author_name : null,
        thumbnail: typeof data.thumbnail_url === "string" ? data.thumbnail_url : null,
      };
    }
  }

  if (platform === "youtube") {
    const data = await fetchJson(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`
    );
    if (data) {
      return {
        platform,
        caption: typeof data.title === "string" ? data.title : null,
        author: typeof data.author_name === "string" ? data.author_name : null,
        thumbnail: typeof data.thumbnail_url === "string" ? data.thumbnail_url : null,
      };
    }
  }

  if (platform === "instagram") {
    const result = await fetchInstagramText(videoUrl);
    if (result) return result;
  }

  // Generic fallback: any page's og: tags (try browser UA, then crawler UA)
  for (const ua of [CHROME_UA, BOT_UA]) {
    const html = await fetchHtml(videoUrl, ua);
    if (html) {
      const caption =
        metaContent(html, "og:description") ?? metaContent(html, "og:title") ?? null;
      if (caption) {
        return {
          platform,
          caption,
          author: metaContent(html, "og:site_name"),
          thumbnail: metaContent(html, "og:image"),
        };
      }
    }
  }

  return { platform, caption: null, author: null, thumbnail: null };
}
