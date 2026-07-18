import type { AgentEvent, AIPex } from "@aipexstudio/aipex-core";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useChat } from "./use-chat";

const baseMetrics = {
  tokensUsed: 0,
  promptTokens: 0,
  completionTokens: 0,
  itemCount: 0,
  maxTurns: 10,
  duration: 0,
  startTime: 0,
};

function createExecutionCompleteEvent(): AgentEvent {
  return {
    type: "execution_complete",
    finalOutput: "",
    metrics: { ...baseMetrics, startTime: Date.now() },
  };
}

function createEventGenerator(
  events: AgentEvent[],
): AsyncGenerator<AgentEvent> & { return: ReturnType<typeof vi.fn> } {
  let index = 0;
  const generator: AsyncGenerator<AgentEvent> & {
    return: ReturnType<typeof vi.fn>;
  } = {
    async next() {
      if (index < events.length) {
        return { value: events[index++]!, done: false };
      }
      return { value: undefined, done: true } as IteratorReturnResult<any>;
    },
    return: vi.fn(
      async () =>
        ({ value: undefined, done: true }) as IteratorReturnResult<any>,
    ),
    async throw(error) {
      throw error;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    async [Symbol.asyncDispose]() {
      // No-op for test
    },
  };

  return generator;
}

function createThrowingGenerator(
  error: Error,
): AsyncGenerator<AgentEvent> & { return: ReturnType<typeof vi.fn> } {
  const generator: AsyncGenerator<AgentEvent> & {
    return: ReturnType<typeof vi.fn>;
  } = {
    async next() {
      throw error;
    },
    return: vi.fn(
      async () =>
        ({ value: undefined, done: true }) as IteratorReturnResult<any>,
    ),
    async throw(err) {
      throw err;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    async [Symbol.asyncDispose]() {
      // No-op for test
    },
  };

  return generator;
}

function createStreamingGenerator(): AsyncGenerator<AgentEvent> & {
  return: ReturnType<typeof vi.fn>;
} {
  let yieldedSession = false;
  let resolvePending: ((value: IteratorResult<AgentEvent>) => void) | null =
    null;
  const generator: AsyncGenerator<AgentEvent> & {
    return: ReturnType<typeof vi.fn>;
  } = {
    async next() {
      if (!yieldedSession) {
        yieldedSession = true;
        return {
          value: { type: "session_created", sessionId: "session-1" },
          done: false,
        };
      }
      return new Promise<IteratorResult<AgentEvent>>((resolve) => {
        resolvePending = resolve;
      });
    },
    return: vi.fn(
      async () =>
        ({ value: undefined, done: true }) as IteratorReturnResult<any>,
    ),
    async throw(error) {
      throw error;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    async [Symbol.asyncDispose]() {
      // No-op for test
    },
  };

  generator.return.mockImplementation(async () => {
    if (resolvePending) {
      resolvePending({
        value: undefined,
        done: true,
      } as IteratorReturnResult<any>);
      resolvePending = null;
    }
    return { value: undefined, done: true };
  });

  return generator;
}

function setupMockAgent(): {
  agent: AIPex;
  conversationManager: { deleteSession: ReturnType<typeof vi.fn> };
} {
  const conversationManager = {
    deleteSession: vi.fn(),
  };

  const agent = {
    chat: vi.fn(),
    getConversationManager: vi.fn(() => conversationManager),
  } as unknown as AIPex;

  return { agent, conversationManager };
}

const defaultEvents: AgentEvent[] = [
  { type: "session_created", sessionId: "session-1" },
  { type: "content_delta", delta: "Hello" },
  createExecutionCompleteEvent(),
];

function setupDefaultAgent() {
  const setup = setupMockAgent();
  (setup.agent.chat as ReturnType<typeof vi.fn>).mockReturnValue(
    createEventGenerator(defaultEvents),
  );
  return setup;
}

describe("useChat", () => {
  async function renderUseChat(
    agent: AIPex,
    options?: Parameters<typeof useChat>[1],
  ) {
    return renderHook(() => useChat(agent, options));
  }

  it("should send a message and update session id", async () => {
    const { agent } = setupDefaultAgent();
    const { result } = await renderUseChat(agent);

    await act(async () => {
      await result.current.sendMessage("Hi there");
    });

    expect(agent.chat).toHaveBeenCalledWith("Hi there", {
      sessionId: undefined,
      contexts: undefined,
    });
    expect(result.current.sessionId).toBe("session-1");
    expect(result.current.messages[0]?.role).toBe("user");
  });

  it("should not send empty messages", async () => {
    const { agent } = setupDefaultAgent();
    const { result } = await renderUseChat(agent);

    await act(async () => {
      await result.current.sendMessage("   ");
    });

    expect(agent.chat).not.toHaveBeenCalled();
  });

  it("forwards pasted text attachments as model-readable file context", async () => {
    const { agent } = setupDefaultAgent();
    const { result } = await renderUseChat(agent);
    const attachment = {
      type: "file" as const,
      mediaType: "text/plain;charset=utf-8",
      filename: "pasted-text.txt",
      url: "data:text/plain;charset=utf-8;base64,U2XDp2lsaSBUw7xya8OnZSBtZXRpbg==",
    };

    await act(async () => {
      await result.current.sendMessage("", [attachment]);
    });

    expect(agent.chat).toHaveBeenCalledWith("", {
      sessionId: undefined,
      contexts: [
        expect.objectContaining({
          type: "file",
          providerId: "ui-attachment",
          label: "pasted-text.txt",
          value: "Seçili Türkçe metin",
        }),
      ],
    });
    expect(result.current.messages[0]?.parts).toContainEqual(attachment);
  });

  it("should continue an existing conversation with session id", async () => {
    const { agent } = setupDefaultAgent();
    (agent.chat as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(
        createEventGenerator([
          { type: "session_created", sessionId: "session-1" },
          createExecutionCompleteEvent(),
        ]),
      )
      .mockReturnValueOnce(
        createEventGenerator([
          { type: "session_resumed", sessionId: "session-1", itemCount: 2 },
          createExecutionCompleteEvent(),
        ]),
      );

    const { result } = await renderUseChat(agent);

    await act(async () => {
      await result.current.sendMessage("Hello");
    });

    await act(async () => {
      await result.current.continueConversation("Follow up");
    });

    expect(agent.chat).toHaveBeenLastCalledWith("Follow up", {
      sessionId: "session-1",
    });
  });

  it.skip("should interrupt an active stream", async () => {
    const { agent } = setupDefaultAgent();
    const streamingGenerator = createStreamingGenerator();
    (agent.chat as ReturnType<typeof vi.fn>).mockReturnValue(
      streamingGenerator,
    );

    const { result } = await renderUseChat(agent);

    await act(async () => {
      const localPromise = result.current.sendMessage("Processing");
      await result.current.interrupt();
      await localPromise;
    });

    expect(streamingGenerator.return).toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it.skip("should reset chat state and delete the session", async () => {
    const { agent, conversationManager } = setupDefaultAgent();
    const { result } = await renderUseChat(agent);

    await act(async () => {
      await result.current.sendMessage("Hello");
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.sessionId).toBeNull();
    expect(conversationManager.deleteSession).toHaveBeenCalledWith("session-1");
  });

  it.skip("should call message handlers", async () => {
    const onMessageSent = vi.fn();
    const onResponseReceived = vi.fn();
    const { agent } = setupDefaultAgent();
    const { result } = await renderUseChat(agent, {
      handlers: { onMessageSent, onResponseReceived },
    });

    await act(async () => {
      await result.current.sendMessage("Hello");
    });

    expect(onMessageSent).toHaveBeenCalled();
    expect(onResponseReceived).toHaveBeenCalled();
  });

  it.skip("should notify tool handlers for tool events", async () => {
    const { agent } = setupDefaultAgent();
    (agent.chat as ReturnType<typeof vi.fn>).mockReturnValue(
      createEventGenerator([
        { type: "session_created", sessionId: "session-1" },
        { type: "tool_call_start", toolName: "search", params: { q: "ts" } },
        {
          type: "tool_call_complete",
          toolName: "search",
          result: { success: true },
        },
        createExecutionCompleteEvent(),
      ]),
    );

    const onToolExecute = vi.fn();
    const onToolComplete = vi.fn();

    const { result } = await renderUseChat(agent, {
      handlers: { onToolExecute, onToolComplete },
    });

    await act(async () => {
      await result.current.sendMessage("Search something");
    });

    expect(onToolExecute).toHaveBeenCalledWith("search", { q: "ts" });
    expect(onToolComplete).toHaveBeenCalledWith("search", { success: true });
  });

  it.skip("should regenerate the last response", async () => {
    const { agent } = setupDefaultAgent();
    (agent.chat as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(
        createEventGenerator([
          { type: "session_created", sessionId: "session-1" },
          { type: "content_delta", delta: "First response" },
          createExecutionCompleteEvent(),
        ]),
      )
      .mockReturnValueOnce(
        createEventGenerator([
          { type: "session_resumed", sessionId: "session-1", itemCount: 2 },
          { type: "content_delta", delta: "Regenerated response" },
          createExecutionCompleteEvent(),
        ]),
      );

    const { result } = await renderUseChat(agent);

    await act(async () => {
      await result.current.sendMessage("Hello");
    });

    await act(async () => {
      await result.current.regenerate();
    });

    expect(agent.chat).toHaveBeenNthCalledWith(2, "Hello", {
      sessionId: "session-1",
    });
  });

  it.skip("should include context items in user message", async () => {
    const { agent } = setupDefaultAgent();
    const { result } = await renderUseChat(agent);
    const contexts = [
      { id: "ctx-1", type: "page" as const, label: "Page", value: "Content" },
    ];

    await act(async () => {
      await result.current.sendMessage("Summarize", undefined, contexts);
    });

    expect(result.current.messages[0]?.parts[0]?.type).toBe("context");
  });

  it.skip("should call onError when the generator throws", async () => {
    const testError = new Error("boom");
    const { agent } = setupDefaultAgent();
    (agent.chat as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      createThrowingGenerator(testError),
    );

    const onError = vi.fn();
    const { result } = await renderUseChat(agent, { handlers: { onError } });

    await act(async () => {
      await result.current.sendMessage("Hello");
    });

    expect(onError).toHaveBeenCalledWith(testError);
    expect(result.current.status).toBe("error");
  });

  it.skip("should add tool call parts to assistant messages", async () => {
    const { agent } = setupDefaultAgent();
    (agent.chat as ReturnType<typeof vi.fn>).mockReturnValue(
      createEventGenerator([
        { type: "session_created", sessionId: "session-1" },
        { type: "tool_call_start", toolName: "fetch", params: { url: "x" } },
        {
          type: "tool_call_complete",
          toolName: "fetch",
          result: { ok: true },
        },
        createExecutionCompleteEvent(),
      ]),
    );

    const { result } = await renderUseChat(agent);

    await act(async () => {
      await result.current.sendMessage("Fetch data");
    });

    const assistantMessage = result.current.messages.find(
      (message) => message.role === "assistant",
    );
    const toolPart = assistantMessage?.parts.find(
      (part) => part.type === "tool",
    );
    expect(toolPart).toMatchObject({
      type: "tool",
      toolName: "fetch",
      state: "completed",
    });
  });

  it("should update metrics state when metrics_update event is received", async () => {
    const { agent } = setupMockAgent();
    const metricsEvent = {
      type: "metrics_update" as const,
      metrics: {
        tokensUsed: 500,
        promptTokens: 300,
        completionTokens: 200,
        itemCount: 2,
        maxTurns: 10,
        duration: 1500,
        startTime: Date.now(),
      },
      sessionId: "session-1",
    };

    (agent.chat as ReturnType<typeof vi.fn>).mockReturnValue(
      createEventGenerator([
        { type: "session_created", sessionId: "session-1" },
        metricsEvent,
        createExecutionCompleteEvent(),
      ]),
    );

    const { result } = await renderUseChat(agent);

    // Initially null
    expect(result.current.metrics).toBeNull();

    await act(async () => {
      await result.current.sendMessage("Hello");
    });

    // After processing events, metrics should be updated
    expect(result.current.metrics).toEqual(metricsEvent.metrics);
  });

  it("should call onMetricsUpdate handler when metrics_update event is received", async () => {
    const { agent } = setupMockAgent();
    const onMetricsUpdate = vi.fn();
    const metricsEvent = {
      type: "metrics_update" as const,
      metrics: {
        tokensUsed: 1000,
        promptTokens: 600,
        completionTokens: 400,
        itemCount: 3,
        maxTurns: 10,
        duration: 2000,
        startTime: Date.now(),
      },
      sessionId: "session-123",
    };

    (agent.chat as ReturnType<typeof vi.fn>).mockReturnValue(
      createEventGenerator([
        { type: "session_created", sessionId: "session-123" },
        metricsEvent,
        createExecutionCompleteEvent(),
      ]),
    );

    const { result } = await renderUseChat(agent, {
      handlers: { onMetricsUpdate },
    });

    await act(async () => {
      await result.current.sendMessage("Test");
    });

    expect(onMetricsUpdate).toHaveBeenCalledWith(
      metricsEvent.metrics,
      "session-123",
    );
  });

  it("should reset metrics to null on chat reset", async () => {
    const { agent } = setupMockAgent();
    const metricsEvent = {
      type: "metrics_update" as const,
      metrics: {
        tokensUsed: 100,
        promptTokens: 60,
        completionTokens: 40,
        itemCount: 1,
        maxTurns: 10,
        duration: 500,
        startTime: Date.now(),
      },
      sessionId: "session-1",
    };

    (agent.chat as ReturnType<typeof vi.fn>).mockReturnValue(
      createEventGenerator([
        { type: "session_created", sessionId: "session-1" },
        metricsEvent,
        createExecutionCompleteEvent(),
      ]),
    );

    const { result } = await renderUseChat(agent);

    await act(async () => {
      await result.current.sendMessage("Hello");
    });

    expect(result.current.metrics).not.toBeNull();

    act(() => {
      result.current.reset();
    });

    expect(result.current.metrics).toBeNull();
  });

  describe("attachExternalTurn", () => {
    it("rebuilds a turn from an external event stream without an agent", async () => {
      const { result } = renderHook(() => useChat(undefined));

      await act(async () => {
        await result.current.attachExternalTurn(
          createEventGenerator([
            { type: "session_created", sessionId: "session-9" },
            { type: "content_delta", delta: "Recovered " },
            { type: "content_delta", delta: "answer" },
            createExecutionCompleteEvent(),
          ]),
          { userText: "original question" },
        );
      });

      const messages = result.current.messages;
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ role: "user" });
      expect(messages[0]?.parts[0]).toMatchObject({
        type: "text",
        text: "original question",
      });
      expect(messages[1]).toMatchObject({ role: "assistant" });
      expect(messages[1]?.parts[0]).toMatchObject({
        type: "text",
        text: "Recovered answer",
      });
      expect(result.current.sessionId).toBe("session-9");
      expect(result.current.status).toBe("idle");
    });

    it("settles back to idle when the stream ends without execution_complete (interrupted run)", async () => {
      const { result } = renderHook(() => useChat(undefined));

      await act(async () => {
        await result.current.attachExternalTurn(
          createEventGenerator([
            { type: "content_delta", delta: "partial thought" },
          ]),
          { userText: "question" },
        );
      });

      expect(result.current.status).toBe("idle");
      const assistant = result.current.messages.find(
        (m) => m.role === "assistant",
      );
      expect(assistant?.parts[0]).toMatchObject({
        type: "text",
        text: "partial thought",
      });
    });

    it("does not attach while another turn is already streaming", async () => {
      const { agent } = setupMockAgent();
      let releaseTurn!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseTurn = resolve;
      });
      (agent.chat as ReturnType<typeof vi.fn>).mockReturnValue(
        (async function* () {
          yield { type: "content_delta", delta: "busy" } as AgentEvent;
          await gate;
          yield createExecutionCompleteEvent();
        })(),
      );

      const { result } = await renderUseChat(agent);

      let sendPromise: Promise<void> | undefined;
      await act(async () => {
        sendPromise = result.current.sendMessage("Hello");
        // Let the first delta land so the adapter is mid-stream.
        await Promise.resolve();
      });

      const external = createEventGenerator([
        { type: "content_delta", delta: "should not appear" },
      ]);
      await act(async () => {
        await result.current.attachExternalTurn(external);
      });
      expect(external.return).toHaveBeenCalled();

      releaseTurn();
      await act(async () => {
        await sendPromise;
      });
      const allText = JSON.stringify(result.current.messages);
      expect(allText).not.toContain("should not appear");
    });
  });
});
