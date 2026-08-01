import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  catgptGatewayFetch,
  createAIProvider,
  geminiGatewayFetch,
  startFreshGatewayThread,
  supportsParallelSubagents,
} from "./ai-provider";

// Provide minimal mock for import.meta.env
vi.stubGlobal("import", { meta: { env: { PROD: false } } });

describe("createAIProvider", () => {
  describe("URL validation", () => {
    it("accepts valid https URLs", () => {
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          aiHost: "https://api.openai.com/v1",
        }),
      ).not.toThrow();
    });

    it("accepts undefined aiHost", () => {
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
        }),
      ).not.toThrow();
    });

    it("accepts empty string aiHost", () => {
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          aiHost: "",
        }),
      ).not.toThrow();
    });

    it("rejects invalid URLs", () => {
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          aiHost: "not-a-url",
        }),
      ).toThrow("Invalid aiHost URL");
    });

    it("rejects non-http protocols", () => {
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          aiHost: "ftp://evil.com",
        }),
      ).toThrow("Unsupported protocol");
    });

    it("rejects javascript: protocol", () => {
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          // eslint-disable-next-line no-script-url
          aiHost: "javascript:alert(1)",
        }),
      ).toThrow("Unsupported protocol");
    });
  });

  describe("provider creation", () => {
    it("creates openai provider by default", () => {
      const provider = createAIProvider({
        aiProvider: "openai",
        aiToken: "sk-test",
      });
      expect(provider).toBeDefined();
    });

    it("creates anthropic provider", () => {
      const provider = createAIProvider({
        aiProvider: "anthropic",
        aiToken: "sk-test",
      });
      expect(provider).toBeDefined();
    });

    it("creates google provider", () => {
      const provider = createAIProvider({
        aiProvider: "google",
        aiToken: "sk-test",
      });
      expect(provider).toBeDefined();
    });

    it("requires baseURL for custom providers", () => {
      expect(() =>
        createAIProvider({
          aiProvider: "custom" as any,
          aiToken: "sk-test",
        }),
      ).toThrow("requires aiHost");
    });

    it("creates custom provider with valid baseURL", () => {
      const provider = createAIProvider({
        aiProvider: "custom" as any,
        aiToken: "sk-test",
        aiHost: "https://my-proxy.example.com",
      });
      expect(provider).toBeDefined();
    });
  });
});

// --- SSE stream transform tests ---

function _sseLinesToStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = `${lines.join("\n")}\n`;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

async function _readStreamLines(
  stream: ReadableStream<Uint8Array>,
): Promise<string[]> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result.split("\n").filter((l) => l.length > 0);
}

describe("supportsParallelSubagents", () => {
  it("is true for gemini, grok, claude and codex models", () => {
    expect(supportsParallelSubagents("gemini-3.1-pro-low")).toBe(true);
    expect(supportsParallelSubagents("grok-4.3")).toBe(true);
    expect(supportsParallelSubagents("claude-opus-4-8")).toBe(true);
    expect(supportsParallelSubagents("gpt-5.5")).toBe(true);
  });

  it("is false for the single-session web gateways", () => {
    expect(supportsParallelSubagents("catgpt-browser::GPT-5.5")).toBe(false);
    expect(supportsParallelSubagents("claude-browser::Opus 5|High")).toBe(
      false,
    );
  });

  it("is false for unknown or undefined models", () => {
    expect(supportsParallelSubagents(undefined)).toBe(false);
    expect(supportsParallelSubagents("some-byok-model")).toBe(false);
  });
});

describe("geminiGatewayFetch reasoning_effort injection", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const send = async (body: unknown) =>
    geminiGatewayFetch("http://localhost:8317/v1/chat/completions", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  const lastRequestBody = () => {
    const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    return JSON.parse((call?.[1] as RequestInit).body as string);
  };

  it("injects reasoning_effort for gemini models", async () => {
    await send({ model: "gemini-3.1-pro-low", messages: [] });
    expect(lastRequestBody().reasoning_effort).toBe("low");
  });

  it("leaves grok models on the shared endpoint untouched", async () => {
    await send({ model: "grok-4.3", messages: [] });
    expect(lastRequestBody().reasoning_effort).toBeUndefined();
  });

  it("does not override an explicit reasoning_effort", async () => {
    await send({
      model: "gemini-3.1-pro-low",
      messages: [],
      reasoning_effort: "high",
    });
    expect(lastRequestBody().reasoning_effort).toBe("high");
  });

  it("passes non-JSON bodies through unchanged", async () => {
    await send("not json");
    const call = fetchMock.mock.calls[0];
    expect((call?.[1] as RequestInit).body).toBe("not json");
  });
});

describe("catgptGatewayFetch conversation routing", () => {
  const completionsResponse = () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => completionsResponse());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const userMsg = (text: string) => ({ role: "user", content: text });
  const assistantMsg = (text: string) => ({ role: "assistant", content: text });

  const send = async (body: Record<string, unknown>, routingId?: string) =>
    catgptGatewayFetch(
      "http://ignored",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      routingId,
    );

  const lastRequestBody = () => {
    const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    return JSON.parse((call?.[1] as RequestInit).body as string);
  };

  const lastRequestUrl = () => {
    const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    return String(call?.[0]);
  };

  let freshChatId: string;
  let secondChatId: string;

  it("sends a fresh chat as a new conversation with only the last user message", async () => {
    await send({
      model: "catgpt-browser::GPT-5.6 Sol|High",
      stream: true,
      tools: [{ type: "function" }],
      messages: [
        { role: "system", content: "big system prompt" },
        userMsg("merhaba"),
      ],
    });

    expect(lastRequestUrl()).toBe("http://localhost:8000/v1/chat/completions");
    const body = lastRequestBody();
    expect(body.model).toBe("catgpt-browser::GPT-5.6 Sol|High");
    expect(body.messages).toEqual([userMsg("merhaba")]);
    expect(body.stream).toBe(true);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(typeof body.conversation_id).toBe("string");
    freshChatId = body.conversation_id;
  });

  it("keeps the same conversation_id for a continuation of the same chat", async () => {
    await send({
      model: "catgpt-browser::GPT-5.5",
      messages: [
        { role: "system", content: "big system prompt" },
        userMsg("merhaba"),
        assistantMsg("selam!"),
        userMsg("devam edelim"),
      ],
    });

    const body = lastRequestBody();
    expect(body.conversation_id).toBe(freshChatId);
    expect(body.messages).toEqual([userMsg("devam edelim")]);
  });

  it("derives a stable conversation from the client route across prompts", async () => {
    await send(
      {
        model: "catgpt-browser::GPT-5.6 Sol|High",
        messages: [userMsg("first routed prompt")],
      },
      "sidebar-chat-route",
    );
    const firstId = lastRequestBody().conversation_id;

    await send(
      {
        model: "catgpt-browser::GPT-5.6 Sol|High",
        messages: [userMsg("follow-up with completely different text")],
      },
      "sidebar-chat-route",
    );
    expect(lastRequestBody().conversation_id).toBe(firstId);
    expect(firstId).toMatch(/^eterna-/);

    await send(
      {
        model: "catgpt-browser::GPT-5.6 Sol|High",
        messages: [userMsg("explicit New Chat")],
      },
      "new-sidebar-chat-route",
    );
    expect(lastRequestBody().conversation_id).not.toBe(firstId);
  });

  it("mints a new conversation_id when a new chat starts", async () => {
    await send({
      model: "catgpt-browser::GPT-5.5",
      messages: [
        { role: "system", content: "big system prompt" },
        userMsg("yepyeni sohbet"),
      ],
    });

    const body = lastRequestBody();
    expect(typeof body.conversation_id).toBe("string");
    expect(body.conversation_id).not.toBe(freshChatId);
    secondChatId = body.conversation_id;
  });

  it("mints a new conversation when the history fingerprint changes, still sending only the last user message", async () => {
    await send({
      model: "catgpt-browser::GPT-5.5",
      messages: [
        { role: "system", content: "big system prompt" },
        userMsg("eski sohbetin ilk mesajı"),
        assistantMsg("eski cevap"),
        userMsg("kaldığımız yerden devam"),
      ],
    });

    const body = lastRequestBody();
    expect(body.conversation_id).not.toBe(secondChatId);
    expect(body.messages).toEqual([userMsg("kaldığımız yerden devam")]);
  });

  it("reuses the same conversation when the SDK retries a first message", async () => {
    const freshBody = {
      model: "catgpt-browser::GPT-5.5",
      messages: [
        { role: "system", content: "big system prompt" },
        userMsg("retry edilecek mesaj"),
      ],
    };
    await send(freshBody);
    const firstId = lastRequestBody().conversation_id;

    // SDK retry re-invokes the fetch with the identical body — a second
    // thread must NOT be opened.
    await send(freshBody);
    expect(lastRequestBody().conversation_id).toBe(firstId);
  });

  it("routes claude-browser models to the Claude gateway port", async () => {
    await send({
      model: "claude-browser::Opus 5|High",
      messages: [userMsg("claude'a git")],
    });

    expect(lastRequestUrl()).toBe("http://localhost:8001/v1/chat/completions");
  });

  it("enables the live streaming path for Claude web text", async () => {
    const response = await send({
      model: "claude-browser::Opus 5|High",
      stream: true,
      messages: [userMsg("özetle")],
    });

    expect(lastRequestUrl()).toBe("http://localhost:8001/v1/chat/completions");
    expect(lastRequestBody().stream).toBe(true);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toContain('"content":"ok"');
  });

  it("logs the gateway error detail without consuming the response", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: "Live streaming is unavailable for this provider.",
        }),
        {
          status: 400,
          statusText: "Bad Request",
          headers: { "content-type": "application/json" },
        },
      ),
    );

    try {
      const response = await send({
        model: "claude-browser::Opus 5|High",
        messages: [userMsg("özetle")],
      });

      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining(
          "Live streaming is unavailable for this provider.",
        ),
      );
      await expect(response.json()).resolves.toEqual({
        detail: "Live streaming is unavailable for this provider.",
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps provider conversations isolated when requests alternate", async () => {
    const chatGptMessages = [
      userMsg("chatgpt sohbet kökü"),
      assistantMsg("ilk cevap"),
      userMsg("chatgpt devam"),
    ];
    await send({
      model: "catgpt-browser::GPT-5.6 Sol|High",
      messages: chatGptMessages,
    });
    const chatGptId = lastRequestBody().conversation_id;

    await send({
      model: "claude-browser::Opus 5|High",
      messages: [userMsg("claude sohbet kökü")],
    });
    expect(lastRequestBody().conversation_id).not.toBe(chatGptId);

    await send({
      model: "catgpt-browser::GPT-5.6 Sol|High",
      messages: [...chatGptMessages, assistantMsg("ikinci cevap")],
    });
    expect(lastRequestBody().conversation_id).toBe(chatGptId);
  });

  it("does not merge conversations whose first 200 characters match", async () => {
    const sharedPrefix = "x".repeat(200);
    await send({
      model: "catgpt-browser",
      messages: [userMsg(`${sharedPrefix}-bir`)],
    });
    const firstId = lastRequestBody().conversation_id;

    await send({
      model: "catgpt-browser",
      messages: [userMsg(`${sharedPrefix}-iki`)],
    });
    expect(lastRequestBody().conversation_id).not.toBe(firstId);
  });

  it("wraps the completion as SSE when the caller wants streaming", async () => {
    const response = await send({
      model: "catgpt-browser",
      stream: true,
      messages: [userMsg("stream isteği")],
    });

    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const text = await response.text();
    expect(text).toContain('"content":"ok"');
    expect(text).toContain("data: [DONE]");
  });

  it("passes a live gateway SSE response through without buffering it", async () => {
    const liveBody =
      'data: {"choices":[{"delta":{"content":"ilk"}}]}\n\n' +
      "data: [DONE]\n\n";
    fetchMock.mockResolvedValueOnce(
      new Response(liveBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const response = await send({
      model: "catgpt-browser::GPT-5.6 Sol|Instant",
      stream: true,
      messages: [userMsg("canlı stream")],
    });

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toBe(liveBody);
    expect(lastRequestBody().stream).toBe(true);
  });

  it("keeps attachment requests on the non-streaming compatibility path", async () => {
    await send({
      model: "catgpt-browser::GPT-5.6 Sol|Instant",
      stream: true,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "bu görsel ne?" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,AA==" },
            },
          ],
        },
      ],
    });

    expect(lastRequestBody().stream).toBe(false);
  });
});

describe("startFreshGatewayThread", () => {
  const completionsResponse = () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => completionsResponse());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const send = async (body: Record<string, unknown>, routingId?: string) =>
    catgptGatewayFetch(
      "http://ignored",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      routingId,
    );

  it("pings /thread/reset on the right gateway for gateway models only", () => {
    startFreshGatewayThread("claude-browser::Opus 5|High");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8001/thread/reset",
      expect.objectContaining({ method: "POST" }),
    );

    fetchMock.mockClear();
    startFreshGatewayThread("catgpt-browser::Thinking");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/thread/reset",
      expect.objectContaining({ method: "POST" }),
    );

    fetchMock.mockClear();
    startFreshGatewayThread("gpt-5.5");
    startFreshGatewayThread(undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forces a fresh conversation_id on the next send", async () => {
    const conversation = [{ role: "user", content: "ilk mesaj" }];

    await send({ model: "catgpt-browser", messages: conversation });
    const firstCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const firstId = JSON.parse(
      (firstCall?.[1] as RequestInit).body as string,
    ).conversation_id;

    startFreshGatewayThread("catgpt-browser");

    await send({ model: "catgpt-browser", messages: conversation });
    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const nextId = JSON.parse(
      (lastCall?.[1] as RequestInit).body as string,
    ).conversation_id;

    expect(typeof nextId).toBe("string");
    expect(nextId).not.toBe(firstId);
  });

  it("invalidates local identity without resetting the remote thread", async () => {
    const conversation = [{ role: "user", content: "aynı ilk mesaj" }];

    await send({ model: "catgpt-browser", messages: conversation });
    const firstId = JSON.parse(
      (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string,
    ).conversation_id;

    fetchMock.mockClear();
    startFreshGatewayThread("catgpt-browser", { resetRemote: false });
    expect(fetchMock).not.toHaveBeenCalled();

    await send({ model: "catgpt-browser", messages: conversation });
    const nextId = JSON.parse(
      (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string,
    ).conversation_id;
    expect(nextId).not.toBe(firstId);
  });

  it("preserves other prompt mappings when the next chat is forced fresh", async () => {
    const firstConversation = [
      { role: "user", content: "korunacak konuşma kökü" },
    ];
    const nextConversation = [{ role: "user", content: "yeni konuşma kökü" }];

    await send({
      model: "catgpt-browser",
      messages: firstConversation,
    });
    const firstId = JSON.parse(
      (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string,
    ).conversation_id;

    startFreshGatewayThread("catgpt-browser", { resetRemote: false });
    await send({
      model: "catgpt-browser",
      messages: nextConversation,
    });
    await send({
      model: "catgpt-browser",
      messages: firstConversation,
    });
    const restoredId = JSON.parse(
      (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string,
    ).conversation_id;

    expect(restoredId).toBe(firstId);
  });

  it("does not let an older multi-turn request consume the fresh-chat marker", async () => {
    const oldRoot = "aktif eski konuşma kökü";
    await send({
      model: "catgpt-browser",
      messages: [{ role: "user", content: oldRoot }],
    });
    const oldId = JSON.parse(
      (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string,
    ).conversation_id;

    startFreshGatewayThread("catgpt-browser", { resetRemote: false });
    await send({
      model: "catgpt-browser",
      messages: [
        { role: "user", content: oldRoot },
        { role: "assistant", content: "old answer" },
        { role: "user", content: "old follow-up" },
      ],
    });
    const oldFollowUpId = JSON.parse(
      (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string,
    ).conversation_id;
    expect(oldFollowUpId).toBe(oldId);

    await send({
      model: "catgpt-browser",
      messages: [{ role: "user", content: "fresh marker consumer" }],
    });
    await send({
      model: "catgpt-browser",
      messages: [{ role: "user", content: oldRoot }],
    });
    const restoredId = JSON.parse(
      (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string,
    ).conversation_id;
    expect(restoredId).toBe(oldId);
  });

  it("isolates identical first prompts with stable routing ids", async () => {
    const body = {
      model: "catgpt-browser",
      messages: [{ role: "user", content: "identical root" }],
    };

    await send(body, "route-a");
    const firstRouteId = JSON.parse(
      (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string,
    ).conversation_id;
    await send(body, "route-b");
    const secondRouteId = JSON.parse(
      (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string,
    ).conversation_id;
    await send(body, "route-a");
    const restoredFirstRouteId = JSON.parse(
      (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string,
    ).conversation_id;

    expect(secondRouteId).not.toBe(firstRouteId);
    expect(restoredFirstRouteId).toBe(firstRouteId);
  });

  it("does not reset the other web provider's conversations", async () => {
    const claudeConversation = [
      { role: "user", content: "claude kökü" },
      { role: "assistant", content: "cevap" },
      { role: "user", content: "devam" },
    ];

    await send({
      model: "claude-browser::Opus 5|High",
      messages: claudeConversation,
    });
    const claudeId = JSON.parse(
      (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string,
    ).conversation_id;

    startFreshGatewayThread("catgpt-browser::GPT-5.6 Sol|High");
    await send({
      model: "claude-browser::Opus 5|High",
      messages: claudeConversation,
    });

    expect(
      JSON.parse(
        (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string,
      ).conversation_id,
    ).toBe(claudeId);
  });
});
