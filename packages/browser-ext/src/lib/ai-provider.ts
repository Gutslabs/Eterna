/**
 * AI Provider Factory
 * Creates AI SDK provider instances based on configuration: BYOK (bring your
 * own key), the ChatGPT subscription (Codex OAuth), and the local CLIProxyAPI
 * instance serving Gemini, Grok, Claude and Codex over subscription OAuth.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  type AIProviderKey,
  type AppSettings,
  baseModelId,
  defaultReasoningLevelFor,
  type ReasoningLevel,
  splitModelSelection,
} from "@eterna/core";
import { getValidAccessToken } from "../services/chatgpt-auth";

export interface ProviderConfig {
  provider: AIProviderKey;
  apiKey: string;
  baseURL?: string;
}

/**
 * Validate that a user-provided host URL is safe to use.
 * Rejects private/internal addresses to mitigate SSRF risks.
 */
function validateHostUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid aiHost URL: ${url}`);
  }

  // Only allow http/https schemes
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `Unsupported protocol in aiHost: ${parsed.protocol} (only http/https allowed)`,
    );
  }

  // Block common internal/private hostnames
  const hostname = parsed.hostname.toLowerCase();
  const blocked = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "[::1]",
    "metadata.google.internal",
    "169.254.169.254",
  ];

  // In production, block private addresses
  if (import.meta.env.PROD && blocked.includes(hostname)) {
    throw new Error(`aiHost points to a restricted address: ${hostname}`);
  }

  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

/**
 * Check whether the current settings represent a BYOK configuration.
 */
export function isByokConfigured(settings: AppSettings): boolean {
  const byokEnabled = Boolean(settings.byokEnabled);
  if (!byokEnabled) return false;

  const hasToken = Boolean(settings.aiToken?.trim());
  const hasModel = Boolean(settings.aiModel?.trim());
  return hasToken && hasModel;
}

/**
 * Create an AI SDK provider for BYOK mode.
 */
export function createAIProvider(settings: AppSettings) {
  const provider = settings.aiProvider ?? "openai";
  const apiKey = settings.aiToken ?? "";
  const baseURL = validateHostUrl(settings.aiHost || undefined);

  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey, baseURL });
    case "google":
      return createGoogleGenerativeAI({ apiKey, baseURL });
    case "openai":
      return createOpenAI({ apiKey, baseURL });
    default:
      // For custom providers, baseURL is required
      if (!baseURL) {
        throw new Error(
          `Custom provider "${provider}" requires aiHost to be specified`,
        );
      }
      return createOpenAICompatible({ apiKey, baseURL, name: provider });
  }
}

// =============================================================================
// ChatGPT (Codex subscription) provider
// =============================================================================

/** Codex Responses API base; the AI SDK appends "/responses". */
const CODEX_BACKEND_URL = "https://chatgpt.com/backend-api/codex";

/** Models exposed for the ChatGPT subscription path. */
export const CHATGPT_MODELS = ["gpt-5.5", "gpt-5.4"] as const;

export const CHATGPT_DEFAULT_MODEL = "gpt-5.5";

export function normalizeCodexModel(model: string | undefined): string {
  if (!model) return CHATGPT_DEFAULT_MODEL;
  const id = model.includes("/") ? (model.split("/").pop() ?? model) : model;
  return (CHATGPT_MODELS as readonly string[]).includes(id)
    ? id
    : CHATGPT_DEFAULT_MODEL;
}

/** Whether the configured model should route through the ChatGPT subscription. */
export function isChatGptModel(model: string | undefined): boolean {
  if (!model) return false;
  const id = model.includes("/") ? (model.split("/").pop() ?? model) : model;
  return (CHATGPT_MODELS as readonly string[]).includes(id);
}

// =============================================================================
// CLIProxyAPI (local OAuth proxy, :8317)
// =============================================================================

/**
 * One local CLIProxyAPI instance serves every subscription-backed model as a
 * single OpenAI-compatible endpoint, each family behind its own OAuth login:
 * Gemini (`-antigravity-login`), Grok (`-xai-login`), Claude (`-claude-login`)
 * and Codex (`-codex-login`). Requests reach the vendor's real API, so full
 * messages, tools, streaming and parallel requests are all preserved. The api
 * key must match one of the proxy config's `api-keys`.
 */
const CLI_PROXY_URL = "http://localhost:8317/v1";

export const CLI_PROXY_API_KEY = "eterna";

/**
 * Membership test that ignores a "::<level>" reasoning suffix, so routing keeps
 * working whichever effort the user picked.
 */
function isListed(models: readonly string[], model: string | undefined) {
  return !!model && models.includes(baseModelId(model));
}

/**
 * Gemini backed by the user's Google account through Antigravity OAuth. Google
 * retired the old gemini-cli / Code Assist backend on 2026-06-18, so the
 * gemini-2.5 / *-preview ids are gone; the Antigravity catalog serves 3.x.
 */
export const GEMINI_GATEWAY_MODELS = ["gemini-3.7-flash-high"] as const;

export function isGeminiGatewayModel(model: string | undefined): boolean {
  return isListed(GEMINI_GATEWAY_MODELS, model);
}

/**
 * Grok backed by the user's Grok Build account through xAI OAuth. The 4.3,
 * 4.20 and grok-3 generations were dropped from the account's catalog — the
 * proxy still lists them but every call comes back as invalid credentials.
 */
export const XAI_GATEWAY_MODELS = ["grok-4.6"] as const;

export function isXaiGatewayModel(model: string | undefined): boolean {
  return isListed(XAI_GATEWAY_MODELS, model);
}

/**
 * Claude backed by the user's Claude Code OAuth subscription; the proxy calls
 * api.anthropic.com/v1/messages on its behalf, so these are the same models
 * Claude Code itself serves and they draw on the same subscription limits.
 */
export const CLAUDE_GATEWAY_MODELS = [
  "claude-fable-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-sonnet-5",
] as const;

export function isClaudeGatewayModel(model: string | undefined): boolean {
  return isListed(CLAUDE_GATEWAY_MODELS, model);
}

/**
 * Thinking budgets for the native Anthropic path, one per picker level.
 * Effort must translate to an explicit budget here because the native
 * endpoint passes our body through — there is no reasoning_effort mapping.
 */
const CLAUDE_THINKING_BUDGETS: Record<ReasoningLevel, number> = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 32768,
  max: 49152,
};

/** Anthropic requires max_tokens > budget_tokens; keep answer headroom too. */
const CLAUDE_ANSWER_HEADROOM_TOKENS = 8192;
const CLAUDE_MIN_MAX_TOKENS = 16000;

/**
 * Rewrite bodies for the proxy's native /v1/messages endpoint: split the
 * picker's "<model>::<level>" selection and turn the level into an Anthropic
 * thinking block. Thinking constrains sampling, so temperature/top_p/top_k are
 * dropped and max_tokens is raised above the budget when needed.
 */
export async function claudeNativeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const body = init?.body;
  if (typeof body !== "string") return fetch(input, init);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return fetch(input, init);
  }
  if (typeof parsed.model !== "string") return fetch(input, init);

  const { model, reasoningLevel } = splitModelSelection(parsed.model);
  parsed.model = model;

  const level = reasoningLevel ?? defaultReasoningLevelFor(model);
  if (level && parsed.thinking === undefined) {
    const budget = CLAUDE_THINKING_BUDGETS[level];
    parsed.thinking = { type: "enabled", budget_tokens: budget };
    parsed.temperature = undefined;
    parsed.top_p = undefined;
    parsed.top_k = undefined;
    const maxTokens =
      typeof parsed.max_tokens === "number" ? parsed.max_tokens : 0;
    parsed.max_tokens = Math.max(
      maxTokens,
      budget + CLAUDE_ANSWER_HEADROOM_TOKENS,
      CLAUDE_MIN_MAX_TOKENS,
    );
  }

  // Anthropic's server-side web search: the backend runs the search itself
  // (verified working through CLIProxyAPI). Eterna ships no app-level search,
  // so this is where Claude models get theirs.
  const claudeTools = Array.isArray(parsed.tools)
    ? (parsed.tools as Array<Record<string, unknown>>)
    : [];
  const hasClaudeWebSearch = claudeTools.some(
    (tool) =>
      tool?.name === "web_search" ||
      String(tool?.type ?? "").startsWith("web_search"),
  );
  if (!hasClaudeWebSearch) {
    parsed.tools = [
      ...claudeTools,
      { type: "web_search_20250305", name: "web_search", max_uses: 5 },
    ];
  }

  return fetch(input, { ...init, body: JSON.stringify(parsed) });
}

/**
 * Claude rides the proxy's native Anthropic endpoint instead of its OpenAI
 * translation: the translation buffers text into large bursts while a
 * thinking block is open (and forwards the thinking itself as one empty
 * chunk), whereas /v1/messages streams genuine token-level deltas.
 */
export function createClaudeGatewayProvider() {
  return createAnthropic({
    baseURL: CLI_PROXY_URL,
    apiKey: CLI_PROXY_API_KEY,
    fetch: claudeNativeFetch,
  });
}

/**
 * Codex backed by the user's ChatGPT OAuth subscription. Routed through the
 * proxy rather than the in-extension Responses API path so every
 * subscription-backed model shares one transport, one health probe and one
 * offline guide.
 */
export const CODEX_GATEWAY_MODELS = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
] as const;

export function isCodexGatewayModel(model: string | undefined): boolean {
  return isListed(CODEX_GATEWAY_MODELS, model);
}

export function isCliProxyModel(model: string | undefined): boolean {
  return (
    isGeminiGatewayModel(model) ||
    isXaiGatewayModel(model) ||
    isClaudeGatewayModel(model) ||
    isCodexGatewayModel(model)
  );
}

/**
 * Unpack the "<model>::<level>" selection the picker stores into the plain
 * model id the proxy expects plus its `reasoning_effort` field.
 *
 * Models with no chosen level still get their default, because leaving the
 * field unset makes Gemini 3.x leak raw thoughts into the visible text channel
 * (prefixed with a "待94>thought" delimiter) instead of emitting them as
 * reasoning_content deltas the UI can route into the activity rail.
 */
export async function cliProxyFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const body = init?.body;
  if (typeof body !== "string") return fetch(input, init);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    // Non-JSON body — pass through untouched.
    return fetch(input, init);
  }

  if (typeof parsed.model !== "string") return fetch(input, init);

  const { model, reasoningLevel } = splitModelSelection(parsed.model);
  const effort = reasoningLevel ?? defaultReasoningLevelFor(model);
  if (model === parsed.model && !effort) return fetch(input, init);

  parsed.model = model;
  if (effort && parsed.reasoning_effort === undefined) {
    parsed.reasoning_effort = effort;
  }
  return fetch(input, { ...init, body: JSON.stringify(parsed) });
}

/**
 * Provider for the local CLIProxyAPI instance, which serves Gemini, Grok,
 * Claude and Codex as one OpenAI-compatible endpoint.
 */
export function createCliProxyProvider() {
  return createOpenAICompatible({
    name: "cli-proxy",
    baseURL: CLI_PROXY_URL,
    apiKey: CLI_PROXY_API_KEY,
    fetch: cliProxyFetch,
  });
}

/**
 * Custom fetch that authenticates Codex Responses API calls with the user's
 * ChatGPT subscription token and adds the headers/body fields the backend
 * expects. Token refresh is handled by getValidAccessToken.
 */
async function codexFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error("Not signed in to ChatGPT. Please sign in again.");
  }

  const headers = new Headers(init?.headers);
  headers.delete("x-api-key");
  headers.set("Authorization", `Bearer ${token.accessToken}`);
  headers.set("chatgpt-account-id", token.accountId);
  headers.set("OpenAI-Beta", "responses=experimental");
  headers.set("originator", "codex_cli_rs");
  headers.set("session_id", crypto.randomUUID());
  headers.set("accept", "text/event-stream");

  let body = init?.body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      // Fields the Codex backend requires / rejects (mirrors the Codex CLI).
      parsed.store = false;
      parsed.stream = true;
      parsed.max_output_tokens = undefined;
      parsed.max_completion_tokens = undefined;

      // Responses API built-in web search (what `codex --search` enables).
      // Eterna ships no app-level search, so this is where Codex models get
      // theirs.
      const tools = Array.isArray(parsed.tools)
        ? (parsed.tools as Array<Record<string, unknown>>)
        : [];
      const hasWebSearch = tools.some((tool) =>
        String(tool?.type ?? "").startsWith("web_search"),
      );
      if (!hasWebSearch) {
        parsed.tools = [...tools, { type: "web_search" }];
      }

      // The Codex backend requires a top-level `instructions` field. The AI SDK
      // puts the system prompt as a developer/system message inside `input`, so
      // lift it out into `instructions`.
      if (!parsed.instructions && Array.isArray(parsed.input)) {
        const input = parsed.input as Array<Record<string, unknown>>;
        const idx = input.findIndex(
          (m) => m?.role === "developer" || m?.role === "system",
        );
        const msg = idx === -1 ? undefined : input[idx];
        if (msg) {
          const content = msg.content;
          parsed.instructions =
            typeof content === "string"
              ? content
              : Array.isArray(content)
                ? content
                    .map((part) =>
                      typeof part === "string"
                        ? part
                        : (((part as Record<string, unknown>)?.text as
                            | string
                            | undefined) ?? ""),
                    )
                    .join("")
                : "";
          input.splice(idx, 1);
        }
      }
      if (!parsed.instructions) {
        parsed.instructions = "You are a helpful assistant.";
      }

      // Normalize input for the stateless (store=false) backend:
      if (Array.isArray(parsed.input)) {
        // 1. Drop references to server-stored items — they don't exist here.
        const items = (parsed.input as Array<Record<string, unknown>>).filter(
          (item) => item?.type !== "item_reference",
        );
        // 2. Convert orphaned tool outputs (whose function_call was lost) into
        //    plain messages, else the backend rejects the unmatched call_id.
        const callIds = new Set(
          items
            .filter((item) => item?.type === "function_call")
            .map((item) => item.call_id),
        );
        parsed.input = items.map((item) => {
          if (
            item?.type === "function_call_output" &&
            !callIds.has(item.call_id)
          ) {
            const output =
              typeof item.output === "string"
                ? item.output
                : JSON.stringify(item.output ?? "");
            return {
              role: "user",
              content: [
                { type: "input_text", text: `Tool result:\n${output}` },
              ],
            };
          }
          return item;
        });
      }

      const include = new Set<string>(
        Array.isArray(parsed.include) ? (parsed.include as string[]) : [],
      );
      include.add("reasoning.encrypted_content");
      parsed.include = [...include];
      body = JSON.stringify(parsed);
    } catch {
      // Leave non-JSON bodies untouched.
    }
  }

  const response = await globalThis.fetch(input, { ...init, headers, body });
  if (!response.ok) {
    console.error("[codex] request failed", {
      status: response.status,
      statusText: response.statusText,
      requestId: response.headers.get("x-request-id") ?? undefined,
    });
  }
  return response;
}

/**
 * Provider for the ChatGPT subscription path. Talks to the Codex Responses API
 * backend with OAuth-based auth instead of an API key.
 */
export function createChatGptProvider(): OpenAIProvider["responses"] {
  const openai = createOpenAI({
    apiKey: "chatgpt-oauth",
    baseURL: CODEX_BACKEND_URL,
    fetch: codexFetch,
  });
  return openai.responses;
}
