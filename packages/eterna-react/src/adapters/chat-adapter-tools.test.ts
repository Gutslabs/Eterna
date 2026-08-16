import type * as EternaCore from "@eterna/core";
import { AgentError, ErrorCode } from "@eterna/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStatus, UIMessage, UIToolPart } from "../types";
import { type ChatAdapter, createChatAdapter } from "./chat-adapter";

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

  describe("tool call handling", () => {
    beforeEach(() => {
      adapter.processEvent({ type: "content_delta", delta: "Thinking" });
    });

    it("should add tool call on tool_call_start", () => {
      adapter.processEvent({
        type: "tool_call_start",
        toolName: "search",
        params: { query: "test" },
      });

      const messages = adapter.getMessages();
      const toolPart = messages[0]?.parts.find((p) => p.type === "tool");
      expect(toolPart).toMatchObject({
        toolName: "search",
        input: { query: "test" },
        state: "executing",
      });
      expect(adapter.getStatus()).toBe("executing_tools");
    });

    it("should update tool call on completion", () => {
      adapter.processEvent({
        type: "tool_call_start",
        toolName: "search",
        params: { query: "test" },
      });
      adapter.processEvent({
        type: "tool_call_complete",
        toolName: "search",
        result: { data: [1, 2, 3] },
      });

      const toolPart = adapter
        .getMessages()[0]
        ?.parts.find((p) => p.type === "tool");
      expect(toolPart).toMatchObject({
        toolName: "search",
        state: "completed",
        output: { data: [1, 2, 3] },
      });
      expect(adapter.getStatus()).toBe("streaming");
    });

    it("should mark tool call as error when tool_call_error arrives", () => {
      adapter.processEvent({
        type: "tool_call_start",
        toolName: "search",
        params: {},
      });
      adapter.processEvent({
        type: "tool_call_error",
        toolName: "search",
        error: new Error("failed"),
      });

      const toolPart = adapter
        .getMessages()[0]
        ?.parts.find((p) => p.type === "tool");
      expect(toolPart).toMatchObject({
        state: "error",
        errorText: "failed",
      });
      // Status should be streaming, not error - agent may continue after tool error
      expect(adapter.getStatus()).toBe("streaming");
    });

    it("should handle multiple calls for same tool sequentially", () => {
      adapter.processEvent({
        type: "tool_call_start",
        toolName: "search",
        params: { query: "first" },
      });
      adapter.processEvent({
        type: "tool_call_start",
        toolName: "search",
        params: { query: "second" },
      });

      adapter.processEvent({
        type: "tool_call_complete",
        toolName: "search",
        result: { query: "first" },
      });
      adapter.processEvent({
        type: "tool_call_complete",
        toolName: "search",
        result: { query: "second" },
      });

      const toolParts =
        adapter
          .getMessages()[0]
          ?.parts.filter((p): p is UIToolPart => p.type === "tool") ?? [];
      expect(toolParts).toHaveLength(2);
      expect(toolParts[0]).toMatchObject({
        toolName: "search",
        state: "completed",
        output: { query: "first" },
      });
      expect(toolParts[1]).toMatchObject({
        toolName: "search",
        state: "completed",
        output: { query: "second" },
      });
    });

    it("should ignore completion when no pending call", () => {
      adapter.processEvent({
        type: "tool_call_complete",
        toolName: "search",
        result: { orphan: true },
      });

      const toolParts =
        adapter.getMessages()[0]?.parts.filter((p) => p.type === "tool") ?? [];
      expect(toolParts).toHaveLength(0);
    });

    it("should mark tool as error when result has success: false", () => {
      adapter.processEvent({
        type: "tool_call_start",
        toolName: "organize_tabs",
        params: {},
      });
      adapter.processEvent({
        type: "tool_call_complete",
        toolName: "organize_tabs",
        result: {
          success: false,
          error: "Cannot organize tabs in incognito window",
        },
      });

      const toolPart = adapter
        .getMessages()[0]
        ?.parts.find((p) => p.type === "tool");
      expect(toolPart).toMatchObject({
        toolName: "organize_tabs",
        state: "error",
        errorText: "Cannot organize tabs in incognito window",
      });
      // Status should remain streaming (not error) since this is a business failure
      expect(adapter.getStatus()).toBe("streaming");
    });

    it("should use message field when error field is missing in success: false result", () => {
      adapter.processEvent({
        type: "tool_call_start",
        toolName: "screenshot",
        params: {},
      });
      adapter.processEvent({
        type: "tool_call_complete",
        toolName: "screenshot",
        result: { success: false, message: "No active tab found" },
      });

      const toolPart = adapter
        .getMessages()[0]
        ?.parts.find((p) => p.type === "tool");
      expect(toolPart).toMatchObject({
        state: "error",
        errorText: "No active tab found",
      });
    });

    it("should show generic error message when success: false has no error/message", () => {
      adapter.processEvent({
        type: "tool_call_start",
        toolName: "failing_tool",
        params: {},
      });
      adapter.processEvent({
        type: "tool_call_complete",
        toolName: "failing_tool",
        result: { success: false },
      });

      const toolPart = adapter
        .getMessages()[0]
        ?.parts.find((p) => p.type === "tool");
      expect(toolPart).toMatchObject({
        state: "error",
        errorText: "Operation failed",
      });
    });

    it("should keep output in tool part when marking as error for debugging", () => {
      adapter.processEvent({
        type: "tool_call_start",
        toolName: "api_call",
        params: {},
      });
      adapter.processEvent({
        type: "tool_call_complete",
        toolName: "api_call",
        result: {
          success: false,
          error: "API rate limit exceeded",
          details: { remaining: 0 },
        },
      });

      const toolPart = adapter
        .getMessages()[0]
        ?.parts.find((p) => p.type === "tool") as UIToolPart | undefined;
      expect(toolPart?.state).toBe("error");
      expect(toolPart?.errorText).toBe("API rate limit exceeded");
      expect(toolPart?.output).toEqual({
        success: false,
        error: "API rate limit exceeded",
        details: { remaining: 0 },
      });
    });

    it("should not set overall status to error on tool_call_error", () => {
      adapter.processEvent({
        type: "tool_call_start",
        toolName: "search",
        params: {},
      });
      adapter.processEvent({
        type: "tool_call_error",
        toolName: "search",
        error: new Error("Tool execution failed"),
      });

      // Status should be streaming, not error - agent may continue
      expect(adapter.getStatus()).toBe("streaming");
    });
  });

  describe("reset", () => {
    it("should reset to empty state", () => {
      adapter.addUserMessage("Hello");
      adapter.processEvent({ type: "content_delta", delta: "Working" });

      adapter.reset();

      expect(adapter.getMessages()).toEqual([]);
      expect(adapter.getStatus()).toBe("idle");
    });

    it("restores a suffix present in finalOutput but missing from the stream", () => {
      adapter.processEvent({
        type: "content_delta",
        delta: "They are both killing Base, and it",
      });
      adapter.processEvent({
        type: "execution_complete",
        finalOutput: "They are both killing Base, and it needs to stop.",
        metrics: {
          tokensUsed: 0,
          promptTokens: 0,
          completionTokens: 0,
          itemCount: 0,
          maxTurns: 10,
          duration: 0,
          startTime: Date.now(),
        },
      });

      expect(adapter.getMessages()[0]?.parts).toEqual([
        {
          type: "text",
          text: "They are both killing Base, and it needs to stop.",
        },
      ]);
    });

    it("does not overwrite streamed text when finalOutput disagrees", () => {
      adapter.processEvent({ type: "content_delta", delta: "Visible answer" });
      adapter.processEvent({
        type: "execution_complete",
        finalOutput: "Different runner output",
        metrics: {
          tokensUsed: 0,
          promptTokens: 0,
          completionTokens: 0,
          itemCount: 0,
          maxTurns: 10,
          duration: 0,
          startTime: Date.now(),
        },
      });

      expect(adapter.getMessages()[0]?.parts).toEqual([
        { type: "text", text: "Visible answer" },
      ]);
    });

    it("should reset with initial messages", () => {
      const initialMessages: UIMessage[] = [
        {
          id: "system-1",
          role: "system",
          parts: [{ type: "text", text: "You are a helpful assistant" }],
        },
      ];

      adapter.reset(initialMessages);

      expect(adapter.getMessages()).toEqual(initialMessages);
    });
  });

  describe("removeLastAssistantMessage", () => {
    it("should remove the last assistant message", () => {
      adapter.addUserMessage("Hello");
      adapter.processEvent({ type: "content_delta", delta: "Hi there!" });

      const removed = adapter.removeLastAssistantMessage();

      expect(removed).not.toBeNull();
      expect(removed?.role).toBe("assistant");
      expect(adapter.getMessages()).toHaveLength(1);
      expect(adapter.getMessages()[0]?.role).toBe("user");
    });

    it("should return null if no assistant message exists", () => {
      adapter.addUserMessage("Hello");

      const removed = adapter.removeLastAssistantMessage();

      expect(removed).toBeNull();
    });
  });

  describe("setMessages", () => {
    it("should set messages directly", () => {
      const messages: UIMessage[] = [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Test" }],
        },
      ];

      adapter.setMessages(messages);

      expect(adapter.getMessages()).toEqual(messages);
      expect(onMessagesUpdate).toHaveBeenCalledWith(messages);
    });

    it("should create a copy of the messages array", () => {
      const messages: UIMessage[] = [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Test" }],
        },
      ];

      adapter.setMessages(messages);
      messages.push({
        id: "msg-2",
        role: "assistant",
        parts: [{ type: "text", text: "Response" }],
      });

      expect(adapter.getMessages()).toHaveLength(1);
    });

    it("should clear messages when setting empty array", () => {
      adapter.addUserMessage("Hello");
      adapter.setMessages([]);

      expect(adapter.getMessages()).toEqual([]);
    });
  });

  describe("complex scenarios", () => {
    const metrics = {
      tokensUsed: 0,
      promptTokens: 0,
      completionTokens: 0,
      itemCount: 0,
      maxTurns: 10,
      duration: 0,
      startTime: Date.now(),
    };

    it("should handle a conversation with tool usage", () => {
      adapter.addUserMessage("Search for TypeScript tutorials");

      adapter.processEvent({ type: "content_delta", delta: "Let me check" });
      adapter.processEvent({
        type: "tool_call_start",
        toolName: "search",
        params: { query: "TypeScript tutorials" },
      });
      adapter.processEvent({
        type: "tool_call_complete",
        toolName: "search",
        result: { results: ["result1", "result2"] },
      });
      adapter.processEvent({
        type: "execution_complete",
        finalOutput: "Found tutorials",
        metrics,
      });

      adapter.addUserMessage("Thanks!");
      adapter.processEvent({
        type: "content_delta",
        delta: "You're welcome",
      });
      adapter.processEvent({
        type: "execution_complete",
        finalOutput: "You're welcome",
        metrics,
      });

      const messages = adapter.getMessages();
      expect(messages).toHaveLength(4);

      const firstAssistant = messages[1];
      const toolPart = firstAssistant?.parts.find((p) => p.type === "tool");
      expect(toolPart).toMatchObject({
        toolName: "search",
        state: "completed",
        output: { results: ["result1", "result2"] },
      });

      const secondAssistant = messages[3];
      expect(secondAssistant?.parts[0]).toMatchObject({
        type: "text",
        text: "You're welcome",
      });
    });

    it("should handle error events", () => {
      adapter.addUserMessage("Test");
      adapter.processEvent({ type: "content_delta", delta: "Starting" });
      adapter.processEvent({
        type: "error",
        error: new AgentError(
          "Connection failed",
          ErrorCode.LLM_API_ERROR,
          false,
        ),
      });

      expect(adapter.getStatus()).toBe("error");
      expect(adapter.getMessages()).toHaveLength(2);
    });

    it("should support regeneration flow", () => {
      adapter.addUserMessage("Hello");
      adapter.processEvent({ type: "content_delta", delta: "Hi there!" });
      adapter.processEvent({
        type: "execution_complete",
        finalOutput: "Hi there!",
        metrics,
      });

      expect(adapter.getMessages()).toHaveLength(2);

      const removed = adapter.removeLastAssistantMessage();
      expect(removed?.role).toBe("assistant");

      adapter.processEvent({
        type: "content_delta",
        delta: "Hello! How can I help?",
      });
      adapter.processEvent({
        type: "execution_complete",
        finalOutput: "Hello! How can I help?",
        metrics,
      });

      const messages = adapter.getMessages();
      expect(messages).toHaveLength(2);
      const textPart = messages[1]?.parts.find((p) => p.type === "text");
      expect(textPart).toMatchObject({ text: "Hello! How can I help?" });
    });
  });

  describe("callback behavior", () => {
    it("should not fail without callbacks", () => {
      const adapterNoCallbacks = createChatAdapter();

      expect(() => {
        adapterNoCallbacks.addUserMessage("Test");
        adapterNoCallbacks.processEvent({ type: "content_delta", delta: "Hi" });
        adapterNoCallbacks.reset();
      }).not.toThrow();
    });

    it("should call onMessagesUpdate for each message change", () => {
      adapter.addUserMessage("First");
      adapter.addUserMessage("Second");

      expect(onMessagesUpdate).toHaveBeenCalledTimes(2);
    });

    it("should call onStatusChange on reset", () => {
      adapter.processEvent({ type: "content_delta", delta: "Hi" });
      (onStatusChange as ReturnType<typeof vi.fn>).mockClear();

      adapter.reset();

      expect(onStatusChange).toHaveBeenCalledWith("idle");
    });
  });
});

describe("interrupted turn isolation", () => {
  let adapter: ChatAdapter;

  beforeEach(() => {
    adapter = createChatAdapter();
  });

  it("streams the next response into a NEW message after an interrupted run", () => {
    // First turn: response starts streaming but never completes (no
    // execution_complete — e.g. the user hit stop).
    adapter.addUserMessage("ilk soru");
    adapter.processEvent({ type: "content_delta", delta: "yarım kalan cevap" });
    const interrupted = adapter.getMessages();
    const firstAssistantId = interrupted[1]?.id;
    expect(interrupted[1]?.role).toBe("assistant");

    adapter.abortTurn();
    adapter.setStatus("idle");

    // Second turn must NOT continue inside the first assistant bubble.
    adapter.addUserMessage("ikinci soru");
    adapter.processEvent({ type: "content_delta", delta: "yeni cevap" });

    const messages = adapter.getMessages();
    expect(messages).toHaveLength(4);
    expect(messages[2]?.role).toBe("user");
    expect(messages[3]?.role).toBe("assistant");
    expect(messages[3]?.id).not.toBe(firstAssistantId);
    expect(messages[3]?.parts[0]).toMatchObject({
      type: "text",
      text: "yeni cevap",
    });
    // The interrupted bubble keeps only its partial text.
    expect(messages[1]?.parts[0]).toMatchObject({
      type: "text",
      text: "yarım kalan cevap",
    });
  });

  it("does not route a stale queued tool result into the old turn", () => {
    // First turn queues a tool call that never completes.
    adapter.addUserMessage("aramayı başlat");
    adapter.processEvent({
      type: "tool_call_start",
      toolName: "search",
      params: { query: "eski" },
    });
    const firstTurnTool = adapter
      .getMessages()[1]
      ?.parts.find((p): p is UIToolPart => p.type === "tool");
    expect(firstTurnTool?.state).toBe("executing");

    // New user turn clears the stale queue; a completion for the same tool
    // name from the aborted run must be a no-op.
    adapter.addUserMessage("yeni tur");
    adapter.processEvent({
      type: "tool_call_complete",
      toolName: "search",
      result: { ok: true },
    });

    const oldTool = adapter
      .getMessages()[1]
      ?.parts.find((p): p is UIToolPart => p.type === "tool");
    expect(oldTool?.state).toBe("executing");
    expect(oldTool?.output).toBeUndefined();
  });

  it("even without an explicit abort, a new user message starts a fresh assistant bubble", () => {
    adapter.addUserMessage("soru 1");
    adapter.processEvent({ type: "content_delta", delta: "cevap 1" });
    // Stream drops without execution_complete and without abortTurn.

    adapter.addUserMessage("soru 2");
    adapter.processEvent({ type: "content_delta", delta: "cevap 2" });

    const messages = adapter.getMessages();
    expect(messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(messages[1]?.parts[0]).toMatchObject({ text: "cevap 1" });
    expect(messages[3]?.parts[0]).toMatchObject({ text: "cevap 2" });
  });
});

describe("visible error notices", () => {
  let adapter: ChatAdapter;

  beforeEach(() => {
    adapter = createChatAdapter();
  });

  it("surfaces a run-level error as a message instead of silently dropping it", () => {
    adapter.addUserMessage("soru");
    adapter.processEvent({
      type: "error",
      error: new AgentError(
        "gateway connection refused",
        ErrorCode.LLM_API_ERROR,
        false,
      ),
    });

    const messages = adapter.getMessages();
    const assistant = messages[messages.length - 1];
    expect(assistant?.role).toBe("assistant");
    const textPart = assistant?.parts.find((p) => p.type === "text");
    expect(textPart).toMatchObject({
      text: "⚠️ gateway connection refused",
    });
    expect(adapter.getStatus()).toBe("error");
  });

  it("appends the notice to a partially streamed response", () => {
    adapter.addUserMessage("soru");
    adapter.processEvent({ type: "content_delta", delta: "yarım cevap" });
    adapter.processEvent({
      type: "error",
      error: new AgentError("stream dropped", ErrorCode.LLM_API_ERROR, false),
    });

    const assistant = adapter.getMessages()[1];
    const texts = assistant?.parts.filter((p) => p.type === "text");
    expect(texts).toHaveLength(2);
    expect(texts?.[1]).toMatchObject({ text: "⚠️ stream dropped" });
  });

  it("does not stack duplicate notices for the same failure", () => {
    adapter.addUserMessage("soru");
    adapter.processEvent({
      type: "error",
      error: new AgentError("boom", ErrorCode.LLM_API_ERROR, false),
    });
    adapter.appendErrorNotice(new Error("boom"));

    const all = adapter
      .getMessages()
      .flatMap((m) => m.parts)
      .filter((p) => p.type === "text" && p.text.startsWith("⚠️"));
    expect(all).toHaveLength(1);
  });
});

describe("removeLastAssistantTurn", () => {
  let adapter: ChatAdapter;

  beforeEach(() => {
    adapter = createChatAdapter();
  });

  it("removes ALL trailing assistant messages, not just the last one", () => {
    adapter.addUserMessage("soru");
    // Tool batch message…
    adapter.processEvent({
      type: "tool_call_start",
      toolName: "search",
      params: {},
    });
    adapter.processEvent({
      type: "tool_call_complete",
      toolName: "search",
      result: { ok: true },
    });
    // …then text after tools starts a SECOND assistant message.
    adapter.processEvent({ type: "content_delta", delta: "cevap" });
    expect(adapter.getMessages()).toHaveLength(3);

    expect(adapter.removeLastAssistantTurn()).toBe(true);

    const remaining = adapter.getMessages();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.role).toBe("user");
  });

  it("stops at the previous turn's user message", () => {
    adapter.addUserMessage("ilk");
    adapter.processEvent({ type: "content_delta", delta: "ilk cevap" });
    adapter.processEvent({
      type: "execution_complete",
      finalOutput: "ilk cevap",
      metrics: { totalTokens: 0, inputTokens: 0, outputTokens: 0 } as never,
    });
    adapter.addUserMessage("ikinci");
    adapter.processEvent({ type: "content_delta", delta: "ikinci cevap" });

    expect(adapter.removeLastAssistantTurn()).toBe(true);

    const roles = adapter.getMessages().map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user"]);
  });

  it("returns false when there is no trailing assistant message", () => {
    adapter.addUserMessage("soru");
    expect(adapter.removeLastAssistantTurn()).toBe(false);
    expect(adapter.getMessages()).toHaveLength(1);
  });
});
