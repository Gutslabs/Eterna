/**
 * Defuddle-based page extraction, run in the extension/sidepanel context.
 *
 * Content scripts can't load module chunks on CSP-strict sites (x.com blocks
 * them — the dynamic import resolves to the page origin and returns a
 * "text/html" MIME), so the content script ships us the page's raw HTML and
 * Defuddle runs here, where module loading is unrestricted. Lazy-imported by
 * browser-context-loader so the ~320KB Defuddle bundle stays off the eager
 * sidepanel path.
 */

import Defuddle from "defuddle";

export interface PageMeta {
  title?: string;
  site?: string;
  author?: string;
  published?: string;
  description?: string;
  wordCount?: number;
  extractor?: string;
  /**
   * High-signal machine-readable fields from the page head (JSON-LD + OpenGraph)
   * that Defuddle merges away or drops — author, published, price, rating, type.
   * Whitelisted and short, so the model reads authoritative values instead of
   * guessing them from prose.
   */
  structured?: Record<string, string>;
}

export interface ExtractedPage {
  text: string;
  meta?: PageMeta;
  mode: "defuddle" | "readable";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

let silenceDepth = 0;
let originalConsoleError: typeof console.error | null = null;

/**
 * Run `fn` with Defuddle's ONE benign internal error log silenced.
 *
 * Defuddle's `parse()` catches ANY error, logs
 * `console.error("Defuddle", "Error processing document:", err)`, then recovers
 * with a fallback body (its own try/catch). We fall back to the readable text
 * below too, so it's harmless — but Chrome's extension "Errors" page collects
 * every `console.error` and surfaces these as alarming "[object DOMException]"
 * entries. Drop just that one message (everything else passes through);
 * ref-counted so overlapping extractions restore the original exactly once.
 */
async function parseSilencingDefuddleErrors<T>(
  fn: () => T | Promise<T>,
): Promise<T> {
  if (silenceDepth++ === 0) {
    const original = console.error;
    originalConsoleError = original;
    console.error = (...args: unknown[]) => {
      if (args[0] === "Defuddle" && args[1] === "Error processing document:") {
        console.debug("[page-extract] Defuddle recovered from a parse error");
        return;
      }
      original.apply(console, args);
    };
  }
  try {
    return await fn();
  } finally {
    if (--silenceDepth === 0 && originalConsoleError) {
      console.error = originalConsoleError;
      originalConsoleError = null;
    }
  }
}

/**
 * Decode the handful of HTML entities that leak into extracted text. Run twice
 * so DOUBLE-encoded values (e.g. X's FxTwitter extractor emits `&amp;amp;` for a
 * literal `&`) collapse all the way back to the real character.
 */
function decodeEntities(input: string): string {
  const once = (s: string) =>
    s
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&apos;/gi, "'")
      .replace(/&nbsp;/gi, " ");
  return once(once(input));
}

/**
 * Minimal, dependency-free HTML→Markdown for Defuddle's already-clean `content`
 * (nav/ads/scripts are gone by the time we see it). The base `defuddle` build
 * doesn't ship the Markdown converter (only `defuddle/full`, +426KB), and we'd
 * otherwise feed the model raw `<article><div><p>` HTML. Covers the tags that
 * actually appear in article/post content; anything else falls through to its
 * text.
 */
function nodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === "script" || tag === "style" || tag === "noscript") return "";
  const inner = Array.from(el.childNodes).map(nodeToMarkdown).join("");
  switch (tag) {
    case "h1":
      return `\n\n# ${inner}\n\n`;
    case "h2":
      return `\n\n## ${inner}\n\n`;
    case "h3":
      return `\n\n### ${inner}\n\n`;
    case "h4":
    case "h5":
    case "h6":
      return `\n\n#### ${inner}\n\n`;
    case "br":
      return "\n";
    case "hr":
      return "\n\n---\n\n";
    case "li":
      return `\n- ${inner.trim()}`;
    case "ul":
    case "ol":
      return `\n${inner}\n`;
    case "blockquote":
      return `\n\n> ${inner.trim()}\n\n`;
    case "pre":
      return `\n\n\`\`\`\n${inner.trim()}\n\`\`\`\n\n`;
    case "code":
      return `\`${inner}\``;
    case "strong":
    case "b":
      return `**${inner}**`;
    case "em":
    case "i":
      return `*${inner}*`;
    case "a": {
      const href = el.getAttribute("href") ?? "";
      const text = inner.trim();
      return /^https?:/i.test(href) && text ? `[${text}](${href})` : inner;
    }
    case "img": {
      const alt = el.getAttribute("alt")?.trim();
      return alt ? ` ${alt} ` : "";
    }
    case "table":
      return tableToMarkdown(el);
    case "tr":
      return `\n${inner}`;
    case "td":
    case "th":
      return `${inner.trim()} | `;
    case "p":
    case "div":
    case "section":
    case "article":
    case "header":
    case "footer":
    case "main":
      return `\n\n${inner}\n\n`;
    default:
      return inner;
  }
}

/** Convert a table cell's children to compact inline text safe for a GFM cell. */
function cellToText(cell: Element): string {
  return Array.from(cell.childNodes)
    .map(nodeToMarkdown)
    .join("")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/**
 * Render an HTML <table> as a GitHub-flavored Markdown table: the first row is
 * the header, then a `| --- |` separator, then the body rows — every row padded
 * to the widest column count so the grid stays aligned. Without this, the base
 * nodeToMarkdown flattens tables into broken pipe-runs (no header separator) that
 * the model misreads, and pricing/spec/comparison tables are exactly what users
 * ask Eterna to extract.
 */
function tableToMarkdown(table: Element): string {
  const cellsOf = (row: Element) =>
    Array.from(row.children).filter((c) => {
      const t = c.tagName.toLowerCase();
      return t === "td" || t === "th";
    });
  const rows = Array.from(table.querySelectorAll("tr"))
    .map((row) => cellsOf(row).map(cellToText))
    .filter((cells) => cells.length > 0);
  if (rows.length === 0) return "";
  const cols = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const renderRow = (cells: string[]) => {
    const padded = cells.slice(0, cols);
    while (padded.length < cols) padded.push("");
    return `| ${padded.join(" | ")} |`;
  };
  const header = rows[0];
  if (!header) return "";
  const lines = [
    renderRow(header),
    `| ${Array(cols).fill("---").join(" | ")} |`,
  ];
  for (const r of rows.slice(1)) lines.push(renderRow(r));
  const caption = table.querySelector("caption");
  const captionText = caption ? cellToText(caption) : "";
  return `\n\n${captionText ? `**${captionText}**\n\n` : ""}${lines.join("\n")}\n\n`;
}

export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return decodeEntities(nodeToMarkdown(doc.body))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Run Defuddle over the page HTML; fall back to the readable innerText the
 * content script captured when extraction is too thin (web apps, feeds) or
 * throws. The HTML is parsed into a detached document, so Defuddle stripping
 * its script/style tags never touches the user's live page.
 *
 * Uses `parseAsync()` so the site-specific async extractors run (FxTwitter for
 * X, Reddit/HN comment threads) for the best result — normal pages just get the
 * sync parse. YouTube is the one exclusion: Eterna already has its own
 * transcript feed, so we sync-parse there (title/description only) instead of
 * letting Defuddle re-fetch the captions.
 */
/** Pull one high-signal field from a JSON-LD node (and its @graph children). */
function collectFromLdNode(
  node: unknown,
  set: (key: string, value: unknown) => void,
): void {
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (Array.isArray(o["@graph"])) {
    for (const child of o["@graph"]) collectFromLdNode(child, set);
  }
  const type = o["@type"];
  if (type) set("type", Array.isArray(type) ? type[0] : type);
  const author = o.author as Record<string, unknown> | string | undefined;
  if (author) set("author", typeof author === "string" ? author : author.name);
  if (o.datePublished) set("published", o.datePublished);
  const rating = o.aggregateRating as Record<string, unknown> | undefined;
  if (rating?.ratingValue != null) {
    set(
      "rating",
      rating.ratingCount
        ? `${rating.ratingValue} (${rating.ratingCount} ratings)`
        : `${rating.ratingValue}`,
    );
  }
  const offers = o.offers as Record<string, unknown> | undefined;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  if (offer && offer.price != null) {
    set(
      "price",
      offer.priceCurrency
        ? `${offer.price} ${offer.priceCurrency}`
        : `${offer.price}`,
    );
  }
}

/**
 * Extract whitelisted structured data (JSON-LD + OpenGraph) from the page head
 * BEFORE Defuddle runs (it strips the ld+json scripts). Author/published/price/
 * rating/type are exactly the fields Defuddle merges into the title or discards,
 * leaving the model to guess them from prose.
 */
function parseHeadStructuredData(doc: Document): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (key: string, value: unknown): void => {
    if (out[key]) return;
    if (typeof value === "string" && value.trim()) {
      out[key] = value.trim().slice(0, 120);
    } else if (typeof value === "number") {
      out[key] = String(value);
    }
  };
  for (const meta of Array.from(doc.querySelectorAll("meta"))) {
    const key = (
      meta.getAttribute("property") ||
      meta.getAttribute("name") ||
      ""
    ).toLowerCase();
    const content = meta.getAttribute("content") || "";
    if (!content) continue;
    if (key === "og:type") set("type", content);
    else if (key === "og:site_name") set("site", content);
    else if (key === "article:published_time") set("published", content);
    else if (key === "article:author" || key === "author")
      set("author", content);
  }
  for (const script of Array.from(
    doc.querySelectorAll('script[type="application/ld+json"]'),
  )) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent || "");
    } catch {
      continue;
    }
    for (const node of Array.isArray(data) ? data : [data]) {
      collectFromLdNode(node, set);
    }
  }
  return out;
}

export async function extractFromHtml(
  html: string,
  url: string,
  readableFallback: string,
): Promise<ExtractedPage> {
  let structured: Record<string, string> | undefined;
  try {
    if (html) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      // Before Defuddle, which strips the ld+json scripts it reads from.
      const head = parseHeadStructuredData(doc);
      structured = Object.keys(head).length > 0 ? head : undefined;
      const defuddle = new Defuddle(doc, {
        url,
        markdown: true,
        // Keep replies from the built-in site extractors (Reddit/GitHub/HN/X).
        includeReplies: "extractors",
      });
      const host = hostOf(url);
      const isYouTube = host === "youtube.com" || host === "youtu.be";
      const result = await parseSilencingDefuddleErrors(() =>
        isYouTube ? defuddle.parse() : defuddle.parseAsync(),
      );
      // Prefer Defuddle's own Markdown when present (defuddle/full); the base
      // build doesn't ship it, so convert its clean HTML `content` ourselves.
      const text = result.contentMarkdown
        ? result.contentMarkdown.trim()
        : htmlToMarkdown(result.content ?? "");
      // wordCount is HTML-tag-independent; the lowered floor keeps short but
      // real posts (e.g. a ~19-word tweet) from falling through to readable.
      if (text.length >= 200 || (result.wordCount ?? 0) >= 12) {
        return {
          text,
          meta: {
            title: result.title || undefined,
            site: result.site || result.domain || undefined,
            author: result.author || undefined,
            published: result.published || undefined,
            description: result.description || undefined,
            wordCount: result.wordCount || undefined,
            extractor: result.extractorType || undefined,
            structured,
          },
          mode: "defuddle",
        };
      }
    }
  } catch {
    // Extraction threw (exotic DOM) — fall through to readable text.
  }
  return {
    text: readableFallback,
    meta: structured ? { structured } : undefined,
    mode: "readable",
  };
}
