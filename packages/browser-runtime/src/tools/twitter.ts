/**
 * Twitter/X research tools — call the local eterna-twitter-service (a thin
 * wrapper around CoinTheHat/twitter-scraper, see services/twitter-service)
 * over localhost. The scraper is a Node library that can't run in the
 * extension, so the service holds the X cookies and does the scraping.
 *
 * When the service isn't running the tools fail softly (success:false) so a
 * research subagent just notes "no Twitter data" and moves on.
 */

import { tool } from "@aipexstudio/aipex-core";
import { z } from "zod";

/** Default URL of the local Twitter service (see services/twitter-service). */
export const TWITTER_SERVICE_URL = "http://localhost:8088";

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;
const REQUEST_TIMEOUT_MS = 25000;

export interface TwitterAuthor {
  name: string;
  screen_name: string;
  followers?: number;
}

export interface Tweet {
  id: string;
  text: string;
  author: TwitterAuthor;
  created_at: string;
  likes?: number;
  retweets?: number;
  views?: number;
  url: string;
}

/** Trim each tweet to the fields a research subagent actually reasons over. */
function compactTweet(raw: unknown): Tweet | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const author = (t.author ?? {}) as Record<string, unknown>;
  if (typeof t.text !== "string") return null;
  return {
    id: String(t.id ?? ""),
    text: t.text,
    author: {
      name: String(author.name ?? ""),
      screen_name: String(author.screen_name ?? ""),
      followers:
        typeof author.followers === "number" ? author.followers : undefined,
    },
    created_at: String(t.created_at ?? ""),
    likes: typeof t.likes === "number" ? t.likes : undefined,
    retweets: typeof t.retweets === "number" ? t.retweets : undefined,
    views: typeof t.views === "number" ? t.views : undefined,
    url: String(t.url ?? ""),
  };
}

async function callTwitterService(
  path: string,
  params: Record<string, string>,
): Promise<
  | { success: true; tweets: Tweet[]; count: number }
  | { success: false; error: string }
> {
  const url = new URL(path, TWITTER_SERVICE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    const data = (await response.json().catch(() => null)) as {
      tweets?: unknown[];
      error?: string;
    } | null;
    if (!response.ok) {
      return {
        success: false,
        error:
          data?.error ?? `Twitter service returned HTTP ${response.status}`,
      };
    }
    const tweets = Array.isArray(data?.tweets)
      ? (data.tweets.map(compactTweet).filter(Boolean) as Tweet[])
      : [];
    return { success: true, tweets, count: tweets.length };
  } catch (error) {
    const aborted =
      error instanceof DOMException && error.name === "AbortError";
    return {
      success: false,
      error: aborted
        ? `Twitter service timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `Twitter service unreachable at ${TWITTER_SERVICE_URL} (is it running?): ${
            error instanceof Error ? error.message : String(error)
          }`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Core of twitter_search — exported for direct unit testing. */
export function runTwitterSearch(query: string, limit?: number) {
  const resultLimit = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  return callTwitterService("/search", {
    q: query,
    limit: String(resultLimit),
  });
}

/** Core of twitter_user — exported for direct unit testing. */
export function runTwitterUser(handle: string, limit?: number) {
  const resultLimit = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  return callTwitterService("/user", {
    handle: handle.replace(/^@/, ""),
    limit: String(resultLimit),
  });
}

export const twitterSearchTool = tool({
  name: "twitter_search",
  description:
    "Search X/Twitter in the background for tweets matching a query. Supports X search operators (e.g. 'from:handle', '#tag', '\"exact phrase\"'). Returns recent tweets with author, engagement and URLs. Requires the local Twitter service to be running.",
  parameters: z.object({
    query: z
      .string()
      .describe(
        "Search query; X operators like from:, #, quotes are supported",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_LIMIT)
      .optional()
      .describe(`Max tweets to return (default ${DEFAULT_LIMIT})`),
  }),
  execute: async ({ query, limit }) =>
    runTwitterSearch(query, limit ?? undefined),
});

export const twitterUserTool = tool({
  name: "twitter_user",
  description:
    "Get recent tweets from a specific X/Twitter account by handle (without the @). Useful for researching a project's or founder's account. Requires the local Twitter service to be running.",
  parameters: z.object({
    handle: z
      .string()
      .describe("The account handle, with or without a leading @"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_LIMIT)
      .optional()
      .describe(`Max tweets to return (default ${DEFAULT_LIMIT})`),
  }),
  execute: async ({ handle, limit }) =>
    runTwitterUser(handle, limit ?? undefined),
});

/** Twitter research tools, registered for research subagents. */
export const twitterResearchTools = [
  twitterSearchTool,
  twitterUserTool,
] as const;
