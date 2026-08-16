import type * as EternaCore from "@eterna/core";
import { AgentError, ErrorCode } from "@eterna/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStatus, ContextItem, UIMessage } from "../types";
import { ChatAdapter, createChatAdapter } from "./chat-adapter";

// Mock generateId to return predictable IDs
vi.mock("@eterna/core", async (importOriginal) => {
  const actual = await importOriginal<typeof EternaCore>();
  let idCounter = 0;
  return {
    ...actual,
    generateId: vi.fn(() => `test-id-${++idCounter}`),
  };
});

describe("ChatAdapter", () => {
  let adapter: ChatAdapter;
  let onMessagesUpdate: (messages: UIMessage[]) => void;
  let onStatusChange: (status: ChatStatus) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    onMessagesUpdate = vi.fn();
    onStatusChange = vi.fn();
    adapter = createChatAdapter({
      onMessagesUpdate,
      onStatusChange,
    });
  });

  describe("createChatAdapter factory", () => {
    it("should create a new ChatAdapter instance", () => {
      const newAdapter = createChatAdapter();
      expect(newAdapter).toBeInstanceOf(ChatAdapter);
    });

    it("should create adapter without options", () => {
      const newAdapter = createChatAdapter();
      expect(newAdapter.getMessages()).toEqual([]);
      expect(newAdapter.getStatus()).toBe("idle");
    });
  });

  describe("initial state", () => {
    it("should start with empty messages", () => {
      expect(adapter.getMessages()).toEqual([]);
    });

    it("should start with idle status", () => {
      expect(adapter.getStatus()).toBe("idle");
    });

    it("should return a copy of messages array", () => {
      const messages1 = adapter.getMessages();
      const messages2 = adapter.getMessages();
      expect(messages1).not.toBe(messages2);
      expect(messages1).toEqual(messages2);
    });
  });

  describe("addUserMessage", () => {
    it("should add a user message with text", () => {
      const message = adapter.addUserMessage("Hello, AI!");

      expect(message.role).toBe("user");
      expect(message.parts).toHaveLength(1);
      expect(message.parts[0]).toEqual({
        type: "text",
        text: "Hello, AI!",
      });
      expect(onMessagesUpdate).toHaveBeenCalledWith([message]);
    });

    it("should add a user message with contexts", () => {
      const contexts = [
        {
          id: "ctx-1",
          type: "page" as const,
          label: "Current Page",
          value: "Page content here",
        },
      ];

      const message = adapter.addUserMessage(
        "Summarize this",
        undefined,
        contexts,
      );

      expect(message.parts).toHaveLength(2);
      expect(message.parts[0]).toMatchObject({
        type: "context",
        contextType: "page",
        label: "Current Page",
      });
      expect(message.parts[1]).toEqual({
        type: "text",
        text: "Summarize this",
      });
    });

    it("should trim whitespace from text", () => {
      const message = adapter.addUserMessage("  Hello  ");

      const textPart = message.parts.find((p) => p.type === "text");
      expect(textPart?.type === "text" && textPart.text).toBe("Hello");
    });

    it("should handle empty text with contexts", () => {
      const contexts = [
        {
          id: "ctx-1",
          type: "page" as const,
          label: "Page",
          value: "Content",
        },
      ];

      const message = adapter.addUserMessage("", undefined, contexts);

      expect(message.parts).toHaveLength(1);
      expect(message.parts[0]?.type).toBe("context");
    });

    it("should handle whitespace-only text", () => {
      const message = adapter.addUserMessage("   ");

      expect(message.parts).toHaveLength(0);
    });

    it("should add multiple context items", () => {
      const contexts: ContextItem[] = [
        { id: "ctx-1", type: "page", label: "Page 1", value: "Content 1" },
        { id: "ctx-2", type: "tab", label: "Tab", value: "Tab content" },
      ];

      const message = adapter.addUserMessage("Test", undefined, contexts);

      expect(message.parts).toHaveLength(3);
      expect(message.parts[0]?.type).toBe("context");
      expect(message.parts[1]?.type).toBe("context");
      expect(message.parts[2]?.type).toBe("text");
    });

    it("should include context metadata", () => {
      const contexts = [
        {
          id: "ctx-1",
          type: "page" as const,
          label: "Page",
          value: "Content",
          metadata: { url: "https://example.com" },
        },
      ];

      const message = adapter.addUserMessage("Test", undefined, contexts);

      const contextPart = message.parts[0];
      expect(contextPart?.type).toBe("context");
      if (contextPart?.type === "context") {
        expect(contextPart.metadata).toEqual({
          url: "https://example.com",
        });
      }
    });

    it("should generate unique message IDs", () => {
      const message1 = adapter.addUserMessage("First");
      const message2 = adapter.addUserMessage("Second");

      expect(message1.id).not.toBe(message2.id);
    });

    it("should include timestamp", () => {
      const before = Date.now();
      const message = adapter.addUserMessage("Test");
      const after = Date.now();

      expect(message.timestamp).toBeGreaterThanOrEqual(before);
      expect(message.timestamp).toBeLessThanOrEqual(after);
    });

    it("should reuse the URL of an already-processed attachment", () => {
      // Attachments from the input arrive as file parts carrying their own
      // (data:) URL — not File objects. Re-creating an object URL here is what
      // caused the "createObjectURL Overload resolution failed" crash.
      const createSpy = vi.fn();
      const original = URL.createObjectURL;
      URL.createObjectURL = createSpy as unknown as typeof URL.createObjectURL;

      try {
        const attachment = {
          type: "file" as const,
          url: "data:image/png;base64,iVBORw0KGgo=",
          mediaType: "image/png",
          filename: "shot.png",
        };

        const message = adapter.addUserMessage("Look at this", [attachment]);

        const filePart = message.parts.find((p) => p.type === "file");
        expect(filePart).toMatchObject({
          type: "file",
          url: "data:image/png;base64,iVBORw0KGgo=",
          mediaType: "image/png",
          filename: "shot.png",
        });
        expect(createSpy).not.toHaveBeenCalled();
      } finally {
        URL.createObjectURL = original;
      }
    });

    it("should create an object URL for a raw File attachment", () => {
      const original = URL.createObjectURL;
      URL.createObjectURL = vi.fn(
        () => "blob:mock-url",
      ) as unknown as typeof URL.createObjectURL;

      try {
        const file = new File(["data"], "photo.jpg", { type: "image/jpeg" });
        const message = adapter.addUserMessage("Here", [file]);

        const filePart = message.parts.find((p) => p.type === "file");
        expect(filePart).toMatchObject({
          type: "file",
          url: "blob:mock-url",
          mediaType: "image/jpeg",
          filename: "photo.jpg",
        });
      } finally {
        URL.createObjectURL = original;
      }
    });

    it("should not throw on a malformed attachment without a url", () => {
      expect(() =>
        adapter.addUserMessage("x", [{} as unknown as File]),
      ).not.toThrow();
    });
  });

  describe("processEvent", () => {
    const metrics = {
      tokensUsed: 0,
      promptTokens: 0,
      completionTokens: 0,
      itemCount: 0,
      maxTurns: 10,
      duration: 0,
      startTime: Date.now(),
    };

    it("should create assistant message and set streaming status on content delta", () => {
      adapter.processEvent({ type: "content_delta", delta: "Hello" });

      const messages = adapter.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ role: "assistant" });

      const textPart = messages[0]?.parts[0];
      expect(textPart).toMatchObject({ type: "text", text: "Hello" });
      expect(adapter.getStatus()).toBe("streaming");
    });

    it("should append reasoning deltas into a single reasoning part", () => {
      adapter.processEvent({ type: "reasoning_delta", delta: "Let me " });
      adapter.processEvent({ type: "reasoning_delta", delta: "think." });

      const messages = adapter.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.parts).toEqual([
        { type: "reasoning", text: "Let me think." },
      ]);
      expect(adapter.getStatus()).toBe("streaming");
    });

    it("should keep reasoning and following text as separate parts in the same message", () => {
      adapter.processEvent({ type: "reasoning_delta", delta: "Thinking…" });
      adapter.processEvent({ type: "content_delta", delta: "The answer." });

      const messages = adapter.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.parts).toEqual([
        { type: "reasoning", text: "Thinking…" },
        { type: "text", text: "The answer." },
      ]);
    });

    it("should start a new assistant message for reasoning that follows tool calls", () => {
      adapter.processEvent({ type: "reasoning_delta", delta: "Plan first." });
      adapter.processEvent({
        type: "tool_call_start",
        toolName: "search",
        params: { q: "ts" },
      });
      adapter.processEvent({
        type: "tool_call_complete",
        toolName: "search",
        result: { ok: true },
      });
      adapter.processEvent({ type: "reasoning_delta", delta: "Now reflect." });

      const messages = adapter.getMessages();
      expect(messages).toHaveLength(2);
      expect(messages[0]?.parts[0]).toEqual({
        type: "reasoning",
        text: "Plan first.",
      });
      expect(messages[0]?.parts.some((p) => p.type === "tool")).toBe(true);
      expect(messages[1]?.parts).toEqual([
        { type: "reasoning", text: "Now reflect." },
      ]);
    });

    it("should create a pending tool call on tool_call_args_streaming_start", () => {
      adapter.processEvent({
        type: "tool_call_args_streaming_start",
        toolName: "search",
      });

      const messages = adapter.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ role: "assistant" });

      const toolPart = messages[0]?.parts.find((p) => p.type === "tool");
      expect(toolPart).toMatchObject({
        toolName: "search",
        state: "pending",
        input: {},
      });
      expect(adapter.getStatus()).toBe("streaming");
    });

    it("should update pending tool params on tool_call_args_streaming_complete", () => {
      adapter.processEvent({
        type: "tool_call_args_streaming_start",
        toolName: "search",
      });
      adapter.processEvent({
        type: "tool_call_args_streaming_complete",
        toolName: "search",
        params: { q: "ts" },
      });

      const toolPart = adapter
        .getMessages()[0]
        ?.parts.find((p) => p.type === "tool");
      expect(toolPart).toMatchObject({
        toolName: "search",
        state: "pending",
        input: { q: "ts" },
      });
    });

    it("should not duplicate tool parts when tool_call_start follows tool args streaming events", () => {
      adapter.processEvent({
        type: "tool_call_args_streaming_start",
        toolName: "search",
      });
      adapter.processEvent({
        type: "tool_call_args_streaming_complete",
        toolName: "search",
        params: { q: "ts" },
      });
      adapter.processEvent({
        type: "tool_call_start",
        toolName: "search",
        params: { q: "ts" },
      });

      const toolParts =
        adapter.getMessages()[0]?.parts.filter((p) => p.type === "tool") ?? [];
      expect(toolParts).toHaveLength(1);
      expect(toolParts[0]).toMatchObject({
        toolName: "search",
        state: "executing",
        input: { q: "ts" },
      });
      expect(adapter.getStatus()).toBe("executing_tools");
    });

    it("should append to existing assistant message", () => {
      adapter.processEvent({ type: "content_delta", delta: "Hello" });
      adapter.processEvent({ type: "content_delta", delta: " world" });

      const messages = adapter.getMessages();
      const textPart = messages[0]?.parts[0];
      expect(textPart).toMatchObject({ text: "Hello world" });
    });

    it("should ignore session events for status", () => {
      adapter.processEvent({ type: "session_created", sessionId: "session-1" });
      adapter.processEvent({
        type: "session_resumed",
        sessionId: "session-1",
        itemCount: 2,
      });
      adapter.processEvent({ type: "metrics_update", metrics });

      expect(adapter.getStatus()).toBe("idle");
    });

    it("should set idle status on execution_complete", () => {
      adapter.processEvent({ type: "content_delta", delta: "Hi" });
      adapter.processEvent({
        type: "execution_complete",
        finalOutput: "Hi",
        metrics,
      });

      expect(adapter.getStatus()).toBe("idle");
      expect(onStatusChange).toHaveBeenCalledWith("idle");
    });

    it("should set error status on error event", () => {
      adapter.processEvent({
        type: "error",
        error: new AgentError("Test failure", ErrorCode.LLM_API_ERROR, false),
      });

      expect(adapter.getStatus()).toBe("error");
    });

    it("should not duplicate status notifications", () => {
      adapter.processEvent({ type: "content_delta", delta: "Hi" });
      (onStatusChange as ReturnType<typeof vi.fn>).mockClear();

      adapter.processEvent({ type: "content_delta", delta: " again" });

      expect(onStatusChange).toHaveBeenCalledTimes(0);
    });
  });
});
