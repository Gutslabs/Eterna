/**
 * Background web tools — search and read pages without opening a tab or
 * clicking anything. Both run as plain cross-origin fetches from the
 * extension (host_permissions: <all_urls>), so research subagents can work
 * silently in the background while the user keeps using the active tab.
 */

import { tool } from "@aipexstudio/aipex-core";
import { z } from "zod";

const DUCKDUCKGO_HTML = "https://html.duckduckgo.com/html/";
const DEFAULT_RESULT_LIMIT = 8;
const MAX_RESULT_LIMIT = 20;
const DEFAULT_FETCH_MAX_CHARS = 8000;
const MAX_FETCH_MAX_CHARS = 40000;
const FETCH_TIMEOUT_MS = 20000;

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).trim();
}

/**
 * DuckDuckGo's HTML endpoint wraps result links in a redirect of the form
 * `/l/?uddg=<encoded-target>&...`. Recover the real destination URL.
 */
function resolveDdgHref(href: string): string {
  const match = href.match(/[?&]uddg=([^&]+)/);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return href;
    }
  }
  if (href.startsWith("//")) {
    return `https:${href}`;
  }
  return href;
}

export function parseDuckDuckGoHtml(
  html: string,
  limit: number,
): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const linkRe =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe =
    /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

  const snippets: string[] = [];
  let snippetMatch: RegExpExecArray | null = snippetRe.exec(html);
  while (snippetMatch !== null) {
    snippets.push(stripTags(snippetMatch[1] ?? ""));
    snippetMatch = snippetRe.exec(html);
  }

  let linkMatch: RegExpExecArray | null = linkRe.exec(html);
  let index = 0;
  while (linkMatch !== null && results.length < limit) {
    const url = resolveDdgHref(decodeEntities(linkMatch[1] ?? ""));
    const title = stripTags(linkMatch[2] ?? "");
    if (url && title) {
      results.push({ title, url, snippet: snippets[index] ?? "" });
    }
    index += 1;
    linkMatch = linkRe.exec(html);
  }
  return results;
}

/** Core of web_search — exported for direct unit testing. */
export async function runWebSearch(query: string, limit?: number) {
  const resultLimit = Math.min(limit ?? DEFAULT_RESULT_LIMIT, MAX_RESULT_LIMIT);
  try {
    const body = new URLSearchParams({ q: query, kl: "us-en" });
    const response = await fetch(DUCKDUCKGO_HTML, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!response.ok) {
      return {
        success: false as const,
        error: `Search failed with HTTP ${response.status}`,
      };
    }
    const html = await response.text();
    const results = parseDuckDuckGoHtml(html, resultLimit);
    return { success: true as const, query, results, count: results.length };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const webSearchTool = tool({
  name: "web_search",
  description:
    "Search the web in the background and return the top results (title, url, snippet). Does not open a tab or change what the user sees. Use this to find pages, then read them with web_fetch.",
  parameters: z.object({
    query: z.string().describe("The search query"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_RESULT_LIMIT)
      .optional()
      .describe(`Max results to return (default ${DEFAULT_RESULT_LIMIT})`),
  }),
  execute: async ({ query, limit }) => runWebSearch(query, limit ?? undefined),
});

/** Core of web_fetch — exported for direct unit testing. */
export async function runWebFetch(url: string, maxChars?: number) {
  const cap = Math.min(
    maxChars ?? DEFAULT_FETCH_MAX_CHARS,
    MAX_FETCH_MAX_CHARS,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return {
        success: false as const,
        error: `Fetch failed with HTTP ${response.status}`,
        url,
      };
    }
    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();

    // JSON/text APIs are returned verbatim; HTML is reduced to readable text.
    let text: string;
    let title: string | undefined;
    if (
      contentType.includes("application/json") ||
      contentType.includes("text/plain")
    ) {
      text = raw;
    } else {
      const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      title = titleMatch ? stripTags(titleMatch[1] ?? "") : undefined;
      text = htmlToText(raw);
    }

    const truncated = text.length > cap;
    return {
      success: true as const,
      url,
      title,
      text: truncated ? text.slice(0, cap) : text,
      truncated,
    };
  } catch (error) {
    const aborted =
      error instanceof DOMException && error.name === "AbortError";
    return {
      success: false as const,
      url,
      error: aborted
        ? `Fetch timed out after ${FETCH_TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const webFetchTool = tool({
  name: "web_fetch",
  description:
    "Fetch a URL in the background and return its readable text content (HTML is stripped to plain text). Does not open a tab. Use after web_search to read a specific page, or to hit a JSON/REST API directly.",
  parameters: z.object({
    url: z.string().url().describe("The absolute URL to fetch"),
    maxChars: z
      .number()
      .int()
      .min(200)
      .max(MAX_FETCH_MAX_CHARS)
      .optional()
      .describe(
        `Truncate the text to this many characters (default ${DEFAULT_FETCH_MAX_CHARS})`,
      ),
  }),
  execute: async ({ url, maxChars }) => runWebFetch(url, maxChars ?? undefined),
});

/** Reduce an HTML document to readable text: drop script/style, strip tags. */
export function htmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  return decodeEntities(withoutScripts.replace(/<[^>]+>/g, " "))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** Background web research tools, registered for research subagents only. */
export const webResearchTools = [webSearchTool, webFetchTool] as const;
