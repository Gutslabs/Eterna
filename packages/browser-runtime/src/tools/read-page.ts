import { tool } from "@aipexstudio/aipex-core";
import { z } from "zod";
import {
  type ExtractedMarkdown,
  extractHtmlToMarkdown,
  type ReadUrlResult,
} from "./read-url";
import { getActiveTab } from "./tab-utils";

/**
 * read_page — the "pull detail" half of the page-context pipeline.
 *
 * The auto-attached page context is budgeted (a snippet of the page). When that
 * snippet is truncated or the model needs the whole article, read_page returns
 * the main content of the active tab as clean Markdown. It reads the live DOM
 * (via the content script's get-page-text handler) rather than re-fetching the
 * URL, so it captures SPA-rendered content the way the auto context does — just
 * without the size cap. Extraction is shared with read_url (defuddle/node).
 *
 * For long documents it switches to progressive disclosure: the first call
 * returns a heading OUTLINE plus the first chunk, and the model pulls more by
 * passing `section` (a heading) or `offset` — far better than dropping
 * everything past a hard truncation. The full extraction is cached per tab so
 * paging through sections doesn't re-extract each time (same idea as the
 * YouTube transcript windows).
 */

/** Per-chunk size. The model pages through longer pages by section/offset. */
const READ_PAGE_LIMIT = 40000;
const CACHE_TTL_MS = 60_000;
const MAX_CACHED_TABS = 8;

interface CachedPage {
  url: string;
  extracted: ExtractedMarkdown;
  at: number;
}
const pageCache = new Map<number, CachedPage>();

interface HeadingMatch {
  index: number;
  level: number;
  text: string;
}

function headingMatches(markdown: string): HeadingMatch[] {
  const out: HeadingMatch[] = [];
  const re = /^(#{1,6})[ \t]+(.+)$/gm;
  let match: RegExpExecArray | null = re.exec(markdown);
  while (match !== null) {
    out.push({
      index: match.index,
      level: match[1]?.length ?? 1,
      text: (match[2] ?? "").trim(),
    });
    match = re.exec(markdown);
  }
  return out;
}

/** A nested bullet outline of the document's headings (capped). */
export function buildOutline(markdown: string): string {
  const headings = headingMatches(markdown);
  if (headings.length === 0) return "";
  return headings
    .slice(0, 100)
    .map((h) => `${"  ".repeat(Math.max(0, h.level - 1))}- ${h.text}`)
    .join("\n");
}

export interface PageChunk {
  content: string;
  outline?: string;
  nextOffset?: number;
  section?: string;
}

/**
 * Slice `markdown` into a model-sized window. Short docs return whole. Long docs
 * return the first chunk (or the requested `section`/`offset`) plus an outline
 * and a `nextOffset` to continue — progressive disclosure instead of truncation.
 */
export function chunkPage(
  markdown: string,
  opts: { limit: number; section?: string; offset?: number },
): PageChunk {
  const { limit } = opts;
  if (markdown.length <= limit) return { content: markdown };

  const headings = headingMatches(markdown);
  let start = Math.max(0, Math.floor(opts.offset ?? 0));
  let end: number;
  let resolvedSection: string | undefined;

  if (opts.section?.trim()) {
    const norm = opts.section.trim().toLowerCase();
    const hit = headings.find((h) => h.text.toLowerCase().includes(norm));
    if (hit) {
      start = hit.index;
      resolvedSection = hit.text;
      const next = headings.find(
        (h) => h.index > hit.index && h.level <= hit.level,
      );
      end = Math.min(next ? next.index : markdown.length, start + limit);
    } else {
      // Section not found — fall back to the first chunk.
      start = 0;
      end = Math.min(limit, markdown.length);
    }
  } else {
    end = Math.min(start + limit, markdown.length);
  }

  return {
    content: markdown.slice(start, end),
    outline: buildOutline(markdown),
    nextOffset: end < markdown.length ? end : undefined,
    section: resolvedSection,
  };
}

function evictStaleCache(now: number): void {
  for (const [tabId, entry] of pageCache) {
    if (now - entry.at >= CACHE_TTL_MS) pageCache.delete(tabId);
  }
  while (pageCache.size >= MAX_CACHED_TABS) {
    const oldest = pageCache.keys().next().value;
    if (oldest === undefined) break;
    pageCache.delete(oldest);
  }
}

export const readPageTool = tool({
  name: "read_page",
  description:
    "Read the main content of the page open in the active tab, as clean Markdown. Use this when the attached page context was cut off ('…[truncated]') or you need more of the current page than the attached snippet — it reads the complete article from the live DOM (works on SPAs too). Long pages come back as a heading outline plus the first chunk; pass `section` (a heading from the outline) or `offset` (from a prior result's nextOffset) to read further. For a link the user is NOT currently on, use read_url instead.",
  parameters: z.object({
    section: z
      .string()
      .optional()
      .describe(
        "Jump to the section under this heading (match a line from the outline). For long pages only.",
      ),
    offset: z
      .number()
      .optional()
      .describe(
        "Character offset to continue from — pass a prior result's nextOffset to read the next chunk.",
      ),
  }),
  execute: async ({ section, offset }): Promise<ReadUrlResult> => {
    const tab = await getActiveTab();
    if (!tab?.id) {
      return { success: false, error: "No active tab to read." };
    }
    const tabId = tab.id;
    const now = Date.now();

    // Reuse a fresh extraction when paging the same page (section/offset calls).
    const cached = pageCache.get(tabId);
    let extracted: ExtractedMarkdown | undefined =
      cached && cached.url === (tab.url ?? "") && now - cached.at < CACHE_TTL_MS
        ? cached.extracted
        : undefined;
    let url = cached?.url ?? tab.url ?? "";

    if (!extracted) {
      let html = "";
      try {
        const response = (await chrome.tabs.sendMessage(
          tabId,
          { request: "get-page-text" },
          { frameId: 0 },
        )) as { html?: string; readable?: string; url?: string } | undefined;
        html = response?.html ?? "";
        url = response?.url || tab.url || "";
        if (!html) {
          // Restricted page (chrome://, the store, a PDF viewer) — the content
          // script can't serialize it. Fall back to its readable text, chunked.
          const readable = response?.readable?.trim();
          if (!readable) {
            return {
              success: false,
              error:
                "Could not read the current page (it may be a restricted page).",
            };
          }
          const chunk = chunkPage(readable, {
            limit: READ_PAGE_LIMIT,
            section,
            offset,
          });
          return {
            success: true,
            url,
            content: chunk.content,
            truncated: chunk.nextOffset !== undefined,
            outline: chunk.outline,
            nextOffset: chunk.nextOffset,
            section: chunk.section,
          };
        }
      } catch {
        return {
          success: false,
          error:
            "Could not reach the page. Open a normal web page and try again.",
        };
      }

      try {
        // Extract the WHOLE page (no cap) so we can cache and chunk it ourselves.
        const full = await extractHtmlToMarkdown(
          html,
          url,
          Number.MAX_SAFE_INTEGER,
        );
        if (!full) {
          return {
            success: false,
            error:
              "No readable content could be extracted from the current page.",
          };
        }
        extracted = full;
        evictStaleCache(now);
        pageCache.set(tabId, { url, extracted, at: now });
      } catch (error) {
        return {
          success: false,
          error: `Could not extract the page: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    }

    const chunk = chunkPage(extracted.content, {
      limit: READ_PAGE_LIMIT,
      section,
      offset,
    });
    return {
      success: true,
      url,
      title: extracted.title,
      site: extracted.site,
      author: extracted.author,
      published: extracted.published,
      wordCount: extracted.wordCount,
      content: chunk.content,
      truncated: chunk.nextOffset !== undefined,
      outline: chunk.outline,
      nextOffset: chunk.nextOffset,
      section: chunk.section,
    };
  },
});
