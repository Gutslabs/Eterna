import type { AgentEvent } from "@aipexstudio/aipex-core";
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
  it("streams a turn to the attached port and buffers it for replay", async () => {
    const scripted = scriptedAgent();
    const host = createChatHost({ createAgent: async () => scripted.agent });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({ type: "start_turn", runId: "r1", text: "hi", options: {} });
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

    ui.send({ type: "start_turn", runId: "r1", text: "hi", options: {} });
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
    expect(run?.events).toHaveLength(2);
  });

  it("replays the buffer to a late-attaching port and keeps streaming live", async () => {
    const scripted = scriptedAgent();
    const host = createChatHost({ createAgent: async () => scripted.agent });
    const first = fakePort();
    host.handlePort(first.port);

    first.send({ type: "start_turn", runId: "r1", text: "hi", options: {} });
    scripted.push(delta("one"));
    await vi.waitFor(() => {
      expect(first.sent.filter((m) => m.type === "event")).toHaveLength(1);
    });
    first.disconnect();

    const second = fakePort();
    host.handlePort(second.port);
    second.send({ type: "attach" });

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

  it("rejects a second turn while one is active", async () => {
    const scripted = scriptedAgent();
    const host = createChatHost({ createAgent: async () => scripted.agent });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({ type: "start_turn", runId: "r1", text: "hi", options: {} });
    ui.send({ type: "start_turn", runId: "r2", text: "again", options: {} });

    const rejection = ui.sent.find((m) => m.type === "start_rejected");
    expect(rejection).toMatchObject({ runId: "r2", reason: "busy" });

    scripted.push(null);
    await vi.waitFor(() => {
      expect(host.getCurrentRun()?.done).toBe(true);
    });
  });

  it("interrupt closes the agent generator and reports an interrupted turn", async () => {
    const scripted = scriptedAgent();
    const host = createChatHost({ createAgent: async () => scripted.agent });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({ type: "start_turn", runId: "r1", text: "hi", options: {} });
    scripted.push(delta("partial"));
    await vi.waitFor(() => {
      expect(ui.sent.some((m) => m.type === "event")).toBe(true);
    });

    ui.send({ type: "interrupt", runId: "r1" });
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

  it("binds a conversation id and exposes it on the snapshot", async () => {
    const scripted = scriptedAgent();
    const host = createChatHost({ createAgent: async () => scripted.agent });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({ type: "start_turn", runId: "r1", text: "hi", options: {} });
    ui.send({
      type: "bind_conversation",
      runId: "r1",
      conversationId: "conv_42",
    });
    expect(host.getCurrentRun()?.conversationId).toBe("conv_42");

    // Mismatched runId is ignored.
    ui.send({
      type: "bind_conversation",
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

    ui.send({ type: "start_turn", runId: "r1", text: "hi", options: {} });
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
    const fresh = vi.fn();
    const host = createChatHost({
      createAgent: async () => scripted.agent,
      freshGatewayThread: fresh,
    });
    const ui = fakePort();
    host.handlePort(ui.port);

    ui.send({
      type: "rpc",
      reqId: "q1",
      method: "rollback_last_assistant_turn",
      args: { sessionId: "s9" },
    });
    ui.send({
      type: "rpc",
      reqId: "q2",
      method: "delete_session",
      args: { sessionId: "s9" },
    });
    ui.send({
      type: "rpc",
      reqId: "q3",
      method: "fresh_gateway_thread",
      args: { model: "gemini-3.1-pro-preview" },
    });

    await vi.waitFor(() => {
      expect(ui.sent.filter((m) => m.type === "rpc_result")).toHaveLength(3);
    });
    expect(scripted.rollback).toHaveBeenCalledWith("s9");
    expect(scripted.deleteSession).toHaveBeenCalledWith("s9");
    expect(fresh).toHaveBeenCalledWith("gemini-3.1-pro-preview");
    const results = ui.sent.filter((m) => m.type === "rpc_result");
    expect(results.every((m) => m.type === "rpc_result" && m.ok)).toBe(true);
  });
});
