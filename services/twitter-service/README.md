# Eterna Twitter Service

A thin local HTTP wrapper around [CoinTheHat/twitter-scraper](https://github.com/CoinTheHat/twitter-scraper) so Eterna's research subagents can search X/Twitter in the background. The scraper is a Node library (cookie-based, hits X's internal API) and can't run inside the browser extension — this service exposes it over `localhost`, the same pattern as the model gateways.

## Setup

1. **Get your X cookies.** Log in to x.com, open DevTools → Application → Cookies → `https://x.com`, copy the values of `auth_token` and `ct0`.

2. **Configure:**
   ```bash
   cd services/twitter-service
   cp .env.example .env
   # paste auth_token → TWITTER_AUTH_TOKEN, ct0 → TWITTER_CT0
   ```

3. **Install & run:**
   ```bash
   npm install
   npm start
   ```
   It listens on `http://localhost:8088`. Eterna's `twitter_search` / `twitter_user` tools call it automatically; if it isn't running they fail softly and the subagent moves on.

> The `twitter-scraper` package ships TypeScript source only (no built `dist/`), so `server.ts` imports its source entry directly and `tsx` transpiles it on the fly — no separate build step. Keep this running in its own terminal tab (like the LinkedIn Docker) so it stays up.

## Endpoints

| Route | Params | Returns |
| --- | --- | --- |
| `GET /health` | — | `{ ok: true }` |
| `GET /search` | `q`, `limit?` (≤100) | `{ query, count, tweets[] }` |
| `GET /user` | `handle`, `limit?` | `{ handle, count, tweets[] }` (via `from:handle`) |

Each tweet: `{ id, text, author{name,screen_name,followers}, created_at, likes, retweets, views, url }`.

## Security

This service holds your X session cookies and exposes an unauthenticated endpoint on localhost. Keep it bound to `localhost`, never expose it to the network, and don't commit your `.env`.
