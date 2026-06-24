/**
 * AI Provider Factory
 * Creates AI SDK provider instances based on configuration.
 *
 * Supports two modes:
 * 1. BYOK (Bring Your Own Key) – user provides their own API key and model.
 * 2. Proxy mode – uses https://www.claudechrome.com/api/ai/chat with
 *    cookie-based auth (better-auth / session cookies).
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AIProviderKey, AppSettings } from "@aipexstudio/aipex-core";
import { WEBSITE_URL } from "../config/website";
import { getValidAccessToken } from "../services/chatgpt-auth";

export interface ProviderConfig {
  provider: AIProviderKey;
  apiKey: string;
  baseURL?: string;
}

/** Default model used when the user has not configured BYOK. */
export const PROXY_DEFAULT_MODEL = "deepseek/deepseek-chat-v3.1";

/** Proxy API endpoint for non-BYOK users. */
export const PROXY_API_URL = `${WEBSITE_URL}/api/ai`;

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
 * Retrieve authentication cookies from claudechrome.com for the proxy API.
 * Returns a Cookie header string, or empty string if unavailable.
 */
export async function getProxyCookieHeader(): Promise<string> {
  try {
    const cookies = await chrome.cookies.getAll({ url: WEBSITE_URL });
    const relevant = cookies.filter(
      (c) => c.name.includes("better-auth") || c.name.includes("session"),
    );
    return relevant.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return "";
  }
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

/**
 * Stateful SSE stream transform that fixes parameterless tool calls from
 * providers like Anthropic via OpenRouter/proxy.
 *
 * Some providers stream tool_calls with `"arguments":""` for every chunk when
 * the tool has no parameters. The AI SDK uses `isParsableJson` to decide when
 * a tool call is complete, and `""` never passes that check, so the tool call
 * is silently dropped.
 *
 * A naive text-replacement of `""` → `"{}"` on every chunk would break tools
 * that DO have arguments (the first empty chunk would be treated as complete
 * `{}`, and all subsequent real-argument chunks would be discarded).
 *
 * This transform tracks tool call state across the stream:
 * - Passes all SSE lines through **unchanged** during streaming
 * - When `finish_reason: "tool_calls"` arrives, injects a synthetic SSE chunk
 *   with `"arguments":"{}"` for every tool call whose accumulated arguments
 *   are still empty — right before the finish chunk
 */
export function createEmptyToolArgsFinalizer(
  original: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  // Track accumulated arguments per tool call index
  const toolCallArgs = new Map<
    number,
    { id: string; name: string; args: string }
  >();
  // Capture the chunk id so synthetic events look like they belong to the same response
  let streamId: string | undefined;

  function processLine(
    line: string,
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") {
      controller.enqueue(encoder.encode(`${line}\n`));
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(line.slice(6));
    } catch {
      controller.enqueue(encoder.encode(`${line}\n`));
      return;
    }

    if (!streamId && parsed.id) {
      streamId = parsed.id;
    }

    const choice = parsed.choices?.[0];

    // Track tool call arguments
    const toolCalls = choice?.delta?.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const idx = tc.index;
        if (typeof idx !== "number") continue;

        const existing = toolCallArgs.get(idx);
        if (!existing) {
          toolCallArgs.set(idx, {
            id: tc.id ?? "",
            name: tc.function?.name ?? "",
            args: tc.function?.arguments ?? "",
          });
        } else {
          if (tc.function?.arguments != null) {
            existing.args += tc.function.arguments;
          }
        }
      }
    }

    // When finish_reason is tool_calls, inject synthetic chunks for empty args
    if (choice?.finish_reason === "tool_calls") {
      for (const [idx, tc] of toolCallArgs) {
        if (tc.args === "") {
          const synthetic = {
            id: streamId ?? parsed.id ?? "",
            object: "chat.completion.chunk",
            created: parsed.created ?? 0,
            model: parsed.model ?? "",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: idx,
                      function: { arguments: "{}" },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(synthetic)}\n\n`),
          );
        }
      }
    }

    controller.enqueue(encoder.encode(`${line}\n`));
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = original.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.length > 0) {
              processLine(buffer, controller);
            }
            controller.close();
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          for (const line of lines) {
            processLine(line, controller);
          }
        }
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

/**
 * Create an AI SDK provider for proxy mode (non-BYOK).
 *
 * Uses the claudechrome.com proxy endpoint which accepts OpenAI-compatible
 * requests and authenticates via session cookies.
 */
export function createProxyProvider(): OpenAIProvider["chat"] {
  const openai = createOpenAI({
    apiKey: "proxy-no-key",
    baseURL: PROXY_API_URL,
    fetch: async (input, init) => {
      const cookieHeader = await getProxyCookieHeader();
      const headers = new Headers(init?.headers);
      if (cookieHeader) {
        headers.set("Cookie", cookieHeader);
      }
      headers.delete("Authorization");
      const response = await globalThis.fetch(input, { ...init, headers });

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream") && response.body) {
        const patched = createEmptyToolArgsFinalizer(response.body);
        return new Response(patched, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }

      return response;
    },
  });

  return openai.chat;
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
  // Sub-models are encoded as "<base>::<label>", e.g. "claude-browser::Opus 4.8|High".
  const base = model?.split("::")[0];
  return !!base && (CATGPT_GATEWAY_MODELS as readonly string[]).includes(base);
}

/**
 * Gemini via a local CLIProxyAPI instance (OAuth, backed by the user's Google
 * account / AI Pro subscription). Unlike the ChatGPT/Claude web gateways this
 * is a genuine OpenAI-compatible endpoint — full messages, tools and streaming
 * are kept. The api key must match one of the proxy config's `api-keys`.
 */
const GEMINI_GATEWAY_URL = "http://localhost:8317/v1";

export const GEMINI_GATEWAY_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3-pro-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
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
 * Whether a model can fan out into concurrent background subagents.
 *
 * Only true for real API/OAuth endpoints that accept parallel requests:
 * Gemini and Grok (CLIProxyAPI :8317) and Codex/ChatGPT (OAuth Responses
 * API). The web gateways (catgpt-browser, claude-browser) drive a single
 * shared web-UI thread and cannot run requests in parallel, so subagent
 * orchestration is disabled there.
 */
export function supportsParallelSubagents(model: string | undefined): boolean {
  return (
    isGeminiGatewayModel(model) ||
    isXaiGatewayModel(model) ||
    isChatGptModel(model)
  );
}

/**
 * The gateway only supports non-streaming requests, but the chat UI streams.
 * Convert one non-streaming chat completion into the SSE chunk format the AI
 * SDK expects (single content delta + finish), preserving any tool calls.
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

/**
 * Conversation identity for gateway thread routing. Module state lives per
 * sidebar instance (each tab's iframe is its own JS context), so parallel
 * sidebars automatically get distinct conversations on the gateway. A new id
 * is minted when the outgoing request has no assistant turn yet (a fresh
 * AIPex chat — covers the New Chat button and a freshly opened sidebar) or
 * when the history's first user message changes (the user switched to a
 * different stored conversation in the same sidebar).
 */
let gatewayConversationId: string | null = null;
let gatewayConversationFirstUserText: string | null = null;

/**
 * Eager reset for the user's New Chat click: forget the current conversation
 * identity (the next send mints a fresh one) and, for gateway models, have
 * the gateway open the web UI's own new chat right away — so the reset is
 * visible immediately and the next message pays no new-chat latency.
 */
export function startFreshGatewayThread(model: string | undefined): void {
  gatewayConversationId = null;
  gatewayConversationFirstUserText = null;
  if (!isCatGptGatewayModel(model)) {
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
 * Minting is keyed on (null id | changed first-user-text) ONLY — deliberately
 * NOT on "no assistant turn yet": the AI SDK retries failed requests through
 * this fetch, and minting per attempt opened a fresh web thread for every
 * retry of a conversation's first message. New Chat resets the id explicitly
 * via startFreshGatewayThread, so a retry reuses the same conversation.
 */
function resolveGatewayConversationId(firstUserText: string): string {
  if (
    gatewayConversationId === null ||
    firstUserText !== gatewayConversationFirstUserText
  ) {
    gatewayConversationId = crypto.randomUUID();
    gatewayConversationFirstUserText = firstUserText;
  }
  return gatewayConversationId;
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
      firstUserText = extractMessageText(firstUser?.content).slice(0, 200);
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
  const conversationId = resolveGatewayConversationId(firstUserText);

  const response = await globalThis.fetch(`${origin}/v1/chat/completions`, {
    ...init,
    body: JSON.stringify({
      ...parsedBody,
      messages: lastUserMessage
        ? [lastUserMessage]
        : [{ role: "user", content: "(empty message)" }],
      tools: undefined,
      tool_choice: undefined,
      stream: false,
      conversation_id: conversationId,
    }),
  });
  if (!response.ok) {
    const detail = await response
      .clone()
      .text()
      .catch(() => "");
    console.error(
      `[catgpt-gateway] chat completion failed: ${response.status}`,
      detail,
    );
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
export function createCatGptGatewayProvider() {
  return createOpenAICompatible({
    name: "catgpt-gateway",
    baseURL: CATGPT_GATEWAY_URL,
    apiKey: CATGPT_GATEWAY_TOKEN,
    fetch: catgptGatewayFetch,
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
 * Provider for Gemini through the local gemini-cli OAuth proxy. The proxy
 * ignores the API key (any placeholder works) and authenticates to Google
 * using the cached gemini-cli OAuth credentials (the user's Google account).
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
    const detail = await response
      .clone()
      .text()
      .catch(() => "");
    console.error(
      `[codex] request failed: ${response.status} ${response.statusText}`,
      "\n--- request body ---\n",
      typeof body === "string" ? body : "(non-string body)",
      "\n--- response ---\n",
      detail,
    );
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
