/**
 * Eterna Twitter service — a thin local HTTP wrapper around the
 * CoinTheHat/twitter-scraper library, so the browser extension's research
 * subagents can search X/Twitter in the background via plain fetch (the
 * scraper is a Node library and can't run inside the extension).
 *
 * Run:  npm install && npm start   (reads cookies from .env)
 * Then point the extension's TWITTER_SERVICE_URL at http://localhost:8088
 */

import "dotenv/config";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
// The scraper reads TWITTER_AUTH_TOKEN / TWITTER_CT0 (or the multi-account
// variants) from the environment at construction time.
//
// The published package ships TypeScript source only (its `main` points at a
// dist/ that isn't built), so we import the source entry directly — tsx
// transpiles it on the fly, no separate build step needed.
import { TwitterScraper } from "twitter-scraper/src/index.ts";

const PORT = Number(process.env.PORT ?? 8088);
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const scraper = new TwitterScraper();

interface Tweet {
  id: string;
  text: string;
  author: {
    name: string;
    screen_name: string;
    avatar?: string;
    followers?: number;
  };
  created_at: string;
  views?: number;
  likes?: number;
  retweets?: number;
  url: string;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    // The extension calls this from the service-worker origin.
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

function clampLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true, service: "eterna-twitter-service" });
    return;
  }

  if (url.pathname === "/search") {
    const query = url.searchParams.get("q");
    if (!query) {
      sendJson(res, 400, { error: "Missing required query param 'q'" });
      return;
    }
    const limit = clampLimit(url.searchParams.get("limit"));
    const tweets = (await scraper.search(query, limit)) as Tweet[];
    sendJson(res, 200, { query, count: tweets.length, tweets });
    return;
  }

  // Recent tweets from a specific account, via the search "from:" operator.
  if (url.pathname === "/user") {
    const handle = url.searchParams.get("handle")?.replace(/^@/, "");
    if (!handle) {
      sendJson(res, 400, { error: "Missing required query param 'handle'" });
      return;
    }
    const limit = clampLimit(url.searchParams.get("limit"));
    const tweets = (await scraper.search(`from:${handle}`, limit)) as Tweet[];
    sendJson(res, 200, { handle, count: tweets.length, tweets });
    return;
  }

  sendJson(res, 404, { error: `Unknown path ${url.pathname}` });
}

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 502, { error: message });
  });
});

server.listen(PORT, () => {
  console.log(`[eterna-twitter-service] listening on http://localhost:${PORT}`);
  if (!process.env.TWITTER_AUTH_TOKEN && !process.env.TWITTER_AUTH_TOKENS) {
    console.warn(
      "[eterna-twitter-service] WARNING: no TWITTER_AUTH_TOKEN(S) in env — requests will fail until you add cookies to .env",
    );
  }
});
