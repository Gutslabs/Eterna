# Supermemory local (long-term memory)

Eterna's long-term memory engine — [supermemory](https://github.com/supermemoryai/supermemory)
running as a local server, same pattern as the CLIProxyAPI and twitter-service
localhost dependencies. Embeddings run locally (bge-base via ONNX); only
fact-extraction calls an LLM, routed through CLIProxyAPI so it uses the same
subscription as Eterna itself. Nothing leaves the machine.

The server binary is closed-source (installed from the vendor's GitHub
releases); the extension talks to it through a thin hand-rolled REST client
(`packages/browser-runtime/src/tools/supermemory-client.ts`), so the engine
stays swappable.

## Install & run

```bash
npx -y supermemory local install
npx -y supermemory local --port 6767
```

Port 6767 is deliberate — the default (8787) may collide with other local
services. Config lives in `~/.supermemory/env`:

```
OPENAI_BASE_URL=http://localhost:8317/v1   # CLIProxyAPI
OPENAI_API_KEY=eterna
OPENAI_MODEL=gemini-3.7-flash-high         # extraction model (fast + cheap)
SUPERMEMORY_DATA_DIR=~/.supermemory/data   # keep the store out of any repo
```

First boot prints an API key (also in `$SUPERMEMORY_DATA_DIR/api-key`). Paste
it with `http://localhost:6767` into **Eterna → Settings → General →
Supermemory (local)**.

## What the extension does with it

- **Auto-capture** — every cleanly finished turn is posted to
  `/v4/conversations` (chat-host `onTurnComplete`); the server extracts
  atomic facts, dedupes and maintains the user profile.
- **Profile block** — `/v4/profile` (static + dynamic facts) is injected into
  the system prompt at agent build, cached 60s.
- **`recall` tool** — semantic memory search via `/v4/search`.
- **`remember` / `forget`** — dual-written: chrome.storage stays the offline
  source of truth; the server gets the fact / a natural-language
  `forget-matching` call.
- Everything fails soft: with the server off, memory falls back to
  chrome.storage and nothing else changes.

## API traps (learned the hard way)

- `/v3/documents` takes a **singular** `containerTag`; `/v4/conversations` and
  `/v4/memories/list` take a **plural** `containerTags` array — the wrong form
  is silently ignored and data lands in a default container.
- All Eterna data lives under the `eterna` container tag.
- v0.0.6 binaries had a fatal packaging bug (ingestion worker never starts —
  documents stuck in `queued`); use ≥ 0.0.7. Major upgrades may require a
  fresh store; back up `$SUPERMEMORY_DATA_DIR` (minus `models/`) first.
