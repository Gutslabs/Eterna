import { tool } from "@aipexstudio/aipex-core";
import { z } from "zod";

/**
 * read_url — fetch any web page and return its main content as clean Markdown.
 *
 * Runs in the background service worker: it fetches the URL (the extension has
 * host permissions, so cross-origin works) and extracts the article with
 * `defuddle/node`, which parses the HTML string via linkedom — no DOM, so it
 * works in the SW. Defuddle is lazy-imported to keep it off the SW eager
 * bundle. This is the agent's "off-page reach": reading a link that is NOT the
 * page already open (that one rides along as attached context).
 */

/** Clean Markdown is dense, so an explicit read gets a slightly larger cap. */
const READ_URL_LIMIT = 16000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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

/** Fetch a public URL while re-validating every redirect target. */
export async function fetchPublicUrl(
  raw: string,
  signal: AbortSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS),
): Promise<PublicFetchResult> {
  let currentUrl = raw;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    if (!isPublicHttpUrl(currentUrl)) {
      throw new Error("Redirected to a non-public address.");
    }

    const response = await fetch(currentUrl, {
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal,
    });
    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => {});
    if (!location) return { response, finalUrl: currentUrl };
    if (redirects === MAX_REDIRECTS) {
      throw new Error(`Too many redirects (max ${MAX_REDIRECTS}).`);
    }
    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error(`Too many redirects (max ${MAX_REDIRECTS}).`);
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
 * Lazy-imported to keep the ~1MB bundle off the SW eager path. Returns null
 * when nothing readable was found.
 */
export async function extractHtmlToMarkdown(
  html: string,
  url: string,
  limit: number,
): Promise<ExtractedMarkdown | null> {
  const { Defuddle } = await import("defuddle/node");
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
 * SW). Lazy-imported so the ~1MB bundle stays off the eager path. Returns null
 * for empty/scanned PDFs where no text layer is present.
 */
async function extractPdf(
  bytes: Uint8Array,
  limit: number,
): Promise<ExtractedMarkdown | null> {
  const { extractText } = await import("unpdf");
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
