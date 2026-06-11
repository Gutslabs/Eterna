/**
 * Heuristic page brief for the welcome screen's page card: classifies the
 * current page from url/title/text (no LLM call) and picks page-specific
 * suggestion prompts. All user-facing strings are i18n keys under
 * `pageBrief.*`, resolved by the component.
 */

export type PageKind =
  | "video"
  | "x-feed"
  | "x-post"
  | "github"
  | "article"
  | "page";

export interface PageSuggestion {
  /** Mono chip label, e.g. "VIDEO" — i18n key suffix under pageBrief.tag. */
  tag: string;
  /** Prompt text — i18n key suffix under pageBrief.sugg. */
  key: string;
}

export interface PageBrief {
  kind: PageKind;
  /** i18n key suffix under pageBrief.kind — subtitle's first segment. */
  kindKey: string;
  /** i18n key suffix under pageBrief.body — the one-sentence "what I see". */
  bodyKey: string;
  /** Word count of the scanned text (0 when unreadable). */
  wordCount: number;
  /** Rough reading minutes for articles (200 wpm), at least 1. */
  readingMinutes: number;
  suggestions: PageSuggestion[];
}

const SUGGESTIONS: Record<PageKind, PageSuggestion[]> = {
  video: [
    { tag: "video", key: "videoSummarize" },
    { tag: "video", key: "videoMoments" },
    { tag: "video", key: "videoTakeaway" },
  ],
  "x-feed": [
    { tag: "feed", key: "feedSummarize" },
    { tag: "trend", key: "feedTrends" },
    { tag: "feed", key: "feedInteresting" },
  ],
  "x-post": [
    { tag: "thread", key: "postSummarize" },
    { tag: "thread", key: "postContext" },
    { tag: "reply", key: "postReply" },
  ],
  github: [
    { tag: "repo", key: "githubExplain" },
    { tag: "repo", key: "githubReadme" },
    { tag: "code", key: "githubChanges" },
  ],
  article: [
    { tag: "tldr", key: "articleTldr" },
    { tag: "article", key: "articleArguments" },
    { tag: "article", key: "articleQuestions" },
  ],
  page: [
    { tag: "page", key: "pageSummarize" },
    { tag: "page", key: "pageActions" },
    { tag: "page", key: "pageExplain" },
  ],
};

const ARTICLE_MIN_WORDS = 700;
const READING_WPM = 200;

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

function classify(url: URL, wordCount: number): PageKind {
  const host = url.hostname.replace(/^www\.|^m\./, "");
  const path = url.pathname;

  if (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtu.be"
  ) {
    if (
      host === "youtu.be" ||
      /^\/(watch|shorts|live|embed)/.test(path) ||
      url.searchParams.has("v")
    ) {
      return "video";
    }
    return "page";
  }

  if (host === "x.com" || host === "twitter.com") {
    return /\/status\/\d+/.test(path) ? "x-post" : "x-feed";
  }

  if (host === "github.com") {
    return "github";
  }

  if (wordCount >= ARTICLE_MIN_WORDS) {
    return "article";
  }

  return "page";
}

const KIND_KEYS: Record<PageKind, string> = {
  video: "video",
  "x-feed": "feed",
  "x-post": "thread",
  github: "repo",
  article: "article",
  page: "page",
};

export function buildPageBrief(rawUrl: string, pageText: string): PageBrief {
  let kind: PageKind = "page";
  const wordCount = countWords(pageText);
  try {
    kind = classify(new URL(rawUrl), wordCount);
  } catch {
    kind = "page";
  }

  return {
    kind,
    kindKey: KIND_KEYS[kind],
    bodyKey: kind,
    wordCount,
    readingMinutes: Math.max(1, Math.round(wordCount / READING_WPM)),
    suggestions: SUGGESTIONS[kind],
  };
}

/** Strip site-name suffixes like " - YouTube" / " / X" from a tab title. */
export function cleanPageTitle(title: string | undefined, url: string): string {
  const fallback = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const trimmed = title?.trim();
  if (!trimmed) {
    return fallback;
  }
  return (
    trimmed
      .replace(/\s*[-–—|·]\s*(YouTube|GitHub|Reddit)\s*$/i, "")
      .replace(/\s*\/\s*X\s*$/, "")
      .trim() || fallback
  );
}
