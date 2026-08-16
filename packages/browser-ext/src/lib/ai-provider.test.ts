import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claudeNativeFetch,
  cliProxyFetch,
  createAIProvider,
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

describe("cliProxyFetch model + reasoning_effort rewriting", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const send = async (body: unknown) =>
    cliProxyFetch("http://localhost:8317/v1/chat/completions", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  const lastRequestBody = () => {
    const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    return JSON.parse((call?.[1] as RequestInit).body as string);
  };

  it("splits the picker's selection into model + reasoning_effort", async () => {
    await send({ model: "gpt-5.6-luna::max", messages: [] });
    expect(lastRequestBody().model).toBe("gpt-5.6-luna");
    expect(lastRequestBody().reasoning_effort).toBe("max");
  });

  it("applies each model's default when no level was chosen", async () => {
    await send({ model: "gemini-3.1-pro-low", messages: [] });
    expect(lastRequestBody().reasoning_effort).toBe("low");

    await send({ model: "claude-opus-5", messages: [] });
    expect(lastRequestBody().reasoning_effort).toBe("medium");
  });

  it("drops a level the model would reject rather than forwarding it", async () => {
    // The proxy 400s on an unsupported level; gpt-5.5 stops at xhigh.
    await send({ model: "gpt-5.5::max", messages: [] });
    expect(lastRequestBody().model).toBe("gpt-5.5");
    expect(lastRequestBody().reasoning_effort).toBe("medium");
  });

  it("sends no effort for a model that does not reason", async () => {
    await send({ model: "grok-composer-2.5-fast", messages: [] });
    expect(lastRequestBody().model).toBe("grok-composer-2.5-fast");
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

describe("claudeNativeFetch thinking injection", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const send = async (body: unknown) =>
    claudeNativeFetch("http://localhost:8317/v1/messages", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  const lastRequestBody = () => {
    const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    return JSON.parse((call?.[1] as RequestInit).body as string);
  };

  it("maps the picker level onto an Anthropic thinking budget", async () => {
    await send({ model: "claude-opus-5::max", messages: [], max_tokens: 4096 });
    const body = lastRequestBody();
    expect(body.model).toBe("claude-opus-5");
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 49152 });
    // max_tokens must exceed the budget, with answer headroom.
    expect(body.max_tokens).toBeGreaterThan(49152);
  });

  it("injects the Anthropic server-side web_search tool", async () => {
    await send({
      model: "claude-sonnet-5",
      messages: [],
      tools: [{ name: "click", input_schema: {} }],
    });
    const body = lastRequestBody();
    expect(body.tools).toContainEqual({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 5,
    });
    expect(body.tools).toHaveLength(2);
  });

  it("does not duplicate an existing web_search tool", async () => {
    await send({
      model: "claude-sonnet-5",
      messages: [],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });
    expect(lastRequestBody().tools).toHaveLength(1);
  });

  it("applies the default level when no suffix was chosen", async () => {
    await send({ model: "claude-sonnet-5", messages: [] });
    const body = lastRequestBody();
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
    expect(body.max_tokens).toBeGreaterThanOrEqual(16000);
  });

  it("strips sampling params thinking forbids", async () => {
    await send({
      model: "claude-opus-5::low",
      messages: [],
      temperature: 0.2,
      top_p: 0.9,
      top_k: 40,
    });
    const body = lastRequestBody();
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.top_k).toBeUndefined();
  });

  it("keeps a caller-provided thinking block and larger max_tokens", async () => {
    await send({
      model: "claude-opus-5::max",
      messages: [],
      max_tokens: 100000,
      thinking: { type: "enabled", budget_tokens: 1024 },
    });
    const body = lastRequestBody();
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
    expect(body.max_tokens).toBe(100000);
  });

  it("passes non-JSON bodies through unchanged", async () => {
    await send("not json");
    const call = fetchMock.mock.calls[0];
    expect((call?.[1] as RequestInit).body).toBe("not json");
  });
});
