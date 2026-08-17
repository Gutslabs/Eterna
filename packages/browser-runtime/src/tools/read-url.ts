import { tool } from "@eterna/core";
import { Defuddle } from "defuddle/node";
import { DOMParser, parseHTML } from "linkedom";
import { extractText } from "unpdf";
import { z } from "zod";

/**
 * read_url — fetch any web page and return its main content as clean Markdown.
 *
 * Runs in the background service worker: it fetches the URL (the extension has
 * host permissions, so cross-origin works) and extracts the article with
 * `defuddle/node`, which parses the HTML string via linkedom — no DOM, so it
 * works in the SW. All extraction deps are STATIC imports: MV3 forbids dynamic
 * import() in service workers, so lazy chunks fail at runtime ("import() is
 * disallowed"). This is the agent's "off-page reach": reading a link that is
 * NOT the page already open (that one rides along as attached context).
 */

/** Clean Markdown is dense, so an explicit read gets a slightly larger cap. */
const READ_URL_LIMIT = 16000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

export interface ReadUrlResult {
  success: boolean;
  error?: string;
  url?: string;
  title?: string;
  site?: string;
  author?: string;
  published?: string;
  wordCount?: number;
  truncated?: boolean;
  content?: string;
  /** For long pages read via read_page: a heading index of the whole document. */
  outline?: string;
  /** Char offset to pass back to read_page to continue past this chunk. */
  nextOffset?: number;
  /** The heading this chunk starts at, when a section was requested. */
  section?: string;
}

/**
 * Only allow public http(s) targets. Blocks loopback, private, link-local and
 * cloud-metadata hosts so an autonomous read can't be steered into the local
 * network (SSRF).
 */
export function isPublicHttpUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "local" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "::1" ||
    host === "::" ||
    host.startsWith("::ffff:") ||
    host === "0.0.0.0"
  ) {
    return false;
  }
  if (
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return false;
  }
  if (/^(fc|fd|fe[89ab])/.test(host)) {
    return false;
  }
  if (
    host === "metadata.google.internal" ||
    host === "metadata.azure.internal"
  ) {
    return false;
  }
  return true;
}

export interface PublicFetchResult {
  response: Response;
  finalUrl: string;
}

/**
 * Fetch a public URL, following redirects, and refuse to hand back a body
 * that ended up on a non-public address.
 *
 * Redirects must be followed by the browser: per the fetch spec,
 * `redirect: "manual"` yields an opaque-redirect response — status 0, no
 * Location header — so hop-by-hop re-validation is impossible in a service
 * worker (it only ever worked in node tests, where undici returns the real
 * 3xx). Every redirecting site used to surface as "HTTP 0" in the extension.
 * The final destination is validated via response.url instead; a chain that
 * lands on a private address is rejected without exposing the body.
 */
export async function fetchPublicUrl(
  raw: string,
  signal: AbortSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS),
): Promise<PublicFetchResult> {
  if (!isPublicHttpUrl(raw)) {
    throw new Error("Redirected to a non-public address.");
  }

  const response = await fetch(raw, {
    redirect: "follow",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal,
  });

  const finalUrl = response.url || raw;
  if (!isPublicHttpUrl(finalUrl)) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Redirected to a non-public address.");
  }

  return { response, finalUrl };
}

/** Read a response without allowing an untrusted server to exhaust SW memory. */
export async function readResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Response is too large (max ${maxBytes} bytes).`);
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error(`Response is too large (max ${maxBytes} bytes).`);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`Response is too large (max ${maxBytes} bytes).`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const X_STATUS_RE =
  /^https?:\/\/(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)\/status(?:es)?\/(\d+)/;

interface FxTweet {
  text?: string;
  created_at?: string;
  likes?: number;
  retweets?: number;
  replies?: number;
  author?: { name?: string; screen_name?: string };
  media?: { all?: Array<{ url?: string; type?: string }> };
  quote?: FxTweet;
}

function formatFxTweet(tweet: FxTweet, depth = 0): string {
  const name = tweet.author?.name ?? "Unknown";
  const handle = tweet.author?.screen_name
    ? ` (@${tweet.author.screen_name})`
    : "";
  const lines = [
    `**${name}**${handle}${tweet.created_at ? ` — ${tweet.created_at}` : ""}`,
  ];
  if (tweet.text) lines.push("", tweet.text);
  const stats = [
    typeof tweet.replies === "number" ? `${tweet.replies} replies` : null,
    typeof tweet.retweets === "number" ? `${tweet.retweets} retweets` : null,
    typeof tweet.likes === "number" ? `${tweet.likes} likes` : null,
  ].filter(Boolean);
  if (stats.length && depth === 0) lines.push("", stats.join(" · "));
  const media = (tweet.media?.all ?? [])
    .map((item) => item.url)
    .filter((item): item is string => typeof item === "string");
  if (media.length) lines.push("", `Media: ${media.join(" ")}`);
  if (tweet.quote && depth === 0) {
    const quoted = formatFxTweet(tweet.quote, 1)
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
    lines.push("", "Quoting:", quoted);
  }
  return lines.join("\n");
}

/**
 * X serves logged-out fetches a script shell with no tweet content, so status
 * links read through FxTwitter's public JSON mirror instead. Anything
 * unexpected (non-status URL, API failure) falls back to the generic fetch.
 */
export async function readXStatus(url: string): Promise<ReadUrlResult | null> {
  const match = url.match(X_STATUS_RE);
  if (!match) return null;
  try {
    const response = await fetch(
      `https://api.fxtwitter.com/${match[1]}/status/${match[2]}`,
      { credentials: "omit", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { code?: number; tweet?: FxTweet };
    const tweet = data.tweet;
    if (!tweet?.text && !tweet?.author) return null;

    const name = tweet.author?.name ?? "Unknown";
    const handle = tweet.author?.screen_name;
    return {
      success: true,
      url,
      title: `${name}${handle ? ` (@${handle})` : ""} on X`,
      site: "X (Twitter)",
      author: name,
      published: tweet.created_at,
      content: formatFxTweet(tweet),
    };
  } catch {
    return null;
  }
}

export interface ExtractedMarkdown {
  title?: string;
  site?: string;
  author?: string;
  published?: string;
  wordCount?: number;
  truncated?: boolean;
  content: string;
}

/**
 * Extraction shared by read_url (fetched HTML) and read_page (the active tab's
 * live HTML). `defuddle/node` parses the HTML string with linkedom — no DOM —
 * and runs the async site extractors (FxTwitter for X, Reddit/HN threads).
 * Returns null when nothing readable was found.
 */
/**
 * Defuddle's dependency tree carries a DOMParser shim that probes `window` /
 * `document` bare — in the MV3 service worker neither exists, so certain
 * pages crash extraction with "window is not defined". Aliasing window to
 * globalThis and lending it linkedom's DOMParser satisfies the shim's happy
 * path (a working parseFromString) before it ever reaches its ActiveXObject /
 * document.implementation fallbacks. linkedom is already in the bundle as
 * defuddle's own parser, so this adds no weight.
 */
async function ensureDomGlobalsForExtraction(): Promise<void> {
  const scope = globalThis as {
    window?: unknown;
    document?: unknown;
    DOMParser?: unknown;
  };
  // Alias window BEFORE loading anything, so even a module-scope probe in a
  // lazily imported chunk resolves.
  scope.window ??= globalThis;
  if (
    typeof scope.DOMParser !== "undefined" &&
    typeof scope.document !== "undefined"
  ) {
    return;
  }
  scope.DOMParser ??= DOMParser;
  // KaTeX (bundled inside defuddle for math markup) builds nodes straight off
  // the document global; lend it a detached linkedom document.
  scope.document ??= createExtractionDocument();
}

/**
 * The linkedom document handed to defuddle's dependency tree, taught the one
 * legacy API turndown needs.
 *
 * Turndown (bundled inside defuddle's markdown converter) picks its HTML
 * parser ONCE, when its module body evaluates. MV3 forbids dynamic import in
 * the service worker, so that happens at worker startup — long before this
 * function can alias `window` — and with no `window.DOMParser` in sight it
 * locks itself to the legacy path: `document.implementation.createHTMLDocument`
 * followed by open/write/close. linkedom implements none of those, which
 * surfaced as "Cannot read properties of undefined (reading
 * 'createHTMLDocument')" and cost read_url its markdown on every page.
 *
 * Since the choice cannot be un-made after the fact, satisfy it instead: the
 * shim below is the whole legacy contract, backed by linkedom's real parser.
 */
function createExtractionDocument(): unknown {
  const document = parseHTML("<html><body></body></html>").document;
  Object.defineProperty(document, "implementation", {
    configurable: true,
    value: {
      createHTMLDocument(): unknown {
        const scratch = parseHTML(
          "<!doctype html><html><head></head><body></body></html>",
        ).document;
        let buffer = "";
        return Object.assign(scratch, {
          open(): void {
            buffer = "";
          },
          write(chunk: string): void {
            buffer += chunk;
          },
          close(): void {
            scratch.body.innerHTML = buffer;
          },
        });
      },
    },
  });
  return document;
}

export async function extractHtmlToMarkdown(
  html: string,
  url: string,
  limit: number,
): Promise<ExtractedMarkdown | null> {
  await ensureDomGlobalsForExtraction();
  const result = await Defuddle(html, url, {
    markdown: true,
    includeReplies: "extractors",
  });
  const content = (result.contentMarkdown ?? result.content ?? "").trim();
  if (!content) {
    return null;
  }
  const truncated = content.length > limit;
  return {
    title: result.title || undefined,
    site: result.site || result.domain || undefined,
    author: result.author || undefined,
    published: result.published || undefined,
    wordCount: result.wordCount || undefined,
    truncated: truncated || undefined,
    content: truncated ? `${content.slice(0, limit)}\n\n…[truncated]` : content,
  };
}

/**
 * Extract text from a PDF via unpdf (a serverless pdf.js — no DOM, runs in the
 * SW). Statically imported: MV3 forbids dynamic import() in service workers.
 * Returns null for empty/scanned PDFs where no text layer is present.
 */
async function extractPdf(
  bytes: Uint8Array,
  limit: number,
): Promise<ExtractedMarkdown | null> {
  const { text } = await extractText(bytes, {
    mergePages: true,
  });
  const content = text.replace(/\n{3,}/g, "\n\n").trim();
  if (!content) {
    return null;
  }
  const truncated = content.length > limit;
  return {
    wordCount: content.split(/\s+/).filter(Boolean).length || undefined,
    truncated: truncated || undefined,
    content: truncated ? `${content.slice(0, limit)}\n\n…[truncated]` : content,
  };
}

export const readUrlTool = tool({
  name: "read_url",
  description:
    "Fetch a web page by its URL and return the main content as clean Markdown (with title, author, site and word count when available). Use this to read or summarize a link the user gives you, or one you found, when it is NOT the page already open in the browser — for the current page use the attached page context instead. Handles articles, blog posts, docs, PDFs, GitHub, Reddit and X/Twitter threads; not for pages that require a login.",
  parameters: z.object({
    url: z.string().describe("Absolute http(s) URL of the page to read."),
  }),
  execute: async ({ url }): Promise<ReadUrlResult> => {
    if (!isPublicHttpUrl(url)) {
      return {
        success: false,
        error:
          "Provide a public http(s) URL. Loopback, private and metadata addresses are blocked.",
      };
    }

    const xStatus = await readXStatus(url);
    if (xStatus) return xStatus;

    let response: Response;
    let finalUrl = url;
    try {
      const fetched = await fetchPublicUrl(url);
      response = fetched.response;
      finalUrl = fetched.finalUrl;
    } catch (error) {
      return {
        success: false,
        error: `Could not fetch the page: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    if (!response.ok) {
      return {
        success: false,
        error: `Could not fetch the page (HTTP ${response.status}).`,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";

    // PDFs need binary extraction (unpdf), not the HTML/Defuddle path.
    if (
      /application\/pdf/i.test(contentType) ||
      /\.pdf(\?|#|$)/i.test(finalUrl)
    ) {
      try {
        const extracted = await extractPdf(
          await readResponseBytes(response, MAX_PDF_BYTES),
          READ_URL_LIMIT,
        );
        if (!extracted) {
          return {
            success: false,
            error:
              "No text could be extracted from that PDF (it may be scanned or image-only).",
          };
        }
        return { success: true, url: finalUrl, ...extracted };
      } catch (error) {
        return {
          success: false,
          error: `Could not read the PDF: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    }

    if (contentType && !/(html|xml|text|json)/i.test(contentType)) {
      return {
        success: false,
        error: `That URL is not a readable page (content-type: ${contentType}).`,
      };
    }

    let html = "";
    try {
      html = new TextDecoder().decode(
        await readResponseBytes(response, MAX_HTML_BYTES),
      );
    } catch (error) {
      return {
        success: false,
        error: `Could not read the page: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    try {
      const extracted = await extractHtmlToMarkdown(
        html,
        finalUrl,
        READ_URL_LIMIT,
      );
      if (!extracted) {
        return {
          success: false,
          error: "No readable content could be extracted from that page.",
        };
      }
      return { success: true, url: finalUrl, ...extracted };
    } catch (error) {
      return {
        success: false,
        error: `Could not extract the page content: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  },
});
