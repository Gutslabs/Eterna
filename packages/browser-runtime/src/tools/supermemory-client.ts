import { STORAGE_KEYS } from "@eterna/core";

/**
 * Thin fetch client for a Supermemory local server (localhost, closed-source
 * binary, MIT SDK — see https://supermemory.ai/docs/self-hosting/overview).
 * Deliberately NOT the `supermemory` npm SDK: the surface Eterna needs is four
 * endpoints, and a hand-rolled client keeps the engine swappable.
 *
 * Every call fails soft (null) — the extension must behave identically when
 * the server is not running, mirroring the twitter-service pattern.
 */

export interface SupermemoryConfig {
  url: string;
  apiKey: string;
}

export interface SupermemoryProfile {
  /** Stable long-term facts about the user. */
  static: string[];
  /** Recent activity / short-term context. */
  dynamic: string[];
}

export interface SupermemoryHit {
  memory: string;
  similarity?: number;
  updatedAt?: string;
}

/** All Eterna memories live in one container on the local server. */
const CONTAINER_TAG = "eterna";
const REQUEST_TIMEOUT_MS = 2500;

export async function loadSupermemoryConfig(): Promise<SupermemoryConfig | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SUPERMEMORY);
    const value = result[STORAGE_KEYS.SUPERMEMORY] as
      | Partial<SupermemoryConfig>
      | undefined;
    if (
      typeof value?.url === "string" &&
      value.url.trim() &&
      typeof value?.apiKey === "string" &&
      value.apiKey.trim()
    ) {
      return {
        url: value.url.trim().replace(/\/+$/, ""),
        apiKey: value.apiKey.trim(),
      };
    }
  } catch {
    // storage unavailable — treat as unconfigured
  }
  return null;
}

async function smPost<T>(
  config: SupermemoryConfig,
  path: string,
  body: unknown,
): Promise<T | null> {
  try {
    const response = await fetch(`${config.url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Feed content into the extraction pipeline (facts are extracted, deduped and
 * consolidated server-side). Soft-fails to false.
 */
export async function captureToSupermemory(content: string): Promise<boolean> {
  const config = await loadSupermemoryConfig();
  if (!config) {
    return false;
  }
  const result = await smPost<{ id?: string }>(config, "/v3/documents", {
    content,
    containerTag: CONTAINER_TAG,
  });
  return result !== null;
}

interface RawSearchResponse {
  results?: Array<{
    memory?: string;
    chunk?: string;
    similarity?: number;
    updatedAt?: string;
  }>;
}

/**
 * Memory-entry search (v4 — flat extracted memories, not document chunks).
 * Soft-fails to null.
 */
export async function searchSupermemory(
  query: string,
  limit = 6,
): Promise<SupermemoryHit[] | null> {
  const config = await loadSupermemoryConfig();
  if (!config) {
    return null;
  }
  const raw = await smPost<RawSearchResponse>(config, "/v4/search", {
    q: query,
    containerTag: CONTAINER_TAG,
    limit,
  });
  if (!raw?.results) {
    return null;
  }
  return raw.results
    .map((result) => ({
      memory: (result.memory ?? result.chunk ?? "").slice(0, 500),
      similarity: result.similarity,
      updatedAt: result.updatedAt,
    }))
    .filter((hit) => hit.memory)
    .slice(0, limit);
}

interface RawProfileResponse {
  profile?: { static?: string[]; dynamic?: string[] };
}

async function fetchProfile(): Promise<SupermemoryProfile | null> {
  const config = await loadSupermemoryConfig();
  if (!config) {
    return null;
  }
  const raw = await smPost<RawProfileResponse>(config, "/v4/profile", {
    containerTag: CONTAINER_TAG,
  });
  if (!raw?.profile) {
    return null;
  }
  return {
    static: raw.profile.static ?? [],
    dynamic: raw.profile.dynamic ?? [],
  };
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Feed a conversation exchange to the extraction pipeline. Same
 * conversationId across turns lets the server ingest incrementally
 * ("ingest or update"). Soft-fails to false.
 */
export async function captureConversationToSupermemory(
  conversationId: string,
  messages: ConversationTurn[],
): Promise<boolean> {
  const config = await loadSupermemoryConfig();
  if (!config || messages.length === 0) {
    return false;
  }
  // NOTE: unlike /v3/documents (singular containerTag), this endpoint takes a
  // containerTags ARRAY — the singular form is silently ignored.
  const result = await smPost<{ ok?: boolean }>(config, "/v4/conversations", {
    conversationId,
    containerTags: [CONTAINER_TAG],
    messages,
  });
  return result !== null;
}

/**
 * Natural-language forget on the server ("forget everything about X").
 * Complements the local forget-by-id — no memoryId bookkeeping needed.
 * Soft-fails to false.
 */
export async function forgetMatchingInSupermemory(
  query: string,
): Promise<boolean> {
  const config = await loadSupermemoryConfig();
  if (!config) {
    return false;
  }
  const result = await smPost<{ forgotten?: unknown }>(
    config,
    "/v4/memories/forget-matching",
    { query, containerTag: CONTAINER_TAG, threshold: 0.7 },
  );
  return result !== null;
}

const PROFILE_CACHE_TTL_MS = 60_000;
let profileCache: {
  value: SupermemoryProfile | null;
  fetchedAt: number;
} | null = null;

/**
 * Profile with a short-lived cache so agent (re)builds don't hit the server —
 * or its timeout when it is down — on every turn.
 */
export async function fetchSupermemoryProfileCached(
  now = Date.now(),
): Promise<SupermemoryProfile | null> {
  if (profileCache && now - profileCache.fetchedAt < PROFILE_CACHE_TTL_MS) {
    return profileCache.value;
  }
  const value = await fetchProfile();
  profileCache = { value, fetchedAt: now };
  return value;
}

/** Test hook. */
export function resetSupermemoryProfileCache(): void {
  profileCache = null;
}

const MAX_PROFILE_ITEMS = 6;

/** Prompt section for the user profile; empty when there is nothing to show. */
export function renderProfileForPrompt(
  profile: SupermemoryProfile | null,
): string {
  if (!profile) {
    return "";
  }
  const stable = profile.static.slice(0, MAX_PROFILE_ITEMS);
  const recent = profile.dynamic.slice(0, MAX_PROFILE_ITEMS);
  if (stable.length === 0 && recent.length === 0) {
    return "";
  }
  const lines: string[] = [
    "=== USER PROFILE (from long-term memory) ===",
    "Auto-maintained from past conversations — use it to personalise your help; call recall for anything deeper.",
  ];
  if (stable.length > 0) {
    lines.push("Stable:", ...stable.map((item) => `- ${item}`));
  }
  if (recent.length > 0) {
    lines.push("Recent:", ...recent.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}
