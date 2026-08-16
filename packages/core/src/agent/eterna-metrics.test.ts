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

  describe("metrics", () => {
    it("should yield metrics_update event with correct data", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Response",
          usage: {
            promptTokens: 10,
            completionTokens: 20,
          },
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Response" },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
        maxTurns: 5,
      });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("Test input")) {
        events.push(event);
      }

      const metricsEvent = events.find((e) => e.type === "metrics_update");
      expect(metricsEvent).toBeDefined();
      if (metricsEvent && metricsEvent.type === "metrics_update") {
        expect(metricsEvent.metrics.tokensUsed).toBe(30);
        expect(metricsEvent.metrics.promptTokens).toBe(10);
        expect(metricsEvent.metrics.completionTokens).toBe(20);
        expect(metricsEvent.metrics.maxTurns).toBe(5);
        expect(metricsEvent.metrics.startTime).toBeGreaterThan(0);
        expect(metricsEvent.metrics.duration).toBeGreaterThanOrEqual(0);
      }
    });

    it("should handle missing usage data gracefully", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Response",
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Response" },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
      });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("Test")) {
        events.push(event);
      }

      const metricsEvent = events.find((e) => e.type === "metrics_update");
      expect(metricsEvent).toBeDefined();
      if (metricsEvent && metricsEvent.type === "metrics_update") {
        expect(metricsEvent.metrics.tokensUsed).toBe(0);
        expect(metricsEvent.metrics.promptTokens).toBe(0);
        expect(metricsEvent.metrics.completionTokens).toBe(0);
      }
    });

    it("should include metrics in execution_complete event", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Done",
          usage: {
            promptTokens: 15,
            completionTokens: 25,
          },
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Done" },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
      });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("Input")) {
        events.push(event);
      }

      const completeEvent = events.find((e) => e.type === "execution_complete");
      expect(completeEvent).toBeDefined();
      if (completeEvent && completeEvent.type === "execution_complete") {
        expect(completeEvent.metrics.tokensUsed).toBe(40);
      }
    });

    it("should use last rawResponse usage when multiple responses exist", async () => {
      // Simulate a multi-turn execution where multiple model responses occur
      // (e.g., tool calls triggering additional model calls)
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Final response",
          rawResponses: [
            // First response (e.g., tool call)
            { usage: { inputTokens: 100, outputTokens: 50 } },
            // Second response (e.g., another tool call)
            { usage: { inputTokens: 200, outputTokens: 100 } },
            // Final response - this should be used
            { usage: { inputTokens: 500, outputTokens: 250 } },
          ],
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Final response" },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
      });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("Input")) {
        events.push(event);
      }

      const metricsEvent = events.find((e) => e.type === "metrics_update");
      expect(metricsEvent).toBeDefined();
      if (metricsEvent && metricsEvent.type === "metrics_update") {
        // Should use the LAST response's usage, not the sum
        expect(metricsEvent.metrics.promptTokens).toBe(500);
        expect(metricsEvent.metrics.completionTokens).toBe(250);
        expect(metricsEvent.metrics.tokensUsed).toBe(750);
      }

      const completeEvent = events.find((e) => e.type === "execution_complete");
      expect(completeEvent).toBeDefined();
      if (completeEvent && completeEvent.type === "execution_complete") {
        expect(completeEvent.metrics.tokensUsed).toBe(750);
      }
    });

    it("should handle rawResponses with some entries missing usage", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Response",
          rawResponses: [
            { usage: { inputTokens: 100, outputTokens: 50 } },
            {}, // No usage
            { usage: undefined },
            { usage: { inputTokens: 300, outputTokens: 150 } }, // Last with usage
          ],
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Response" },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
      });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("Input")) {
        events.push(event);
      }

      const metricsEvent = events.find((e) => e.type === "metrics_update");
      expect(metricsEvent).toBeDefined();
      if (metricsEvent && metricsEvent.type === "metrics_update") {
        // Should find the last response WITH usage data
        expect(metricsEvent.metrics.promptTokens).toBe(300);
        expect(metricsEvent.metrics.completionTokens).toBe(150);
        expect(metricsEvent.metrics.tokensUsed).toBe(450);
      }
    });

    it("should accumulate session metrics across multiple conversations", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Response 1",
          usage: { promptTokens: 10, completionTokens: 20 },
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Response 1" },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
      });

      let sessionId: string | undefined;
      for await (const event of agent.chat("First message")) {
        if (event.type === "session_created") {
          sessionId = event.sessionId;
        }
      }

      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Response 2",
          usage: { promptTokens: 15, completionTokens: 25 },
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Response 2" },
            },
          ],
        }),
      );

      for await (const _ of agent.chat("Second", { sessionId: sessionId! })) {
        // consume
      }

      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Response 3",
          usage: { promptTokens: 20, completionTokens: 30 },
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Response 3" },
            },
          ],
        }),
      );

      for await (const _ of agent.chat("Third", { sessionId: sessionId! })) {
        // consume
      }

      const manager = agent.getConversationManager()!;
      const session = await manager.getSession(sessionId!);
      const sessionMetrics = session?.getSessionMetrics();

      expect(sessionMetrics?.totalTokensUsed).toBe(120);
      expect(sessionMetrics?.totalPromptTokens).toBe(45);
      expect(sessionMetrics?.totalCompletionTokens).toBe(75);
      expect(sessionMetrics?.executionCount).toBe(3);
    });

    it("should persist accumulated metrics after reload", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Response 1",
          usage: { promptTokens: 50, completionTokens: 100 },
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Response 1" },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
      });

      let sessionId: string | undefined;
      for await (const event of agent.chat("Message")) {
        if (event.type === "session_created") {
          sessionId = event.sessionId;
        }
      }

      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Response 2",
          usage: { promptTokens: 60, completionTokens: 120 },
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Response 2" },
            },
          ],
        }),
      );

      for await (const _ of agent.chat("Continue", { sessionId: sessionId! })) {
        // consume
      }

      const manager = agent.getConversationManager()!;
      manager.clearCache();

      const reloadedSession = await manager.getSession(sessionId!);
      const metrics = reloadedSession?.getSessionMetrics();

      expect(metrics?.totalTokensUsed).toBe(330);
      expect(metrics?.totalPromptTokens).toBe(110);
      expect(metrics?.totalCompletionTokens).toBe(220);
      expect(metrics?.executionCount).toBe(2);
    });

    it("should accumulate metrics even on error", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Success",
          usage: { promptTokens: 30, completionTokens: 40 },
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Success" },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
      });

      let sessionId: string | undefined;
      for await (const event of agent.chat("First")) {
        if (event.type === "session_created") {
          sessionId = event.sessionId;
        }
      }

      vi.mocked(run).mockRejectedValue(new Error("LLM failed"));

      for await (const _ of agent.chat("Failing", { sessionId: sessionId! })) {
        // consume
      }

      const manager = agent.getConversationManager()!;
      const session = await manager.getSession(sessionId!);
      const metrics = session?.getSessionMetrics();

      expect(metrics?.executionCount).toBe(2);
      expect(metrics?.totalTokensUsed).toBe(70);
    });
  });
});
