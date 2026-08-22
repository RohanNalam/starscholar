import { GoogleGenAI, type Part } from "@google/genai";
import { z } from "zod";
import {
  ExtractionSchema,
  VerificationSchema,
  type Extraction,
  type ExtractedOpportunity,
  type Verification,
} from "./types";

// "gemini-flash-latest" is Google's alias for the current flash model, so it
// never goes stale as models are deprecated. Override with GEMINI_MODEL in
// .env.local. On ANY failure (overload, rate limit, deprecation, malformed
// output) we walk down a chain of alternative models before giving up.
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-flash-lite-latest"];

function makeClient() {
  const apiKey = process.env.GEMINI_API_KEY ?? "";
  return new GoogleGenAI({ apiKey });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Local LLM (Ollama), free, unlimited, runs on the user's own GPU ────────
// Text-only jobs (caption extraction, page verification) try the local model
// first; any failure, unavailable, timeout, or output that doesn't validate
// against the schema, escalates to Gemini. Video-watching always uses Gemini.
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";

let ollamaReady: boolean | null = null;

async function ollamaAvailable(): Promise<boolean> {
  if (ollamaReady !== null) return ollamaReady;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { models?: { name: string }[] };
    ollamaReady = Boolean(
      data.models?.some((m) => m.name === OLLAMA_MODEL || m.name.startsWith(`${OLLAMA_MODEL}`))
    );
    if (!ollamaReady) {
      console.warn(`Ollama is running but model "${OLLAMA_MODEL}" isn't pulled, using Gemini`);
    }
  } catch {
    ollamaReady = false;
  }
  return ollamaReady;
}

async function generateLocal<T>(
  schema: z.ZodType<T>,
  system: string,
  text: string,
  maxTokens: number
): Promise<T> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: text },
      ],
      format: z.toJSONSchema(schema), // Ollama constrains output to the schema
      options: { temperature: 0, num_predict: maxTokens },
    }),
    signal: AbortSignal.timeout(150000), // local models are slower, give room
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string } };
  const raw = (data.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!raw) throw new Error("Local model returned no output");
  return schema.parse(JSON.parse(raw)); // validation failure → caller escalates to Gemini
}

// One structured call: JSON schema enforced by the API, validated again by Zod.
// `parts` may include inline media (image or video) alongside text, Gemini is
// multimodal, so reading a cover image or watching a video is the same call.
async function generateStructured<T>(
  schema: z.ZodType<T>,
  system: string,
  parts: Part[],
  maxOutputTokens: number
): Promise<T> {
  // Local-first for text-only jobs: free and unlimited on the user's GPU.
  // Any failure (including schema-validation failure) falls through to Gemini.
  const textOnly = parts.every((p) => typeof p.text === "string" && !("inlineData" in p));
  if (textOnly && (await ollamaAvailable())) {
    try {
      return await generateLocal(
        schema,
        system,
        parts.map((p) => p.text).join("\n\n"),
        maxOutputTokens
      );
    } catch (e) {
      console.warn(
        `Local LLM (${OLLAMA_MODEL}) failed, escalating to Gemini:`,
        e instanceof Error ? e.message.slice(0, 200) : e
      );
    }
  }

  const attempts: { model: string; delayMs: number }[] = [
    { model: MODEL, delayMs: 0 },
    { model: MODEL, delayMs: 2000 },
    ...FALLBACK_MODELS.filter((m) => m !== MODEL).map((m) => ({ model: m, delayMs: 500 })),
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    if (attempt.delayMs) await sleep(attempt.delayMs);
    try {
      const res = await makeClient().models.generateContent({
        model: attempt.model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(schema),
          maxOutputTokens,
          // Extraction and fact-checking are not creative work. Gemini defaults
          // to temperature 1, which made the same video yield different program
          // names (and so different searches) run to run.
          temperature: 0,
        },
      });
      if (!res.text) throw new Error("The model returned no output");
      return schema.parse(JSON.parse(res.text));
    } catch (e) {
      lastError = e;
      console.warn(
        `Gemini ${attempt.model} failed (${e instanceof Error ? e.message.slice(0, 200) : e}), trying next model…`
      );
    }
  }
  throw new Error(
    `The AI model couldn't process this right now, try again in a minute. (detail: ${
      lastError instanceof Error ? lastError.message.slice(0, 300) : String(lastError)
    })`
  );
}

// ── Step 1: extract the opportunity from whatever we have ───────────────────
// Escalation ladder: caption → caption + cover image → the full video file.
export type ExtractionMedia = { part: Part; kind: "image" | "video" };

export async function extractOpportunity(
  caption: string | null,
  author: string | null,
  media?: ExtractionMedia
): Promise<Extraction> {
  const mediaNote =
    media?.kind === "video"
      ? "You are given the actual video file. Watch it: use the spoken audio, every on-screen text overlay, and anything shown visually. Captions are often engagement bait ('comment for the link!') while the real details are spoken or shown on screen. "
      : media?.kind === "image"
        ? "You are given the video's cover image, read any text overlaid on it; creators usually put the hook there. "
        : "";

  const parts: Part[] = [];
  if (media) parts.push(media.part);
  parts.push({
    text:
      `Video caption${author ? ` (posted by ${author})` : ""}: ` +
      (caption ? `\n\n${caption}` : "(none, the creator left the caption empty)"),
  });

  return generateStructured(
    ExtractionSchema,
    "You extract structured facts about scholarships, internships, jobs, summer programs, and fellowships from short-form social videos. " +
      mediaNote +
      "Videos often list SEVERAL opportunities ('5 internships you need to apply to!'), return one entry per distinct opportunity, in the order presented. " +
      "Only report what the content actually says, a field it doesn't state is null. Never guess deadlines, amounts, or program names from your own knowledge. " +
      "IMPORTANT: if the video shows a website address on screen, says one aloud, or the caption contains one, capture it in mentioned_url, that's where viewers are being sent. " +
      "Each search_query should target that opportunity's official application page for the current cycle.",
    parts,
    4096
  );
}

// Fetch a thumbnail/cover image and wrap it as an inline Gemini part.
export async function fetchImagePart(url: string): Promise<Part | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "";
    if (!mimeType.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 6 * 1024 * 1024) return null;
    return { inlineData: { mimeType, data: buf.toString("base64") } };
  } catch {
    return null;
  }
}

// ── Step 2: search for the official page ────────────────────────────────────
// Auto-detects whichever key is present: Tavily → Brave → Serper.
export type SearchHit = { title: string; url: string; snippet: string };

export function hasSearchProvider(): boolean {
  return Boolean(
    process.env.TAVILY_API_KEY || process.env.BRAVE_API_KEY || process.env.SERPER_API_KEY
  );
}

// Search results are memoised alongside pages: near-identical queries across a
// multi-opportunity video (and repeated rechecks) cost one API credit, not five.
const searchCache = new Map<string, { at: number; value: Promise<SearchHit[]> }>();

export async function searchOfficial(query: string): Promise<SearchHit[]> {
  return memoize(searchCache, query.trim().toLowerCase(), () => {
    if (process.env.TAVILY_API_KEY) return searchTavily(query);
    if (process.env.BRAVE_API_KEY) return searchBrave(query);
    if (process.env.SERPER_API_KEY) return searchSerper(query);
    throw new Error("No search API key configured");
  });
}

async function searchTavily(query: string): Promise<SearchHit[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, max_results: 6 }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Tavily search failed (${res.status})`);
  const data = (await res.json()) as {
    results?: { title: string; url: string; content?: string }[];
  };
  return (data.results ?? []).slice(0, 5).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content ?? "",
  }));
}

async function searchBrave(query: string): Promise<SearchHit[]> {
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6`,
    {
      headers: {
        "X-Subscription-Token": process.env.BRAVE_API_KEY ?? "",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!res.ok) throw new Error(`Brave search failed (${res.status})`);
  const data = (await res.json()) as {
    web?: { results?: { title: string; url: string; description?: string }[] };
  };
  return (data.web?.results ?? []).slice(0, 5).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description ?? "",
  }));
}

async function searchSerper(query: string): Promise<SearchHit[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": process.env.SERPER_API_KEY ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: 6 }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Serper search failed (${res.status})`);
  const data = (await res.json()) as {
    organic?: { title: string; link: string; snippet?: string }[];
  };
  return (data.organic ?? []).slice(0, 5).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet ?? "",
  }));
}

// ── Step 3: fetch the top pages and strip them to text ──────────────────────
const PAGE_CHAR_LIMIT = 9000;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    // keep hrefs so the model can find the deep application link
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, " $2 [link: $1] ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPageRaw(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("text")) return null;
    return htmlToText(await res.text());
  } catch {
    return null;
  }
}

// Every opportunity in a video runs its own search, and their results overlap
// heavily (one aggregator page shows up for all five internships). Memoising by
// URL turns those duplicates into a single fetch, and because the promise is
// cached before it settles, five parallel verifications share one request
// rather than racing to make five.
const PAGE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_PAGES = 300;

function memoize<T>(cache: Map<string, { at: number; value: Promise<T> }>, key: string, make: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < PAGE_TTL_MS) return hit.value;
  if (cache.size >= MAX_CACHED_PAGES) {
    for (const [k, v] of cache) if (Date.now() - v.at >= PAGE_TTL_MS) cache.delete(k);
    if (cache.size >= MAX_CACHED_PAGES) cache.clear();
  }
  // A rejected promise must not be cached, or one transient failure would be
  // replayed to every later caller for the whole TTL.
  const value = make();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

const rawCache = new Map<string, { at: number; value: Promise<string | null> }>();
const renderCache = new Map<string, { at: number; value: Promise<string | null> }>();

// JS-rendered sites (many official program pages) give plain fetch an empty
// shell. Jina's reader executes the page and returns its real content.
// The direct fetch fails fast on a JS shell (it returns a near-empty page, it
// doesn't hang), so this budget is only spent on pages that genuinely need
// rendering, and cutting it too far costs verifications: Coursera and AWS
// pages take longer than 12s and were coming back unverified without it.
async function fetchRendered(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/plain" },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return null;
    return (await res.text()).replace(/\s+/g, " ").trim();
  } catch {
    return null;
  }
}

async function fullPageText(url: string): Promise<string | null> {
  const direct = await memoize(rawCache, url, () => fetchPageRaw(url));
  if (direct && direct.length >= 500) return direct;

  const rendered = await memoize(renderCache, url, () => fetchRendered(url));
  if (rendered && rendered.length > (direct?.length ?? 0)) return rendered;
  return direct;
}

export async function fetchPageText(url: string): Promise<string | null> {
  const full = await fullPageText(url);
  return full ? full.slice(0, PAGE_CHAR_LIMIT) : null;
}

// ── Crawl the official site's own links ──────────────────────────────────────
// Search results give us landing pages; the truth (current deadline, apply
// portal) often sits one click deeper. Follow promising same-site links.
export type SourcePage = { url: string; title: string; text: string };

// "intern" must not match "international", that alone pulled nasa.gov's
// /international-space-station/ nav link in as a source page.
const CRAWL_KEYWORDS =
  /apply|application|register|registration|admission|deadline|eligib|scholar|intern(?!ational)|fellow|program|20\d{2}/i;

// never crawl static assets, images/styles/scripts have no facts to read
const ASSET_RE = /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|pdf|zip|mp4|webm|woff2?|ttf|xml|json)(\?|$)/i;

function rootDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").split(".").slice(-2).join(".");
  } catch {
    return null;
  }
}

function extractLinks(pageUrl: string, text: string): string[] {
  const found = new Set<string>();
  const add = (href: string) => {
    try {
      const u = new URL(href, pageUrl);
      if (u.protocol === "http:" || u.protocol === "https:") found.add(u.href.split("#")[0]);
    } catch {
      // ignore malformed hrefs
    }
  };
  for (const m of text.matchAll(/\[link:\s*([^\]\s]+)\]/g)) add(m[1]);
  for (const m of text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) add(m[1]); // markdown (Jina)
  return [...found];
}

function sameSite(a: string, b: string): boolean {
  const root = (h: string) => h.replace(/^www\./, "").split(".").slice(-2).join(".");
  try {
    return root(new URL(a).hostname) === root(new URL(b).hostname);
  } catch {
    return false;
  }
}

// links that scream "this is where you sign up", worth following even to a
// DIFFERENT domain (e.g. nasa.gov's page linking to stardance.hackclub.com)
const STRONG_APPLY_RE = /apply|register|signup|sign-up|join|submit|enroll|portal|challenge/i;
const SOCIAL_RE =
  /instagram\.com|facebook\.com|x\.com|twitter\.com|youtube\.com|youtu\.be|tiktok\.com|linkedin\.com|reddit\.com|discord\./i;

// tokens from the program/org name, a link containing one is almost
// certainly the program's own site (e.g. "Stardance" → stardance.hackclub.com)
export function nameTokens(...names: (string | null | undefined)[]): string[] {
  const tokens = new Set<string>();
  for (const n of names) {
    for (const t of (n ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length >= 5 && !["challenge", "program", "scholarship", "internship"].includes(t)) {
        tokens.add(t);
      }
    }
  }
  return [...tokens];
}

export async function crawlFrom(
  pages: SourcePage[],
  max = 5,
  tokens: string[] = []
): Promise<SourcePage[]> {
  // Mine links from the FULL page, not the truncated copy the model reads:
  // on a big site the nav bar fits inside PAGE_CHAR_LIMIT while the link to the
  // program's own site (nasa.gov → stardance.hackclub.com) sits past the cut.
  // Every page here was already fetched, so this is served from the memo cache.
  const linksByPage = new Map<string, string[]>();
  await Promise.all(
    pages.map(async (p) => {
      const full = (await fullPageText(p.url)) ?? p.text;
      linksByPage.set(p.url, extractLinks(p.url, full));
    })
  );
  const linksOf = (p: SourcePage): string[] => linksByPage.get(p.url) ?? [];

  const seen = new Set(pages.map((p) => p.url));
  const candidates: string[] = [];
  const tryAdd = (link: string): boolean => {
    if (seen.has(link) || ASSET_RE.test(link)) return false;
    seen.add(link);
    candidates.push(link);
    return true;
  };

  // 1. HIGHEST priority, links (any domain) whose URL contains the program's
  //    own name. This is how nasa.gov's page leads us to stardance.hackclub.com.
  if (tokens.length > 0) {
    let added = 0;
    for (const p of pages) {
      for (const link of linksOf(p)) {
        if (added >= 2) break;
        try {
          const u = new URL(link);
          const hay = `${u.hostname}${u.pathname}`.toLowerCase();
          if (SOCIAL_RE.test(link) || !tokens.some((t) => hay.includes(t))) continue;
        } catch {
          continue;
        }
        if (tryAdd(link)) added++;
      }
      if (added >= 2) break;
    }
  }

  // 2. The site's HOMEPAGE, only when search surfaced an archive/subdomain
  //    page (archive.hackmit.org → hackmit.org). Skipped for pages already on
  //    the apex domain: nasa.gov's homepage would just waste a slot.
  for (const p of pages) {
    try {
      const host = new URL(p.url).hostname.replace(/^www\./, "");
      const root = rootDomain(p.url);
      if (!root || host === root) continue;
      tryAdd(`https://${root}/`);
    } catch {
      // skip malformed
    }
  }

  // 3. Same-site links that look like apply/deadline/FAQ pages (path only -
  //    query strings like ?search=Expedition%2064 are nav junk, not content).
  for (const p of pages) {
    for (const link of linksOf(p)) {
      if (candidates.length >= max) break;
      if (!sameSite(link, p.url)) continue;
      try {
        const u = new URL(link);
        if (u.search || !CRAWL_KEYWORDS.test(u.pathname)) continue;
      } catch {
        continue;
      }
      tryAdd(link);
    }
    if (candidates.length >= max) break;
  }

  // 4. CROSS-domain hop for links that scream "sign up here".
  let hops = 0;
  for (const p of pages) {
    if (hops >= 2) break;
    for (const link of linksOf(p)) {
      if (hops >= 2 || candidates.length >= max + 2) break;
      if (sameSite(link, p.url)) continue;
      if (SOCIAL_RE.test(link) || !STRONG_APPLY_RE.test(link)) continue;
      if (tryAdd(link)) hops++;
    }
  }
  const crawled = await Promise.all(
    candidates.map(async (u) => ({
      url: u,
      title: `[crawled] ${u}`,
      text: (await fetchPageText(u)) ?? "",
    }))
  );
  return crawled.filter((p) => p.text.length > 200);
}

// ── One claim, end to end: search → read → crawl → fact-check ───────────────
export async function verifyClaim(
  claimed: ExtractedOpportunity,
  caption: string | null,
  todayISO: string,
  extraPages: SourcePage[] = []
): Promise<{ verification: Verification | null; sources: { title: string; url: string }[] }> {
  // Year-aware search: stale past-cycle pages dominate results otherwise
  const query = /\b20\d{2}\b/.test(claimed.search_query)
    ? claimed.search_query
    : `${claimed.search_query} ${todayISO.slice(0, 4)}`;

  // The site the video itself sent viewers to is the strongest lead, read it
  // first, in parallel with the web search.
  const mentionedPromise: Promise<SourcePage | null> = claimed.mentioned_url
    ? (async () => {
        try {
          const u = new URL(
            claimed.mentioned_url!.startsWith("http")
              ? claimed.mentioned_url!
              : `https://${claimed.mentioned_url}`
          );
          const text = (await fetchPageText(u.href)) ?? "";
          return text.length > 200
            ? { url: u.href, title: `[shown in the video] ${u.href}`, text }
            : null;
        } catch {
          return null;
        }
      })()
    : Promise.resolve(null);

  const [mentioned, hits] = await Promise.all([mentionedPromise, searchOfficial(query)]);
  const fetched = await Promise.all(
    hits.slice(0, 4).map(async (h) => ({
      url: h.url,
      title: h.title,
      text: (await fetchPageText(h.url)) ?? "",
    }))
  );
  let pages: SourcePage[] = fetched.filter((p) => p.text.length > 200).slice(0, 3);
  if (mentioned) pages = [mentioned, ...pages];
  const crawled = await crawlFrom(
    pages,
    4,
    nameTokens(claimed.program_name, claimed.organization)
  );
  pages = [...pages, ...crawled, ...extraPages].slice(0, 8);
  if (pages.length === 0) return { verification: null, sources: [] };

  const verification = await verifyOpportunity(claimed, caption, pages, todayISO);
  return { verification, sources: pages.map((p) => ({ title: p.title, url: p.url })) };
}

// ── Step 4: verify claims against the official pages ────────────────────────
export async function verifyOpportunity(
  claimed: ExtractedOpportunity,
  caption: string | null,
  pages: { url: string; title: string; text: string }[],
  todayISO: string
): Promise<Verification> {
  const pagesBlock = pages
    .map((p, i) => `<page index="${i + 1}" url="${p.url}" title="${p.title}">\n${p.text}\n</page>`)
    .join("\n\n");

  return generateStructured(
    VerificationSchema,
    "You are a verification engine for student opportunities (scholarships, internships, jobs, summer programs). " +
      "You are given (a) claims made in a social media video and (b) the text of web pages found by searching for the official source. " +
      `Today's date is ${todayISO}. ` +
      "Rules: every fact in your output must come from the page text, not the video and not your own knowledge. " +
      "A field the pages don't state is null or omitted, never guess. " +
      "URLs must be copied verbatim from the provided page URLs or the [link: ...] markers in the page text. " +
      "Pages titled '[linked by the creator]' are the video creator's own link, usually an aggregator blog, NOT the official source. " +
      "Mine their [link: ...] markers to find the official/deep application links they point to, but never cite the aggregator itself as official_info_url or direct_application_url unless its domain belongs to the offering organization. " +
      "Pages titled '[crawled]' were fetched by following links on those sites, they often hold the current apply page. " +
      "Pages titled '[shown in the video]' are the site the video itself directed viewers to, if the other pages corroborate it as the program's own site, treat it as official and prefer it. " +
      "direct_application_url is where a student actually signs up or applies: prefer a form/portal URL; when the program has a dedicated site (its own domain or subdomain) and no deeper form URL exists in the pages, cite that site as direct_application_url. " +
      "CURRENT CYCLE ONLY: report details for the application cycle that is current relative to today's date. " +
      "If the pages only describe a PAST cycle (dates or years clearly before today), do NOT present that cycle's deadline, dates, or requirements as current, set status 'unverified', say in status_reason that only past-cycle information was found, and leave deadline and deadline_iso null. " +
      "Use 'expired' ONLY when the pages show the current cycle's own deadline has passed or the program is discontinued. " +
      "If none of the pages are clearly the official source, use status 'unverified'.",
    [
      {
        text:
          `VIDEO CLAIMS about this specific opportunity (do not treat as facts):\n` +
          `- caption: ${caption ?? "(none)"}\n` +
          `- organization: ${claimed.organization ?? "unknown"}\n` +
          `- program: ${claimed.program_name ?? "unknown"}\n` +
          `- claimed deadline: ${claimed.claimed_deadline ?? "none stated"}\n` +
          `- claimed award/pay: ${claimed.claimed_award ?? "none stated"}\n` +
          `- claimed eligibility: ${claimed.claimed_eligibility ?? "none stated"}\n\n` +
          `SEARCH RESULT PAGES:\n\n${pagesBlock}`,
      },
    ],
    4096
  );
}
