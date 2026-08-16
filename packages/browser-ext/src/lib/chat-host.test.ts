import type { AgentEvent } from "@eterna/core";
import { describe, expect, it, vi } from "vitest";
import {
  type ChatHostAgent,
  type ChatPortLike,
  createChatHost,
} from "./chat-host";
import type { ChatHostInbound, ChatHostOutbound } from "./chat-port-protocol";

function fakePort() {
  const sent: ChatHostOutbound[] = [];
  let messageListener: ((m: ChatHostInbound) => void) | null = null;
  let disconnectListener: (() => void) | null = null;
  const port: ChatPortLike = {
    postMessage: (m) => {
      sent.push(m);
    },
    onMessage: {
      addListener: (fn) => {
        messageListener = fn;
      },
    },
    onDisconnect: {
      addListener: (fn) => {
        disconnectListener = fn;
      },
    },
  };
  return {
    port,
    sent,
    send: (m: ChatHostInbound) => messageListener?.(m),
    disconnect: () => disconnectListener?.(),
  };
}

/** Agent whose chat() generator is fed step-by-step from the test. */
function scriptedAgent() {
  const queue: Array<AgentEvent | null> = [];
  const waiters: Array<(v: AgentEvent | null) => void> = [];
  const push = (e: AgentEvent | null) => {
    const waiter = waiters.shift();
    if (waiter) waiter(e);
    else queue.push(e);
  };
  const next = (): Promise<AgentEvent | null> => {
    const item = queue.shift();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise((resolve) => waiters.push(resolve));
  };
  let generatorClosed = false;
  const rollback = vi.fn(async () => true);
  const deleteSession = vi.fn(async () => undefined);
  const agent: ChatHostAgent = {
    async *chat() {
      try {
        while (true) {
          const event = await next();
          if (event === null) return;
          yield event;
        }
      } finally {
        generatorClosed = true;
      }
    },
    rollbackLastAssistantTurn: rollback,
    getConversationManager: () => ({ deleteSession }),
  };
  return {
    agent,
    push,
    rollback,
    deleteSession,
    wasClosed: () => generatorClosed,
  };
}

const delta = (text: string): AgentEvent => ({
  type: "content_delta",
  delta: text,
});

describe("createChatHost", () => {
  it("reports cleanly finished turns to onTurnComplete", async () => {
    const scripted = scriptedAgent();
    const onTurnComplete = vi.fn();
    const host = createChatHost({
      createAgent: async () => scripted.agent,
      onTurnComplete,
    });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r1",
      text: "remember this",
      options: {},
    });
    scripted.push({ type: "session_created", sessionId: "s1" });
    scripted.push(delta("Noted."));
    scripted.push(null);

    await vi.waitFor(() => {
      expect(onTurnComplete).toHaveBeenCalledTimes(1);
    });
    const run = onTurnComplete.mock.calls[0]?.[0];
    expect(run.userText).toBe("remember this");
    expect(run.sessionId).toBe("s1");
    expect(
      run.events.some((e: { type: string }) => e.type === "content_delta"),
    ).toBe(true);
  });

  it("skips onTurnComplete for interrupted turns", async () => {
    const scripted = scriptedAgent();
    const onTurnComplete = vi.fn();
    const host = createChatHost({
      createAgent: async () => scripted.agent,
      onTurnComplete,
    });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r1",
      text: "hi",
      options: {},
    });
    scripted.push(delta("partial"));
    ui.send({ type: "interrupt", clientId: "c1", runId: "r1" });

    await vi.waitFor(() => {
      expect(ui.sent.some((m) => m.type === "turn_done")).toBe(true);
    });
    expect(onTurnComplete).not.toHaveBeenCalled();
  });

  it("streams a turn to the attached port and buffers it for replay", async () => {
    const scripted = scriptedAgent();
    const host = createChatHost({ createAgent: async () => scripted.agent });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r1",
      text: "hi",
      options: {},
    });
    scripted.push({ type: "session_created", sessionId: "s1" });
    scripted.push(delta("Hello"));
    scripted.push(null);

    await vi.waitFor(() => {
      expect(ui.sent.some((m) => m.type === "turn_done")).toBe(true);
    });

    const events = ui.sent.filter((m) => m.type === "event");
    expect(events.map((m) => (m.type === "event" ? m.event.type : ""))).toEqual(
      ["session_created", "content_delta"],
    );

    const run = host.getCurrentRun();
    expect(run?.done).toBe(true);
    expect(run?.sessionId).toBe("s1");
    expect(run?.events).toHaveLength(2);
    // The UI port stayed connected through completion.
    expect(run?.completedDetached).toBe(false);
  });

  it("marks a run completedDetached when it finishes with no ports", async () => {
    const scripted = scriptedAgent();
    const host = createChatHost({ createAgent: async () => scripted.agent });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r1",
      text: "hi",
      options: {},
    });
    scripted.push(delta("partial"));
    await vi.waitFor(() => {
      expect(ui.sent.some((m) => m.type === "event")).toBe(true);
    });

    // Page refresh: the sidebar port dies, the run keeps going.
    ui.disconnect();
    scripted.push(delta(" rest"));
    scripted.push(null);

    await vi.waitFor(() => {
      expect(host.getCurrentRun()?.done).toBe(true);
    });
    const run = host.getCurrentRun();
    expect(run?.completedDetached).toBe(true);
    expect(run?.events).toEqual([delta("partial rest")]);
  });

  it("replays the buffer to a late-attaching port and keeps streaming live", async () => {
    const scripted = scriptedAgent();
    const host = createChatHost({ createAgent: async () => scripted.agent });
    const first = fakePort();
    host.handlePort(first.port);

    first.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r1",
      text: "hi",
      options: {},
    });
    scripted.push(delta("one"));
    await vi.waitFor(() => {
      expect(first.sent.filter((m) => m.type === "event")).toHaveLength(1);
    });
    first.disconnect();

    const second = fakePort();
    host.handlePort(second.port);
    second.send({ type: "attach", clientId: "c1", requestId: "a1" });

    const replay = second.sent.find((m) => m.type === "replay");
    expect(replay).toBeDefined();
    if (replay?.type === "replay") {
      expect(replay.run.done).toBe(false);
      expect(replay.run.events).toHaveLength(1);
      expect(replay.run.userText).toBe("hi");
    }

    scripted.push(delta("two"));
    scripted.push(null);
    await vi.waitFor(() => {
      expect(second.sent.some((m) => m.type === "turn_done")).toBe(true);
    });
    const liveEvents = second.sent.filter((m) => m.type === "event");
    expect(liveEvents).toHaveLength(1);
  });

  it("coalesces adjacent stream deltas in the replay buffer and on the wire", async () => {
    const scripted = scriptedAgent();
    const host = createChatHost({
      createAgent: async () => scripted.agent,
      maxBufferedEvents: 4,
    });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r1",
      text: "hi",
      options: {},
    });
    scripted.push({ type: "session_created", sessionId: "s1" });
    scripted.push({ type: "reasoning_delta", delta: "Checking " });
    scripted.push({ type: "reasoning_delta", delta: "the response." });
    scripted.push(delta("They are both killing Base"));
    scripted.push(delta(", and it"));
    scripted.push(delta(" needs to stop."));
    scripted.push({
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
    scripted.push(null);

    await vi.waitFor(() => {
      expect(host.getCurrentRun()?.done).toBe(true);
    });

    const run = host.getCurrentRun();
    expect(run?.truncated).toBe(false);
    expect(run?.events).toHaveLength(4);
    expect(run?.events[1]).toEqual({
      type: "reasoning_delta",
      delta: "Checking the response.",
    });
    expect(run?.events[2]).toEqual(
      delta("They are both killing Base, and it needs to stop."),
    );

    // Deltas are coalesced on the wire too (one port message per flush window
    // instead of one per token). What must hold is that the streamed text
    // arrives complete and in order.
    const liveDeltas = ui.sent.filter(
      (message) =>
        message.type === "event" && message.event.type === "content_delta",
    );
    expect(liveDeltas.length).toBeGreaterThan(0);
    expect(
      liveDeltas
        .map((message) =>
          message.type === "event" && message.event.type === "content_delta"
            ? message.event.delta
            : "",
        )
        .join(""),
    ).toBe("They are both killing Base, and it needs to stop.");
  });

  it("flushes buffered deltas before a following non-delta event", async () => {
    const scripted = scriptedAgent();
    const host = createChatHost({ createAgent: async () => scripted.agent });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r1",
      text: "hi",
      options: {},
    });
    scripted.push(delta("before"));
    scripted.push({
      type: "tool_call_start",
      toolName: "read_page",
      params: {},
    });
    scripted.push(delta("after"));
    scripted.push(null);

    await vi.waitFor(() => {
      expect(host.getCurrentRun()?.done).toBe(true);
    });

    const wireTypes = ui.sent
      .filter((message) => message.type === "event")
      .map((message) => (message.type === "event" ? message.event.type : ""));
    expect(wireTypes).toEqual([
      "content_delta",
      "tool_call_start",
      "content_delta",
    ]);
  });

  it("rejects a second turn while one is active", async () => {
    const scripted = scriptedAgent();
    const host = createChatHost({ createAgent: async () => scripted.agent });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r1",
      text: "hi",
      options: {},
    });
    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r2",
      text: "again",
      options: {},
    });

    const rejection = ui.sent.find((m) => m.type === "start_rejected");
    expect(rejection).toMatchObject({ runId: "r2", reason: "busy" });

    scripted.push(null);
    await vi.waitFor(() => {
      expect(host.getCurrentRun()?.done).toBe(true);
    });
  });

  it("keeps a detached run alive while a new run streams independently", async () => {
    const first = scriptedAgent();
    const second = scriptedAgent();
    const onActiveChange = vi.fn();
    const createAgent = vi
      .fn<() => Promise<ChatHostAgent>>()
      .mockResolvedValueOnce(first.agent)
      .mockResolvedValueOnce(second.agent);
    const host = createChatHost({ createAgent, onActiveChange });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r1",
      text: "first",
      options: {},
    });
    await vi.waitFor(() => {
      expect(createAgent).toHaveBeenCalledTimes(1);
    });
    ui.send({
      type: "detach",
      clientId: "c1",
      runId: "r1",
      conversationId: "conv_1",
    });
    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r2",
      text: "second",
      options: {},
    });
    await vi.waitFor(() => {
      expect(createAgent).toHaveBeenCalledTimes(2);
    });

    first.push(delta("old answer"));
    second.push(delta("new answer"));
    await vi.waitFor(() => {
      const eventRunIds = ui.sent
        .filter((message) => message.type === "event")
        .map((message) => (message.type === "event" ? message.runId : ""));
      expect(eventRunIds).toEqual(expect.arrayContaining(["r1", "r2"]));
    });

    first.push(null);
    await vi.waitFor(() => {
      expect(host.getRun("r1", "c1")?.done).toBe(true);
    });
    expect(host.getRun("r1", "c1")?.completedDetached).toBe(true);
    expect(host.getRun("r2", "c1")?.done).toBe(false);
    expect(onActiveChange).toHaveBeenCalledWith(true);
    expect(onActiveChange).not.toHaveBeenCalledWith(false);
    expect(
      ui.sent.some(
        (message) =>
          message.type === "start_rejected" && message.runId === "r2",
      ),
    ).toBe(false);

    second.push(null);
    await vi.waitFor(() => {
      expect(host.getRun("r2", "c1")?.done).toBe(true);
    });
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it("waits for the detached snapshot before persisting a completed run", async () => {
    const scripted = scriptedAgent();
    const onRunComplete = vi.fn(async () => undefined);
    const host = createChatHost({
      createAgent: async () => scripted.agent,
      onRunComplete,
    });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r1",
      text: "question",
      options: {},
    });
    ui.send({
      type: "detach",
      clientId: "c1",
      runId: "r1",
      conversationId: "conv_1",
      persistencePending: true,
      userMessageId: "user_1",
    });
    expect(host.getRun("r1", "c1")?.userMessageId).toBe("user_1");
    scripted.push(delta("final answer"));
    scripted.push(null);

    await vi.waitFor(() => {
      expect(host.getRun("r1", "c1")?.done).toBe(true);
    });
    expect(onRunComplete).not.toHaveBeenCalled();

    ui.send({
      type: "bind_conversation",
      clientId: "c1",
      runId: "r1",
      conversationId: "conv_1",
      persistenceReady: true,
      userMessageId: "user_1",
    });
    await vi.waitFor(() => {
      expect(onRunComplete).toHaveBeenCalledTimes(1);
    });
    expect(onRunComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "r1",
        userMessageId: "user_1",
        conversationId: "conv_1",
        done: true,
        completedDetached: true,
        events: [delta("final answer")],
      }),
    );
  });

  it("attaches to the run bound to the requested conversation", async () => {
    const first = scriptedAgent();
    const second = scriptedAgent();
    const createAgent = vi
      .fn<() => Promise<ChatHostAgent>>()
      .mockResolvedValueOnce(first.agent)
      .mockResolvedValueOnce(second.agent);
    const host = createChatHost({ createAgent });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r1",
      text: "first",
      options: {},
    });
    ui.send({
      type: "bind_conversation",
      clientId: "c1",
      runId: "r1",
      conversationId: "conv_1",
    });
    ui.send({ type: "detach", clientId: "c1", runId: "r1" });
    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r2",
      text: "second",
      options: {},
    });
    ui.send({
      type: "bind_conversation",
      clientId: "c1",
      runId: "r2",
      conversationId: "conv_2",
    });
    ui.send({ type: "detach", clientId: "c1", runId: "r2" });

    ui.send({
      type: "attach",
      clientId: "c1",
      requestId: "attach_1",
      conversationId: "conv_1",
    });
    expect(ui.sent).toContainEqual(
      expect.objectContaining({
        type: "replay",
        requestId: "attach_1",
        run: expect.objectContaining({
          runId: "r1",
          conversationId: "conv_1",
        }),
      }),
    );

    first.push(null);
    second.push(null);
    await vi.waitFor(() => {
      expect(host.getRun("r1", "c1")?.done).toBe(true);
      expect(host.getRun("r2", "c1")?.done).toBe(true);
    });
  });

  it("ignores a stale consumer detaching after a newer attachment", async () => {
    const first = scriptedAgent();
    const second = scriptedAgent();
    const createAgent = vi
      .fn<() => Promise<ChatHostAgent>>()
      .mockResolvedValueOnce(first.agent)
      .mockResolvedValueOnce(second.agent);
    const host = createChatHost({ createAgent });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r1",
      text: "first",
      options: {},
    });
    ui.send({
      type: "attach",
      clientId: "c1",
      requestId: "older-consumer",
    });
    ui.send({
      type: "attach",
      clientId: "c1",
      requestId: "newer-consumer",
    });
    ui.send({
      type: "detach",
      clientId: "c1",
      runId: "r1",
      consumerId: "older-consumer",
    });
    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "rejected",
      text: "must stay busy",
      options: {},
    });
    expect(ui.sent).toContainEqual({
      type: "start_rejected",
      runId: "rejected",
      reason: "busy",
    });

    ui.send({
      type: "detach",
      clientId: "c1",
      runId: "r1",
      consumerId: "newer-consumer",
    });
    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r2",
      text: "now allowed",
      options: {},
    });
    expect(
      ui.sent.some(
        (message) =>
          message.type === "start_rejected" && message.runId === "r2",
      ),
    ).toBe(false);

    first.push(null);
    second.push(null);
    await vi.waitFor(() => {
      expect(host.getRun("r1", "c1")?.done).toBe(true);
      expect(host.getRun("r2", "c1")?.done).toBe(true);
    });
  });

  it("interrupt closes the agent generator and reports an interrupted turn", async () => {
    const scripted = scriptedAgent();
    const host = createChatHost({ createAgent: async () => scripted.agent });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r1",
      text: "hi",
      options: {},
    });
    scripted.push(delta("partial"));
    await vi.waitFor(() => {
      expect(ui.sent.some((m) => m.type === "event")).toBe(true);
    });

    ui.send({ type: "interrupt", clientId: "c1", runId: "r1" });
    // An async generator suspended on an await only unwinds once that await
    // settles — mirror the real stream delivering one more chunk.
    scripted.push(delta("post-stop"));

    await vi.waitFor(() => {
      expect(ui.sent.some((m) => m.type === "turn_done")).toBe(true);
    });
    const done = ui.sent.find((m) => m.type === "turn_done");
    if (done?.type === "turn_done") {
      expect(done.interrupted).toBe(true);
    }
    expect(scripted.wasClosed()).toBe(true);
  });

  it("does not start the agent when interrupted during async setup", async () => {
    const scripted = scriptedAgent();
    const chat = vi.spyOn(scripted.agent, "chat");
    let releaseAgent: ((agent: ChatHostAgent) => void) | undefined;
    const host = createChatHost({
      createAgent: () =>
        new Promise<ChatHostAgent>((resolve) => {
          releaseAgent = resolve;
        }),
    });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r1",
      text: "hi",
      options: {},
    });
    ui.send({ type: "interrupt", clientId: "c1", runId: "r1" });

    expect(host.getCurrentRun()).toMatchObject({
      done: true,
      interrupted: true,
    });
    releaseAgent?.(scripted.agent);
    await Promise.resolve();
    await Promise.resolve();

    expect(chat).not.toHaveBeenCalled();
  });

  it("does not expose a run to a different sidebar client", async () => {
    const scripted = scriptedAgent();
    const host = createChatHost({ createAgent: async () => scripted.agent });
    const owner = fakePort();
    const other = fakePort();
    host.handlePort(owner.port);
    host.handlePort(other.port);

    owner.send({
      type: "start_turn",
      clientId: "owner",
      runId: "r1",
      text: "private prompt",
      options: {},
    });
    other.send({ type: "attach", clientId: "other", requestId: "a1" });

    expect(other.sent).toContainEqual({
      type: "no_active_run",
      requestId: "a1",
    });
    scripted.push(delta("private response"));
    await vi.waitFor(() => {
      expect(owner.sent.some((message) => message.type === "event")).toBe(true);
    });
    expect(other.sent.some((message) => message.type === "event")).toBe(false);

    scripted.push(null);
    await vi.waitFor(() => {
      expect(host.getCurrentRun()?.done).toBe(true);
    });
  });

  it("binds a conversation id and exposes it on the snapshot", async () => {
    const scripted = scriptedAgent();
    const host = createChatHost({ createAgent: async () => scripted.agent });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r1",
      text: "hi",
      options: {},
    });
    ui.send({
      type: "bind_conversation",
      clientId: "c1",
      runId: "r1",
      conversationId: "conv_42",
    });
    expect(host.getCurrentRun()?.conversationId).toBe("conv_42");

    // Mismatched runId is ignored.
    ui.send({
      type: "bind_conversation",
      clientId: "c1",
      runId: "other",
      conversationId: "conv_43",
    });
    expect(host.getCurrentRun()?.conversationId).toBe("conv_42");

    scripted.push(null);
    await vi.waitFor(() => {
      expect(host.getCurrentRun()?.done).toBe(true);
    });
  });

  it("serializes error events for the JSON port channel", async () => {
    const scripted = scriptedAgent();
    const host = createChatHost({ createAgent: async () => scripted.agent });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({
      type: "start_turn",
      clientId: "c1",
      runId: "r1",
      text: "hi",
      options: {},
    });
    scripted.push({
      type: "error",
      error: new Error("model exploded"),
    } as AgentEvent);
    scripted.push(null);

    await vi.waitFor(() => {
      expect(ui.sent.some((m) => m.type === "turn_done")).toBe(true);
    });
    const errorEvent = ui.sent.find(
      (m) => m.type === "event" && m.event.type === "error",
    );
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === "event" && errorEvent.event.type === "error") {
      // Plain object, not an Error instance — survives JSON serialization.
      expect(errorEvent.event.error).toEqual({
        name: "Error",
        message: "model exploded",
      });
    }
  });

  it("answers rpc calls against the agent", async () => {
    const scripted = scriptedAgent();
    const host = createChatHost({
      createAgent: async () => scripted.agent,
    });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({
      type: "rpc",
      clientId: "c1",
      reqId: "q1",
      method: "rollback_last_assistant_turn",
      args: { sessionId: "s9" },
    });
    ui.send({
      type: "rpc",
      clientId: "c1",
      reqId: "q2",
      method: "delete_session",
      args: { sessionId: "s9" },
    });
    await vi.waitFor(() => {
      expect(ui.sent.filter((m) => m.type === "rpc_result")).toHaveLength(2);
    });
    expect(scripted.rollback).toHaveBeenCalledWith("s9");
    expect(scripted.deleteSession).toHaveBeenCalledWith("s9");
    const results = ui.sent.filter((m) => m.type === "rpc_result");
    expect(results.every((m) => m.type === "rpc_result" && m.ok)).toBe(true);
  });
});
