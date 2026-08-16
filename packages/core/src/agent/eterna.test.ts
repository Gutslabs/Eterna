import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationManager } from "../conversation/manager.js";
import { SessionStorage } from "../conversation/storage.js";
import { InMemoryStorage } from "../storage/memory.js";
import type {
  AgentEvent,
  AgentInputItem,
  AiSdkModel,
  SerializedSession,
} from "../types.js";
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

  describe("chat - new conversation", () => {
    it("should create session and yield events in correct order (default storage)", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Hello!",
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Hello!" },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Test agent",
        model: mockModel,
      });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("Hi")) {
        events.push(event);
      }

      expect(events[0]?.type).toBe("session_created");
      expect(events[1]).toEqual({ type: "content_delta", delta: "Hello!" });
      expect(events[2]?.type).toBe("metrics_update");
      const executionComplete = events[3];
      expect(executionComplete?.type).toBe("execution_complete");
      if (executionComplete?.type === "execution_complete") {
        expect(executionComplete.finalOutput).toBe("Hello!");
        expect(executionComplete.metrics).toBeDefined();
      }
    });

    it("should work with custom storage", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Reply",
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Reply" },
            },
          ],
        }),
      );

      const customStorage = new SessionStorage(
        new InMemoryStorage<SerializedSession>(),
      );
      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
        storage: customStorage,
      });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("Hi")) {
        events.push(event);
      }

      expect(events[0]?.type).toBe("session_created");
    });

    it("should work with conversation disabled (stateless)", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Reply",
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Reply" },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
        conversation: false,
      });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("Hi")) {
        events.push(event);
      }

      expect(events.find((e) => e.type === "session_created")).toBeUndefined();
      expect(events[0]?.type).toBe("content_delta");
    });

    it("should pass an EphemeralSession to run() in stateless mode", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Reply",
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Reply" },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
        conversation: false,
      });

      for await (const _event of agent.chat("Hi")) {
        // consume events
      }

      // Verify run() was called with a session (EphemeralSession) even in stateless mode
      expect(run).toHaveBeenCalledTimes(1);
      const runCallArgs = vi.mocked(run).mock.calls[0]!;
      const runOptions = runCallArgs[2] as { session?: unknown };
      expect(runOptions.session).toBeDefined();
      // EphemeralSession has getSessionId, addItems, getItems, popItem, clearSession
      expect(typeof (runOptions.session as any).getSessionId).toBe("function");
      expect(typeof (runOptions.session as any).addItems).toBe("function");
    });

    it("should pass callModelInputFilter to run() for screenshot shaping", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Reply",
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Reply" },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
        conversation: false,
      });

      for await (const _event of agent.chat("Hi")) {
        // consume events
      }

      expect(run).toHaveBeenCalledTimes(1);
      const runCallArgs = vi.mocked(run).mock.calls[0]!;
      const runOptions = runCallArgs[2] as { callModelInputFilter?: unknown };
      expect(runOptions.callModelInputFilter).toBeDefined();
      expect(typeof runOptions.callModelInputFilter).toBe("function");
    });

    it("callModelInputFilter should shape screenshot items before model call", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Reply",
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Reply" },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
      });

      for await (const _event of agent.chat("Hi")) {
        // consume events
      }

      // Extract the callModelInputFilter and invoke it with a screenshot tool result
      const runCallArgs = vi.mocked(run).mock.calls[0]!;
      const runOptions = runCallArgs[2] as unknown as {
        callModelInputFilter: (args: {
          modelData: { input: unknown[]; instructions?: string };
          agent: unknown;
          context: unknown;
        }) => Promise<{ input: unknown[]; instructions?: string }>;
      };

      const screenshotToolResult = {
        type: "function_call_result",
        name: "capture_screenshot",
        callId: "call_test",
        output: JSON.stringify({
          success: true,
          imageData: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==",
          sendToLLM: true,
          screenshotUid: "screenshot_123_abc",
        }),
      };

      const result = await runOptions.callModelInputFilter({
        modelData: {
          input: [screenshotToolResult],
          instructions: "Test instructions",
        },
        agent: {},
        context: undefined,
      });

      // Should have 2 items: stripped tool result + transient user image message
      expect(result.input.length).toBe(2);

      // First item: stripped tool result with imageData replaced
      const stripped = result.input[0] as { type: string; output: string };
      expect(stripped.type).toBe("function_call_result");
      const parsed = JSON.parse(stripped.output);
      expect(parsed.success).toBe(true);
      expect(parsed.data.imageData).toBe(
        "[Image data removed - see following user message]",
      );

      // Second item: transient user image message
      const userMsg = result.input[1] as { type: string; role: string };
      expect(userMsg.type).toBe("message");
      expect(userMsg.role).toBe("user");

      // Instructions should pass through unchanged
      expect(result.instructions).toBe("Test instructions");
    });

    it("falls back to text when the selected model has no vision", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({ finalOutput: "Reply" }),
      );
      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
        supportsVision: false,
      });

      for await (const _event of agent.chat("Describe this", {
        images: [{ image: "data:image/png;base64,abc" }],
      })) {
        // consume events
      }

      const [input, options] = [
        vi.mocked(run).mock.calls[0]![1],
        vi.mocked(run).mock.calls[0]![2],
      ] as const;
      const filter = (
        options as unknown as {
          callModelInputFilter: (args: {
            modelData: { input: AgentInputItem[]; instructions?: string };
          }) => Promise<{ input: AgentInputItem[] }>;
        }
      ).callModelInputFilter;
      const filtered = await filter({
        modelData: { input: input as AgentInputItem[] },
      });
      const content = (filtered.input[0] as { content: unknown[] }).content;

      expect(content).toEqual([
        { type: "input_text", text: "Describe this" },
        expect.objectContaining({ type: "input_text" }),
      ]);
    });

    it("should work with custom conversationManager", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Reply",
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Reply" },
            },
          ],
        }),
      );

      const storage = new SessionStorage(
        new InMemoryStorage<SerializedSession>(),
      );
      const customManager = new ConversationManager(storage);

      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
        conversationManager: customManager,
      });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("Hi")) {
        events.push(event);
      }

      expect(events[0]?.type).toBe("session_created");
      expect(agent.getConversationManager()).toBe(customManager);
    });

    it("should pass images as multimodal AgentInputItem[] to run()", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "I see a cat",
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "I see a cat" },
            },
          ],
        }),
      );

      const agent = Eterna.create({
        instructions: "Describe images",
        model: mockModel,
      });

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("What is in this image?", {
        images: [{ image: "data:image/png;base64,abc123", detail: "high" }],
      })) {
        events.push(event);
      }

      expect(run).toHaveBeenCalledTimes(1);
      const runCallArgs = vi.mocked(run).mock.calls[0]!;
      const input = runCallArgs[1] as Array<{
        type: string;
        role: string;
        content: Array<{
          type: string;
          text?: string;
          image?: string;
          detail?: string;
        }>;
      }>;

      expect(Array.isArray(input)).toBe(true);
      expect(input).toHaveLength(1);
      expect(input[0]!.role).toBe("user");
      expect(input[0]!.content).toHaveLength(2);
      expect(input[0]!.content[0]).toEqual({
        type: "input_text",
        text: "What is in this image?",
      });
      expect(input[0]!.content[1]).toEqual({
        type: "input_image",
        image: "data:image/png;base64,abc123",
        detail: "high",
      });
    });

    it("should omit the text block when an image is sent with no prompt", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({ finalOutput: "A cat" }),
      );

      const agent = Eterna.create({ instructions: "Test", model: mockModel });

      for await (const _ of agent.chat("", {
        images: [{ image: "data:image/png;base64,abc123" }],
      })) {
        // consume
      }

      const runCallArgs = vi.mocked(run).mock.calls[0]!;
      const input = runCallArgs[1] as Array<{
        content: Array<{ type: string; text?: string }>;
      }>;

      // Providers reject empty text blocks, so the image must travel alone.
      expect(input[0]!.content).toHaveLength(1);
      expect(input[0]!.content[0]!.type).toBe("input_image");
    });

    it("should stand in a prompt when a turn carries no text and no image", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({ finalOutput: "Read it" }),
      );

      const agent = Eterna.create({ instructions: "Test", model: mockModel });

      for await (const _ of agent.chat("   ")) {
        // consume
      }

      const runCallArgs = vi.mocked(run).mock.calls[0]!;
      expect(typeof runCallArgs[1]).toBe("string");
      expect((runCallArgs[1] as string).trim()).not.toBe("");
    });

    it("should default image detail to 'auto' when not specified", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({ finalOutput: "OK" }),
      );

      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
      });

      for await (const _ of agent.chat("Describe", {
        images: [{ image: "https://example.com/img.png" }],
      })) {
        // consume
      }

      const runCallArgs = vi.mocked(run).mock.calls[0]!;
      const input = runCallArgs[1] as Array<{
        content: Array<{ type: string; detail?: string }>;
      }>;
      const imagePart = input[0]!.content[1]!;
      expect(imagePart.detail).toBe("auto");
    });

    it("should support multiple images in a single message", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({ finalOutput: "Two images" }),
      );

      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
      });

      for await (const _ of agent.chat("Compare these", {
        images: [
          { image: "img1_base64" },
          { image: "img2_base64", detail: "low" },
        ],
      })) {
        // consume
      }

      const runCallArgs = vi.mocked(run).mock.calls[0]!;
      const input = runCallArgs[1] as Array<{
        content: Array<{ type: string; image?: string; detail?: string }>;
      }>;
      expect(input[0]!.content).toHaveLength(3);
      expect(input[0]!.content[0]!.type).toBe("input_text");
      expect(input[0]!.content[1]!.type).toBe("input_image");
      expect(input[0]!.content[1]!.image).toBe("img1_base64");
      expect(input[0]!.content[2]!.type).toBe("input_image");
      expect(input[0]!.content[2]!.image).toBe("img2_base64");
      expect(input[0]!.content[2]!.detail).toBe("low");
    });

    it("should pass plain string to run() when no images provided", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({ finalOutput: "Reply" }),
      );

      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
      });

      for await (const _ of agent.chat("Hello")) {
        // consume
      }

      const runCallArgs = vi.mocked(run).mock.calls[0]!;
      expect(typeof runCallArgs[1]).toBe("string");
      expect(runCallArgs[1]).toBe("Hello");
    });
  });

  describe("chat - continue conversation", () => {
    it("should throw error when conversation is disabled", async () => {
      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
        conversation: false,
      });

      await expect(async () => {
        for await (const _ of agent.chat("Hi", { sessionId: "session-1" })) {
          // consume generator
        }
      }).rejects.toThrow("ConversationManager is required");
    });

    it("should throw error for non-existent session", async () => {
      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
      });

      await expect(async () => {
        for await (const _ of agent.chat("Hi", { sessionId: "non-existent" })) {
          // consume generator
        }
      }).rejects.toThrow("Session non-existent not found");
    });

    it("should resume existing session", async () => {
      vi.mocked(run).mockResolvedValue(
        createMockRunResult({
          finalOutput: "Response 1",
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
          streamEvents: [
            {
              type: "raw_model_stream_event",
              data: { type: "output_text_delta", delta: "Response 2" },
            },
          ],
        }),
      );

      const events: AgentEvent[] = [];
      for await (const event of agent.chat("Second message", {
        sessionId: sessionId!,
      })) {
        events.push(event);
      }

      const sessionResumed = events[0];
      expect(sessionResumed?.type).toBe("session_resumed");
      if (sessionResumed?.type === "session_resumed") {
        expect(sessionResumed.sessionId).toBe(sessionId);
      }
    });
  });

  describe("create", () => {
    it("should use default values when options not provided", () => {
      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
      });

      expect(agent).toBeDefined();
      expect(agent.getConversationManager()).toBeDefined();
    });

    it("should expose conversationManager via getConversationManager", () => {
      const agent = Eterna.create({
        instructions: "Test",
        model: mockModel,
      });

      const manager = agent.getConversationManager();
      expect(manager).toBeInstanceOf(ConversationManager);
    });
  });
});
