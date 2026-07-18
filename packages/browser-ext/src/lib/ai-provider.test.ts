import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  catgptGatewayFetch,
  createAIProvider,
  createEmptyToolArgsFinalizer,
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

function sseLinesToStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = `${lines.join("\n")}\n`;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

async function readStreamLines(
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

describe("createEmptyToolArgsFinalizer", () => {
  it("should inject {} for parameterless tools when finish_reason is tool_calls", async () => {
    const sseLines = [
      `data: {"id":"gen-1","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_current_tab","arguments":""}}]},"finish_reason":null}]}`,
      `data: {"id":"gen-1","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"function":{"arguments":""}}]},"finish_reason":null}]}`,
      `data: {"id":"gen-1","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"function":{"arguments":""}}]},"finish_reason":null}]}`,
      `data: {"id":"gen-1","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":"","role":"assistant"},"finish_reason":"tool_calls"}]}`,
      `data: [DONE]`,
    ];

    const input = sseLinesToStream(sseLines);
    const output = createEmptyToolArgsFinalizer(input);
    const outputLines = await readStreamLines(output);

    const dataLines = outputLines.filter(
      (l) => l.startsWith("data: ") && l !== "data: [DONE]",
    );

    // Should have 5 data lines: 3 original + 1 synthetic + 1 finish
    expect(dataLines.length).toBe(5);

    // The synthetic line should be right before the finish line
    const syntheticLine = dataLines[3]!;
    const syntheticData = JSON.parse(syntheticLine.slice(6));
    expect(syntheticData.choices[0].delta.tool_calls[0].index).toBe(0);
    expect(
      syntheticData.choices[0].delta.tool_calls[0].function.arguments,
    ).toBe("{}");

    // The finish line should still be present and unchanged
    const finishLine = dataLines[4]!;
    const finishData = JSON.parse(finishLine.slice(6));
    expect(finishData.choices[0].finish_reason).toBe("tool_calls");
  });

  it("should NOT inject {} for tools that have real arguments", async () => {
    const sseLines = [
      `data: {"id":"gen-2","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search_elements","arguments":""}}]},"finish_reason":null}]}`,
      `data: {"id":"gen-2","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"function":{"arguments":""}}]},"finish_reason":null}]}`,
      `data: {"id":"gen-2","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"function":{"arguments":"{\\"tabId\\": "}}]},"finish_reason":null}]}`,
      `data: {"id":"gen-2","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"function":{"arguments":"127183"}}]},"finish_reason":null}]}`,
      `data: {"id":"gen-2","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"function":{"arguments":"9286"}}]},"finish_reason":null}]}`,
      `data: {"id":"gen-2","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"function":{"arguments":", \\"query\\""}}]},"finish_reason":null}]}`,
      `data: {"id":"gen-2","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"function":{"arguments":": \\"button*\\""}}]},"finish_reason":null}]}`,
      `data: {"id":"gen-2","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"function":{"arguments":", \\"contextLevels\\": 1}"}}]},"finish_reason":null}]}`,
      `data: {"id":"gen-2","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":"","role":"assistant"},"finish_reason":"tool_calls"}]}`,
      `data: [DONE]`,
    ];

    const input = sseLinesToStream(sseLines);
    const output = createEmptyToolArgsFinalizer(input);
    const outputLines = await readStreamLines(output);

    const dataLines = outputLines.filter(
      (l) => l.startsWith("data: ") && l !== "data: [DONE]",
    );

    // No synthetic line should be injected -- same count as input data lines
    expect(dataLines.length).toBe(9);

    // All lines should pass through unchanged
    for (let i = 0; i < sseLines.length - 1; i++) {
      // Skip "data: [DONE]" comparison
      if (sseLines[i] === "data: [DONE]") continue;
      expect(outputLines[i]).toBe(sseLines[i]);
    }
  });

  it("should handle multiple parameterless tools in a single response", async () => {
    const sseLines = [
      `data: {"id":"gen-3","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_current_tab","arguments":""}}]},"finish_reason":null}]}`,
      `data: {"id":"gen-3","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"function":{"arguments":""}}]},"finish_reason":null}]}`,
      `data: {"id":"gen-3","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"function":{"arguments":""}}]},"finish_reason":null}]}`,
      `data: {"id":"gen-3","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":1,"id":"call_2","type":"function","function":{"name":"get_all_tabs","arguments":""}}]},"finish_reason":null}]}`,
      `data: {"id":"gen-3","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":1,"function":{"arguments":""}}]},"finish_reason":null}]}`,
      `data: {"id":"gen-3","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":1,"function":{"arguments":""}}]},"finish_reason":null}]}`,
      `data: {"id":"gen-3","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":"","role":"assistant"},"finish_reason":"tool_calls"}]}`,
      `data: [DONE]`,
    ];

    const input = sseLinesToStream(sseLines);
    const output = createEmptyToolArgsFinalizer(input);
    const outputLines = await readStreamLines(output);

    const dataLines = outputLines.filter(
      (l) => l.startsWith("data: ") && l !== "data: [DONE]",
    );

    // 7 original data lines + 2 synthetic (one per tool) = 9
    expect(dataLines.length).toBe(9);

    // The two synthetic lines should be injected before the finish chunk
    // Find synthetic lines (they have function.arguments === "{}")
    const syntheticLines = dataLines.filter((line) => {
      const data = JSON.parse(line.slice(6));
      const tc = data.choices?.[0]?.delta?.tool_calls?.[0];
      return tc?.function?.arguments === "{}";
    });
    expect(syntheticLines.length).toBe(2);

    const syntheticIndices = syntheticLines.map((line) => {
      const data = JSON.parse(line.slice(6));
      return data.choices[0].delta.tool_calls[0].index;
    });
    expect(syntheticIndices).toContain(0);
    expect(syntheticIndices).toContain(1);

    // Finish line should be the very last data line
    const lastDataLine = dataLines[dataLines.length - 1]!;
    const lastData = JSON.parse(lastDataLine.slice(6));
    expect(lastData.choices[0].finish_reason).toBe("tool_calls");
  });

  it("should pass through non-tool-call streams unchanged", async () => {
    const sseLines = [
      `data: {"id":"gen-4","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":"Hello","role":"assistant"},"finish_reason":null}]}`,
      `data: {"id":"gen-4","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":"stop"}]}`,
      `data: [DONE]`,
    ];

    const input = sseLinesToStream(sseLines);
    const output = createEmptyToolArgsFinalizer(input);
    const outputLines = await readStreamLines(output);

    expect(outputLines).toEqual(sseLines);
  });

  it("should work with exact real-world SSE data (double-newline separators, get_all_tabs)", async () => {
    // Exact SSE data from the user's bug report, using real \n\n SSE separators
    const rawSSE =
      `data: {"id":"gen-1772969079-EhEx5DeV7JqM43lpl47Y","object":"chat.completion.chunk","created":1772969079,"model":"anthropic/claude-4.5-haiku-20251001","provider":"Amazon Bedrock","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"id":"toolu_bdrk_01AMXFNuQYF6fxS1hryPtu9K","type":"function","function":{"name":"get_all_tabs","arguments":""}}]},"finish_reason":null,"native_finish_reason":null}]}\n` +
      `\n` +
      `data: {"id":"gen-1772969079-EhEx5DeV7JqM43lpl47Y","object":"chat.completion.chunk","created":1772969079,"model":"anthropic/claude-4.5-haiku-20251001","provider":"Amazon Bedrock","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"function":{"arguments":""}}]},"finish_reason":null,"native_finish_reason":null}]}\n` +
      `\n` +
      `data: {"id":"gen-1772969079-EhEx5DeV7JqM43lpl47Y","object":"chat.completion.chunk","created":1772969079,"model":"anthropic/claude-4.5-haiku-20251001","provider":"Amazon Bedrock","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"function":{"arguments":""}}]},"finish_reason":null,"native_finish_reason":null}]}\n` +
      `\n` +
      `data: {"id":"gen-1772969079-EhEx5DeV7JqM43lpl47Y","object":"chat.completion.chunk","created":1772969079,"model":"anthropic/claude-4.5-haiku-20251001","provider":"Amazon Bedrock","choices":[{"index":0,"delta":{"content":"","role":"assistant"},"finish_reason":"tool_calls","native_finish_reason":"tool_calls"}]}\n` +
      `\n` +
      `data: {"id":"gen-1772969079-EhEx5DeV7JqM43lpl47Y","object":"chat.completion.chunk","created":1772969079,"model":"anthropic/claude-4.5-haiku-20251001","provider":"Amazon Bedrock","choices":[],"usage":{"prompt_tokens":25105,"completion_tokens":55,"total_tokens":25160}}\n` +
      `\n` +
      `data: [DONE]\n`;

    const encoder = new TextEncoder();
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(rawSSE));
        controller.close();
      },
    });

    const output = createEmptyToolArgsFinalizer(input);
    const outputLines = await readStreamLines(output);

    const dataLines = outputLines.filter(
      (l) => l.startsWith("data: ") && l !== "data: [DONE]",
    );

    // Find the synthetic line with arguments "{}"
    const syntheticLines = dataLines.filter((line) => {
      try {
        const data = JSON.parse(line.slice(6));
        const tc = data.choices?.[0]?.delta?.tool_calls?.[0];
        return tc?.function?.arguments === "{}";
      } catch {
        return false;
      }
    });

    expect(syntheticLines.length).toBe(1);

    const syntheticData = JSON.parse(syntheticLines[0]!.slice(6));
    expect(syntheticData.choices[0].delta.tool_calls[0].index).toBe(0);
    expect(
      syntheticData.choices[0].delta.tool_calls[0].function.arguments,
    ).toBe("{}");

    // The finish line should still be present
    const finishLines = dataLines.filter((line) => {
      try {
        const data = JSON.parse(line.slice(6));
        return data.choices?.[0]?.finish_reason === "tool_calls";
      } catch {
        return false;
      }
    });
    expect(finishLines.length).toBe(1);
  });

  it("should produce valid individually-parseable SSE events (no event boundary merging)", async () => {
    // Regression test: synthetic chunks must be terminated by a blank line so that
    // EventSourceParserStream treats them as separate events from the finish chunk.
    // Without the fix, synthetic + finish were emitted as consecutive data: lines in one
    // event, producing "{synthetic_json}\n{finish_json}" which is not valid JSON.
    const rawSSE =
      `data: {"id":"gen-1","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_all_tabs","arguments":""}}]},"finish_reason":null}]}\n` +
      `\n` +
      `data: {"id":"gen-1","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"function":{"arguments":""}}]},"finish_reason":null}]}\n` +
      `\n` +
      `data: {"id":"gen-1","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":"","role":"assistant"},"finish_reason":"tool_calls"}]}\n` +
      `\n` +
      `data: [DONE]\n`;

    const encoder = new TextEncoder();
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(rawSSE));
        controller.close();
      },
    });

    const output = createEmptyToolArgsFinalizer(input);

    // Read entire output as text and split into SSE events by double-newline,
    // matching how EventSourceParserStream works.
    const decoder = new TextDecoder();
    const reader = output.getReader();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }

    // Split by blank lines to get raw SSE events (same as EventSourceParserStream does)
    const rawEvents = text.split(/\n\n+/).filter((e) => e.trim().length > 0);
    const dataEvents = rawEvents
      .map((raw) => {
        const dataLines = raw
          .split("\n")
          .filter((l) => l.startsWith("data: "))
          .map((l) => l.slice(6));
        return dataLines.join("\n");
      })
      .filter((d) => d.length > 0 && d !== "[DONE]");

    // Should have: 2 original tool_call chunks + 1 synthetic + 1 finish = 4
    expect(dataEvents.length).toBe(4);

    // Every event must contain individually valid JSON (not two JSON objects merged)
    for (const eventData of dataEvents) {
      expect(
        () => JSON.parse(eventData),
        `Expected valid JSON but got: ${eventData}`,
      ).not.toThrow();
    }

    // The synthetic event must be its own event with arguments: "{}"
    const syntheticIdx = dataEvents.findIndex((d) => {
      const parsed = JSON.parse(d);
      return (
        parsed.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments ===
        "{}"
      );
    });
    expect(syntheticIdx).toBeGreaterThanOrEqual(0);
    expect(
      JSON.parse(dataEvents[syntheticIdx]!).choices[0].finish_reason,
    ).toBeNull();

    // The finish event must be a separate event after the synthetic one
    const finishIdx = dataEvents.findIndex((d) => {
      const parsed = JSON.parse(d);
      return parsed.choices?.[0]?.finish_reason === "tool_calls";
    });
    expect(finishIdx).toBeGreaterThan(syntheticIdx);
  });

  it("should work with chunked delivery (data arriving in small pieces)", async () => {
    const rawSSE =
      `data: {"id":"gen-c","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"id":"call_c1","type":"function","function":{"name":"get_all_tabs","arguments":""}}]},"finish_reason":null}]}\n` +
      `\n` +
      `data: {"id":"gen-c","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":null,"role":"assistant","tool_calls":[{"index":0,"function":{"arguments":""}}]},"finish_reason":null}]}\n` +
      `\n` +
      `data: {"id":"gen-c","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":"","role":"assistant"},"finish_reason":"tool_calls"}]}\n` +
      `\n` +
      `data: [DONE]\n`;

    const encoder = new TextEncoder();
    const bytes = encoder.encode(rawSSE);

    // Deliver in chunks of 37 bytes (deliberately awkward size to split mid-line)
    const chunkSize = 37;
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunkSize) {
          controller.enqueue(
            bytes.slice(i, Math.min(i + chunkSize, bytes.length)),
          );
        }
        controller.close();
      },
    });

    const output = createEmptyToolArgsFinalizer(input);
    const outputLines = await readStreamLines(output);

    const dataLines = outputLines.filter(
      (l) => l.startsWith("data: ") && l !== "data: [DONE]",
    );

    // Find synthetic line
    const syntheticLines = dataLines.filter((line) => {
      try {
        const data = JSON.parse(line.slice(6));
        const tc = data.choices?.[0]?.delta?.tool_calls?.[0];
        return tc?.function?.arguments === "{}";
      } catch {
        return false;
      }
    });

    expect(syntheticLines.length).toBe(1);

    // Finish line must still be present
    const finishLines = dataLines.filter((line) => {
      try {
        const data = JSON.parse(line.slice(6));
        return data.choices?.[0]?.finish_reason === "tool_calls";
      } catch {
        return false;
      }
    });
    expect(finishLines.length).toBe(1);
  });
});

describe("supportsParallelSubagents", () => {
  it("is true for gemini, grok, claude and codex models", () => {
    expect(supportsParallelSubagents("gemini-3.1-pro-low")).toBe(true);
    expect(supportsParallelSubagents("grok-4.3")).toBe(true);
    expect(supportsParallelSubagents("claude-opus-4-8")).toBe(true);
    expect(supportsParallelSubagents("gpt-5.5")).toBe(true);
  });

  it("is false for the single-session web gateways", () => {
    expect(supportsParallelSubagents("catgpt-browser::GPT-5.5")).toBe(false);
    expect(supportsParallelSubagents("claude-browser::Opus 4.8|High")).toBe(
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

  const send = async (body: Record<string, unknown>) =>
    catgptGatewayFetch("http://ignored", {
      method: "POST",
      body: JSON.stringify(body),
    });

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
    expect(body.stream).toBe(false);
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
      model: "claude-browser::Opus 4.8|High",
      messages: [userMsg("claude'a git")],
    });

    expect(lastRequestUrl()).toBe("http://localhost:8001/v1/chat/completions");
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

  const send = async (body: Record<string, unknown>) =>
    catgptGatewayFetch("http://ignored", {
      method: "POST",
      body: JSON.stringify(body),
    });

  it("pings /thread/reset on the right gateway for gateway models only", () => {
    startFreshGatewayThread("claude-browser::Opus 4.8|High");
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
    const conversation = [
      { role: "user", content: "ilk mesaj" },
      { role: "assistant", content: "cevap" },
      { role: "user", content: "devam" },
    ];

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
});
