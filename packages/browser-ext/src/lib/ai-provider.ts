/**
 * AI Provider Factory
 * Creates AI SDK provider instances based on configuration: BYOK (bring your
 * own key), the ChatGPT subscription (Codex OAuth), and the local gateways.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AIProviderKey, AppSettings } from "@aipexstudio/aipex-core";
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
// CatGPT-Gateway (local OpenAI-compatible server driving the ChatGPT web app)
// =============================================================================

/** Default endpoint of a locally-running CatGPT-Gateway instance. */
const CATGPT_GATEWAY_URL = "http://localhost:8000/v1";

/**
 * Each gateway instance serves a single provider, so Claude runs as a second
 * instance on its own port. catgpt-browser → :8000, claude-browser → :8001.
 */
const CLAUDE_GATEWAY_URL = "http://localhost:8001/v1";

/** Gateway bearer token — its .env API_TOKEN, which defaults to "dummy123". */
const CATGPT_GATEWAY_TOKEN = "dummy123";

/** Models served by the local gateway (ChatGPT + Claude web sessions). */
export const CATGPT_GATEWAY_MODELS = [
  "catgpt-browser",
  "claude-browser",
] as const;

export function isCatGptGatewayModel(model: string | undefined): boolean {
  // Sub-models are encoded as "<base>::<label>", e.g. "claude-browser::Opus 5|High".
  const base = model?.split("::")[0];
  return !!base && (CATGPT_GATEWAY_MODELS as readonly string[]).includes(base);
}

/**
 * Gemini via a local CLIProxyAPI instance, backed by the user's Google account
 * through Antigravity OAuth (`cliproxyapi -antigravity-login`). Google retired
 * the old gemini-cli / Code Assist backend on 2026-06-18, so the previous
 * gemini-cli OAuth and the gemini-2.5 / *-preview model ids are gone; the
 * Antigravity catalog serves Gemini 3.x instead. Unlike the ChatGPT/Claude web
 * gateways this is a genuine OpenAI-compatible endpoint — full messages, tools
 * and streaming are kept. The api key must match one of the proxy `api-keys`.
 */
const GEMINI_GATEWAY_URL = "http://localhost:8317/v1";

export const GEMINI_GATEWAY_MODELS = [
  "gemini-3.1-pro-low",
  "gemini-3-flash",
] as const;

export function isGeminiGatewayModel(model: string | undefined): boolean {
  return (
    !!model && (GEMINI_GATEWAY_MODELS as readonly string[]).includes(model)
  );
}

/**
 * Grok via the same local CLIProxyAPI instance (xAI OAuth, backed by the
 * user's Grok Build account — `cliproxyapi -xai-login`). Served from the same
 * :8317 endpoint as Gemini, so it shares createGeminiGatewayProvider; full
 * messages, tools and streaming all work.
 */
export const XAI_GATEWAY_MODELS = [
  "grok-4.3",
  "grok-4.20-0309-reasoning",
  "grok-build-0.1",
  "grok-composer-2.5-fast",
] as const;

export function isXaiGatewayModel(model: string | undefined): boolean {
  return !!model && (XAI_GATEWAY_MODELS as readonly string[]).includes(model);
}

/**
 * Claude via the same local CLIProxyAPI instance, backed by the user's Claude
 * Code OAuth subscription (`cliproxyapi -claude-login`). Served from the same
 * :8317 endpoint as Gemini and Grok, so it shares createGeminiGatewayProvider
 * — geminiGatewayFetch only rewrites bodies whose model starts with "gemini",
 * so Claude requests pass through untouched. This is the genuine-API path
 * (full messages, tools, streaming, parallel subagents), distinct from the
 * web-UI-driven `claude-browser` gateway.
 */
export const CLAUDE_GATEWAY_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
] as const;

export function isClaudeGatewayModel(model: string | undefined): boolean {
  return (
    !!model && (CLAUDE_GATEWAY_MODELS as readonly string[]).includes(model)
  );
}

/**
 * Whether a model can fan out into concurrent background subagents.
 *
 * Only true for real API/OAuth endpoints that accept parallel requests:
 * Gemini, Grok and Claude (CLIProxyAPI :8317) and Codex/ChatGPT (OAuth
 * Responses API). The web gateways (catgpt-browser, claude-browser) drive a
 * single shared web-UI thread and cannot run requests in parallel, so subagent
 * orchestration is disabled there.
 */
export function supportsParallelSubagents(model: string | undefined): boolean {
  return (
    isGeminiGatewayModel(model) ||
    isXaiGatewayModel(model) ||
    isClaudeGatewayModel(model) ||
    isChatGptModel(model)
  );
}

/**
 * Convert one non-streaming fallback completion into the SSE chunk format the
 * AI SDK expects. Text-only ChatGPT requests pass through the gateway's live
 * SSE stream; attachments keep using this compatibility path.
 */
function chatCompletionToSse(json: {
  id?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    message?: { content?: string; tool_calls?: Array<Record<string, unknown>> };
    finish_reason?: string;
  }>;
}): string {
  const choice = json.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const delta: Record<string, unknown> = {
    role: "assistant",
    content: message.content ?? "",
  };
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    delta.tool_calls = message.tool_calls.map((call, index) => ({
      index,
      ...call,
    }));
  }
  const base = {
    id: json.id ?? "chatcmpl-gateway",
    object: "chat.completion.chunk",
    created: json.created ?? 0,
    model: json.model ?? "catgpt-browser",
  };
  const deltaChunk = {
    ...base,
    choices: [{ index: 0, delta, finish_reason: null }],
  };
  const finishChunk = {
    ...base,
    choices: [
      { index: 0, delta: {}, finish_reason: choice.finish_reason ?? "stop" },
    ],
  };
  return `data: ${JSON.stringify(deltaChunk)}\n\ndata: ${JSON.stringify(
    finishChunk,
  )}\n\ndata: [DONE]\n\n`;
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        const record = part as Record<string, unknown>;
        return (
          (record?.text as string | undefined) ??
          (record?.content as string | undefined) ??
          ""
        );
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

async function gatewayErrorMessage(response: Response): Promise<string> {
  const text = await response
    .clone()
    .text()
    .catch(() => "");
  if (!text) return response.statusText || "Unknown gateway error";

  try {
    const body = JSON.parse(text) as {
      detail?: unknown;
      error?: { message?: unknown } | string;
    };
    if (typeof body.detail === "string") return body.detail;
    if (typeof body.error === "string") return body.error;
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {
    // Plain-text and HTML proxy errors fall through to the bounded body.
  }

  return text.slice(0, 1000);
}

/**
 * Conversation identities for gateway thread routing. This module runs in the
 * shared background worker, so one mutable "current conversation" slot would
 * be overwritten whenever another sidebar, stored chat, provider, or
 * compression request runs. Keep a small LRU keyed by provider + the complete
 * first user message instead.
 */
const MAX_GATEWAY_CONVERSATIONS = 100;
const gatewayConversationIds = new Map<string, string>();
const gatewayProvidersRequiringFreshIdentity = new Set<string>();

function gatewayConversationFingerprint(value: string): string {
  let first = 0xdeadbeef ^ value.length;
  let second = 0x41c6ce57 ^ value.length;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first =
    Math.imul(first ^ (first >>> 16), 2246822507) ^
    Math.imul(second ^ (second >>> 13), 3266489909);
  second =
    Math.imul(second ^ (second >>> 16), 2246822507) ^
    Math.imul(first ^ (first >>> 13), 3266489909);
  return `${value.length}:${(second >>> 0).toString(36)}${(first >>> 0).toString(36)}`;
}

function gatewayConversationKey(
  model: string | undefined,
  firstUserText: string,
  routingId?: string,
): string {
  const identity = routingId
    ? `route:${routingId}`
    : `prompt:${gatewayConversationFingerprint(firstUserText)}`;
  return `${gatewayProviderKey(model)}\u0000${identity}`;
}

function gatewayProviderKey(model: string | undefined): string {
  return model?.split("::", 1)[0] ?? "catgpt-browser";
}

/**
 * Reset for the user's New Chat click. The next request gets a fresh local
 * identity without discarding mappings for other saved conversations; the
 * caller may leave the remote web thread untouched while an older request is
 * still using it.
 */
export function startFreshGatewayThread(
  model: string | undefined,
  options: { resetRemote?: boolean } = {},
): void {
  if (!isCatGptGatewayModel(model)) {
    return;
  }
  gatewayProvidersRequiringFreshIdentity.add(gatewayProviderKey(model));
  if (options.resetRemote === false) {
    return;
  }
  const base = model?.startsWith("claude-browser")
    ? CLAUDE_GATEWAY_URL
    : CATGPT_GATEWAY_URL;
  const origin = base.replace(/\/v1\/?$/, "");
  void globalThis
    .fetch(`${origin}/thread/reset`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CATGPT_GATEWAY_TOKEN}` },
    })
    .catch(() => {});
}

/**
 * A UI route deterministically maps to one gateway conversation, so an MV3
 * service-worker restart cannot silently open a new web thread. Legacy callers
 * without a route retain prompt-based retry identity and the fresh-chat marker.
 */
function resolveGatewayConversationId(
  model: string | undefined,
  firstUserText: string,
  canConsumeFreshIdentity: boolean,
  routingId?: string,
): string {
  const providerKey = gatewayProviderKey(model);
  if (routingId) {
    if (canConsumeFreshIdentity) {
      gatewayProvidersRequiringFreshIdentity.delete(providerKey);
    }
    const fingerprint = gatewayConversationFingerprint(
      `${providerKey}\u0000${routingId}`,
    ).replace(":", "-");
    return `eterna-${fingerprint}`;
  }

  const key = gatewayConversationKey(model, firstUserText, routingId);
  const existing = gatewayConversationIds.get(key);
  let forceFresh = false;
  if (
    canConsumeFreshIdentity &&
    gatewayProvidersRequiringFreshIdentity.has(providerKey)
  ) {
    forceFresh = gatewayProvidersRequiringFreshIdentity.delete(providerKey);
  }
  if (existing && !forceFresh) {
    gatewayConversationIds.delete(key);
    gatewayConversationIds.set(key, existing);
    return existing;
  }

  const conversationId = crypto.randomUUID();
  gatewayConversationIds.set(key, conversationId);
  if (gatewayConversationIds.size > MAX_GATEWAY_CONVERSATIONS) {
    const oldestKey = gatewayConversationIds.keys().next().value;
    if (oldestKey !== undefined) {
      gatewayConversationIds.delete(oldestKey);
    }
  }
  return conversationId;
}

/**
 * Custom fetch for the gateway. The web UI keeps its own conversation memory
 * and can't run our tools, so each request sends ONLY the latest user message
 * (with any image) — never the AIPex system prompt or tool schemas — plus a
 * conversation_id. The gateway maps that id to a web thread: a fresh AIPex
 * chat opens a new thread, and when several sidebars share the one browser
 * page the gateway navigates back to the right thread before sending.
 */
export async function catgptGatewayFetch(
  _input: RequestInfo | URL,
  init?: RequestInit,
  routingId?: string,
): Promise<Response> {
  let wantsStream = false;
  let firstUserText = "";
  let parsedBody: {
    model?: string;
    stream?: boolean;
    messages?: Array<Record<string, unknown>>;
  } | null = null;

  if (typeof init?.body === "string") {
    try {
      parsedBody = JSON.parse(init.body);
      wantsStream = parsedBody?.stream === true;
      const messages = Array.isArray(parsedBody?.messages)
        ? parsedBody.messages
        : [];
      const firstUser = messages.find((m) => m?.role === "user");
      firstUserText = extractMessageText(firstUser?.content);
    } catch {
      // ignore — an unparsable body falls through as an empty message
    }
  }

  const model =
    typeof parsedBody?.model === "string" ? parsedBody.model : undefined;
  const gatewayBase = model?.startsWith("claude-browser")
    ? CLAUDE_GATEWAY_URL
    : CATGPT_GATEWAY_URL;
  const origin = gatewayBase.replace(/\/v1\/?$/, "");

  const allMessages = Array.isArray(parsedBody?.messages)
    ? parsedBody.messages
    : [];
  const lastUserMessage = [...allMessages]
    .reverse()
    .find((m) => m?.role === "user");
  const lastUserContent = lastUserMessage?.content;
  const supportsLiveStream =
    wantsStream &&
    (typeof lastUserContent === "string" ||
      (Array.isArray(lastUserContent) &&
        lastUserContent.every(
          (part) =>
            typeof part === "object" &&
            part !== null &&
            (part as { type?: unknown }).type === "text",
        )));
  const canConsumeFreshIdentity = !allMessages.some(
    (message) => message?.role === "assistant" || message?.role === "tool",
  );
  const conversationId = resolveGatewayConversationId(
    model,
    firstUserText,
    canConsumeFreshIdentity,
    routingId,
  );

  const response = await globalThis.fetch(`${origin}/v1/chat/completions`, {
    ...init,
    body: JSON.stringify({
      ...parsedBody,
      messages: lastUserMessage
        ? [lastUserMessage]
        : [{ role: "user", content: "(empty message)" }],
      tools: undefined,
      tool_choice: undefined,
      stream: supportsLiveStream,
      conversation_id: conversationId,
    }),
  });
  if (!response.ok) {
    const detail = await gatewayErrorMessage(response);
    const requestId = response.headers.get("x-request-id");
    // One plain string: browsers' extension error panels render extra
    // console.error arguments as "[object Object]".
    console.error(
      `[catgpt-gateway] chat completion failed (${response.status}): ${detail}` +
        (requestId ? ` [request ${requestId}]` : ""),
    );
    return response;
  }
  if (
    supportsLiveStream &&
    response.headers.get("content-type")?.includes("text/event-stream")
  ) {
    return response;
  }
  const json = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  } | null;
  if (json === null || !Array.isArray(json.choices)) {
    // A 200 with an unparseable/shape-less body (proxy returning HTML, a
    // truncated response) used to surface as a silent EMPTY assistant
    // bubble. Turn it into an error the SDK and chat can show.
    return new Response(
      JSON.stringify({
        error: { message: "Gateway returned an invalid response body." },
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
  const content = extractMessageText(json.choices?.[0]?.message?.content);

  const completion = {
    id: "chatcmpl-gateway",
    object: "chat.completion",
    created: 0,
    model: model ?? "catgpt-browser",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };

  if (!wantsStream) {
    return new Response(JSON.stringify(completion), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(chatCompletionToSse(completion), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/**
 * Provider for a locally-running CatGPT-Gateway
 * (github.com/GautamVhavle/CatGPT-Gateway), which exposes the user's ChatGPT
 * web session as an OpenAI-compatible API. The gateway ignores the API key.
 */
export function createCatGptGatewayProvider(routingId?: string) {
  return createOpenAICompatible({
    name: "catgpt-gateway",
    baseURL: CATGPT_GATEWAY_URL,
    apiKey: CATGPT_GATEWAY_TOKEN,
    fetch: (input, init) => catgptGatewayFetch(input, init, routingId),
  });
}

/**
 * Thinking level requested for Gemini gateway models. Without an explicit
 * reasoning_effort the proxy leaves thinkingConfig unset and Gemini 3.x
 * occasionally leaks its thinking into the visible text channel (prefixed
 * with a raw "待94>thought" delimiter). With it, thoughts arrive cleanly as
 * reasoning_content deltas, which the UI routes into the activity rail.
 */
const GEMINI_REASONING_EFFORT = "low";

/**
 * Inject reasoning_effort into Gemini chat-completion bodies. Grok models
 * share this provider (same CLIProxyAPI endpoint) and must stay untouched.
 */
export async function geminiGatewayFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const body = init?.body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (
        typeof parsed.model === "string" &&
        parsed.model.startsWith("gemini") &&
        parsed.reasoning_effort === undefined
      ) {
        parsed.reasoning_effort = GEMINI_REASONING_EFFORT;
        return fetch(input, { ...init, body: JSON.stringify(parsed) });
      }
    } catch {
      // Non-JSON body — pass through untouched.
    }
  }
  return fetch(input, init);
}

/**
 * Provider for the local CLIProxyAPI instance (:8317), which serves Gemini
 * (Antigravity OAuth), Grok (Grok Build OAuth) and Claude (Claude Code OAuth)
 * as one OpenAI-compatible endpoint. The api key must match one of the proxy
 * config's `api-keys`; geminiGatewayFetch only rewrites gemini-prefixed bodies,
 * so Grok and Claude requests pass through untouched.
 */
export function createGeminiGatewayProvider() {
  return createOpenAICompatible({
    name: "gemini-gateway",
    baseURL: GEMINI_GATEWAY_URL,
    apiKey: "eterna",
    fetch: geminiGatewayFetch,
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
