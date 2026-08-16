import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, AiSdkModel } from "../types.js";
import { Eterna } from "./eterna.js";

vi.mock("@openai/agents", () => ({
  Agent: vi.fn(),
  run: vi.fn(),
}));

import type { StreamedRunResult } from "@openai/agents";
import { run } from "@openai/agents";

const mockModel = {} as AiSdkModel;

function createMockRunResult(
  overrides: {
    finalOutput?: string;
    usage?: { promptTokens?: number; completionTokens?: number };
    /** Multiple raw responses (for testing multi-turn within single execution) */
    rawResponses?: Array<{
      usage?: { inputTokens?: number; outputTokens?: number };
    }>;
    streamEvents?: any[];
  } = {},
): StreamedRunResult<unknown, any> {
  const events = overrides.streamEvents ?? [];

  // Build rawResponses: if explicit rawResponses provided, use it; otherwise use usage shorthand
  let rawResponses: Array<{
    usage?: { inputTokens?: number; outputTokens?: number };
  }> = [];
  if (overrides.rawResponses) {
    rawResponses = overrides.rawResponses;
  } else if (overrides.usage) {
    rawResponses = [
      {
        usage: {
          inputTokens: overrides.usage.promptTokens ?? 0,
          outputTokens: overrides.usage.completionTokens ?? 0,
        },
      },
    ];
  }

  return {
    finalOutput: overrides.finalOutput ?? "",
    rawResponses,
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  } as unknown as StreamedRunResult<unknown, any>;
}

describe("Eterna", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("reasoning passthrough", () => {
    it("should surface aisdk reasoning-delta parts as reasoning_delta events", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "The answer",
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: {
                type: "model",
                event: { type: "reasoning-delta", id: "r1", delta: "Hmm, " },
              },
            },
            {
              type: "raw_model_stream_event",
              data: {
                type: "model",
                event: {
                  type: "reasoning-delta",
                  id: "r1",
                  delta: "let me think",
                },
              },
            },
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "The answer" },
            },
          ],
        }),
      );

      const agent = Eterna.create({ instructions: "Test", model: mockModel });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("Hi")) {
        events.push(event);
      }

      const reasoningDeltas = events
        .filter((e) => e.type === "reasoning_delta")
        .map((e) => (e.type === "reasoning_delta" ? e.delta : ""));
      expect(reasoningDeltas).toEqual(["Hmm, ", "let me think"]);

      const contentIndex = events.findIndex((e) => e.type === "content_delta");
      const lastReasoningIndex = events.findLastIndex(
        (e) => e.type === "reasoning_delta",
      );
      expect(lastReasoningIndex).toBeLessThan(contentIndex);
    });

    it("should ignore empty reasoning-delta parts", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Hi",
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: {
                type: "model",
                event: { type: "reasoning-delta", id: "r1", delta: "" },
              },
            },
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Hi" },
            },
          ],
        }),
      );

      const agent = Eterna.create({ instructions: "Test", model: mockModel });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("Hi")) {
        events.push(event);
      }

      expect(events.some((e) => e.type === "reasoning_delta")).toBe(false);
    });
  });

  describe("leaked thought guard", () => {
    const leakedTurn =
      "待94>thought\nCRITICAL INSTRUCTION 1: Always use tools.\nI will load the skill first.";

    it("should reroute a marker-prefixed response into reasoning_delta", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: leakedTurn,
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "response_started" },
            },
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: leakedTurn },
            },
          ],
        }),
      );

      const agent = Eterna.create({ instructions: "Test", model: mockModel });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("Hi")) {
        events.push(event);
      }

      expect(events.some((e) => e.type === "content_delta")).toBe(false);
      const reasoningText = events
        .filter((e) => e.type === "reasoning_delta")
        .map((e) => (e.type === "reasoning_delta" ? e.delta : ""))
        .join("");
      // Marker line is stripped; the thought text itself is preserved.
      expect(reasoningText).toBe(
        "CRITICAL INSTRUCTION 1: Always use tools.\nI will load the skill first.",
      );

      // finalOutput must not fall back to the polluted runner output.
      const complete = events.find((e) => e.type === "execution_complete");
      if (complete?.type === "execution_complete") {
        expect(complete.finalOutput).toBe("");
      }
    });

    it("should handle the marker split across stream deltas", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "",
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "response_started" },
            },
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "待9" },
            },
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "4>tho" },
            },
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "ught\nThinking…" },
            },
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: " more thought" },
            },
          ],
        }),
      );

      const agent = Eterna.create({ instructions: "Test", model: mockModel });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("Hi")) {
        events.push(event);
      }

      expect(events.some((e) => e.type === "content_delta")).toBe(false);
      const reasoningText = events
        .filter((e) => e.type === "reasoning_delta")
        .map((e) => (e.type === "reasoning_delta" ? e.delta : ""))
        .join("");
      expect(reasoningText).toBe("Thinking… more thought");
    });

    it("should keep later clean responses as content and use them as finalOutput", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: `${leakedTurn}Here is the summary.`,
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "response_started" },
            },
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: leakedTurn },
            },
            {
              type: "raw_model_stream_event",
              data: { type: "response_started" },
            },
            {
              type: "raw_model_stream_event",
              data: {
                type: "output_text_delta",
                delta: "Here is the summary.",
              },
            },
          ],
        }),
      );

      const agent = Eterna.create({ instructions: "Test", model: mockModel });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("Hi")) {
        events.push(event);
      }

      const contentText = events
        .filter((e) => e.type === "content_delta")
        .map((e) => (e.type === "content_delta" ? e.delta : ""))
        .join("");
      expect(contentText).toBe("Here is the summary.");

      const complete = events.find((e) => e.type === "execution_complete");
      if (complete?.type === "execution_complete") {
        expect(complete.finalOutput).toBe("Here is the summary.");
      }
    });

    it("should flush short un-decidable text at response end", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Done.",
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "response_started" },
            },
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Done." },
            },
          ],
        }),
      );

      const agent = Eterna.create({ instructions: "Test", model: mockModel });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("Hi")) {
        events.push(event);
      }

      const contentText = events
        .filter((e) => e.type === "content_delta")
        .map((e) => (e.type === "content_delta" ? e.delta : ""))
        .join("");
      expect(contentText).toBe("Done.");
    });

    it("should not misclassify normal text that mentions thought", async () => {
      const normal = "I thought about it.\nHere is the plan.";
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: normal,
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "response_started" },
            },
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: normal },
            },
          ],
        }),
      );

      const agent = Eterna.create({ instructions: "Test", model: mockModel });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("Hi")) {
        events.push(event);
      }

      expect(events.some((e) => e.type === "reasoning_delta")).toBe(false);
      const contentText = events
        .filter((e) => e.type === "content_delta")
        .map((e) => (e.type === "content_delta" ? e.delta : ""))
        .join("");
      expect(contentText).toBe(normal);
    });
  });

  describe("tools and errors", () => {
    it("should emit tool_call_args_streaming_complete before tool_call_start", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "",
          streamEvents: [
            {
              type: "run_item_stream_event",
              name: "tool_called",
              item: { rawItem: { name: "calculator", arguments: '{"a":1}' } },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Tools",
        model: mockModel,
      });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("use tool")) {
        events.push(event);
      }

      const argsCompleteIndex = events.findIndex(
        (event) => event.type === "tool_call_args_streaming_complete",
      );
      const toolStartIndex = events.findIndex(
        (event) => event.type === "tool_call_start",
      );

      expect(argsCompleteIndex).toBeGreaterThanOrEqual(0);
      expect(toolStartIndex).toBeGreaterThanOrEqual(0);
      expect(argsCompleteIndex).toBeLessThan(toolStartIndex);

      const argsComplete = events[argsCompleteIndex];
      const toolStart = events[toolStartIndex];

      expect(argsComplete?.type).toBe("tool_call_args_streaming_complete");
      if (argsComplete?.type === "tool_call_args_streaming_complete") {
        expect(argsComplete.toolName).toBe("calculator");
        expect(argsComplete.params).toEqual({ a: 1 });
      }

      expect(toolStart?.type).toBe("tool_call_start");
      if (toolStart?.type === "tool_call_start") {
        expect(toolStart.toolName).toBe("calculator");
        expect(toolStart.params).toEqual({ a: 1 });
      }
    });

    it("should emit tool_call_args_streaming_start when tool args are streamed by the model", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "",
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: {
                type: "model",
                event: {
                  choices: [
                    {
                      delta: {
                        tool_calls: [
                          {
                            index: 0,
                            id: "call_1",
                            function: {
                              name: "calculator",
                              arguments: '{"a":',
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
            {
              type: "run_item_stream_event",
              name: "tool_called",
              item: { rawItem: { name: "calculator", arguments: '{"a":1}' } },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Tools",
        model: mockModel,
      });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("use tool")) {
        events.push(event);
      }

      const argsStart = events.find(
        (event) => event.type === "tool_call_args_streaming_start",
      );
      expect(argsStart).toBeDefined();
      if (argsStart?.type === "tool_call_args_streaming_start") {
        expect(argsStart.toolName).toBe("calculator");
      }
    });

    it("should default empty-string arguments to empty object", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "",
          streamEvents: [
            {
              type: "run_item_stream_event",
              name: "tool_called",
              item: { rawItem: { name: "screenshot", arguments: "" } },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Tools",
        model: mockModel,
      });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("take screenshot")) {
        events.push(event);
      }

      const toolStart = events.find(
        (event) => event.type === "tool_call_start",
      );
      expect(toolStart).toBeDefined();
      if (toolStart?.type === "tool_call_start") {
        expect(toolStart.toolName).toBe("screenshot");
        expect(toolStart.params).toEqual({});
      }

      const argsComplete = events.find(
        (event) => event.type === "tool_call_args_streaming_complete",
      );
      expect(argsComplete).toBeDefined();
      if (argsComplete?.type === "tool_call_args_streaming_complete") {
        expect(argsComplete.toolName).toBe("screenshot");
        expect(argsComplete.params).toEqual({});
      }
    });

    it("should emit tool lifecycle events", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "",
          streamEvents: [
            {
              type: "run_item_stream_event",
              name: "tool_called",
              item: { rawItem: { name: "calculator", arguments: '{"a":1}' } },
            },
            {
              type: "run_item_stream_event",
              name: "tool_output",
              item: {
                rawItem: { name: "calculator", status: "completed" },
                output: '{"result":2}',
              },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Tools",
        model: mockModel,
      });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("use tool")) {
        events.push(event);
      }

      const start = events.find((event) => event.type === "tool_call_start");
      const complete = events.find(
        (event) => event.type === "tool_call_complete",
      );
      expect(start).toBeDefined();
      expect(complete).toBeDefined();
      if (complete?.type === "tool_call_complete") {
        expect(complete.result).toEqual({ result: 2 });
      }
    });

    it("should emit error event when run fails", async () => {
      vi.mocked(run).mockRejectedValue(new Error("LLM failed"));

      const agent = Eterna.create({
        instructions: "Error",
        model: mockModel,
      });

      const events: AgentEvent[] = [];
      const runPromise = (async () => {
        for await (const event of agent.chat("boom")) {
          events.push(event);
        }
      })();

      await expect(runPromise).resolves.toBeUndefined();
      expect(events.some((event) => event.type === "error")).toBe(true);
    });

    it("should extract real error message from tool failure", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "",
          streamEvents: [
            {
              type: "run_item_stream_event",
              name: "tool_called",
              item: { rawItem: { name: "screenshot", arguments: "{}" } },
            },
            {
              type: "run_item_stream_event",
              name: "tool_output",
              item: {
                rawItem: {
                  name: "screenshot",
                  status: "failed",
                  error: { message: "No active tab found" },
                },
                output: undefined,
              },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Tools",
        model: mockModel,
      });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("take screenshot")) {
        events.push(event);
      }

      const errorEvent = events.find(
        (event) => event.type === "tool_call_error",
      );
      expect(errorEvent).toBeDefined();
      if (errorEvent?.type === "tool_call_error") {
        expect(errorEvent.error.message).toBe("No active tab found");
      }
    });

    it("should extract error message from JSON output on failure", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "",
          streamEvents: [
            {
              type: "run_item_stream_event",
              name: "tool_called",
              item: { rawItem: { name: "organize_tabs", arguments: "{}" } },
            },
            {
              type: "run_item_stream_event",
              name: "tool_output",
              item: {
                rawItem: { name: "organize_tabs", status: "failed" },
                output: JSON.stringify({
                  success: false,
                  error: "Cannot organize tabs in incognito window",
                }),
              },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Tools",
        model: mockModel,
      });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("organize tabs")) {
        events.push(event);
      }

      const errorEvent = events.find(
        (event) => event.type === "tool_call_error",
      );
      expect(errorEvent).toBeDefined();
      if (errorEvent?.type === "tool_call_error") {
        expect(errorEvent.error.message).toBe(
          "Cannot organize tabs in incognito window",
        );
      }
    });

    it("should sanitize sensitive data from error messages", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "",
          streamEvents: [
            {
              type: "run_item_stream_event",
              name: "tool_called",
              item: { rawItem: { name: "api_call", arguments: "{}" } },
            },
            {
              type: "run_item_stream_event",
              name: "tool_output",
              item: {
                rawItem: { name: "api_call", status: "failed" },
                output:
                  "Error: Request failed with Authorization: Bearer sk-1234567890abcdef",
              },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Tools",
        model: mockModel,
      });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("make api call")) {
        events.push(event);
      }

      const errorEvent = events.find(
        (event) => event.type === "tool_call_error",
      );
      expect(errorEvent).toBeDefined();
      if (errorEvent?.type === "tool_call_error") {
        expect(errorEvent.error.message).toContain("[REDACTED]");
        expect(errorEvent.error.message).not.toContain("sk-1234567890abcdef");
      }
    });

    it("should truncate long error messages", async () => {
      const longMessage = "x".repeat(1000);
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "",
          streamEvents: [
            {
              type: "run_item_stream_event",
              name: "tool_called",
              item: { rawItem: { name: "failing_tool", arguments: "{}" } },
            },
            {
              type: "run_item_stream_event",
              name: "tool_output",
              item: {
                rawItem: { name: "failing_tool", status: "failed" },
                output: longMessage,
              },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Tools",
        model: mockModel,
      });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("run failing tool")) {
        events.push(event);
      }

      const errorEvent = events.find(
        (event) => event.type === "tool_call_error",
      );
      expect(errorEvent).toBeDefined();
      if (errorEvent?.type === "tool_call_error") {
        expect(errorEvent.error.message.length).toBeLessThanOrEqual(500);
        expect(errorEvent.error.message.endsWith("...")).toBe(true);
      }
    });
  });
});
