import type { AgentEvent } from "@aipexstudio/aipex-core";
import { describe, expect, it } from "vitest";
import type { ChatHostInbound, ChatHostOutbound } from "./chat-port-protocol";
import { type ClientPortLike, RemoteBrowserAgent } from "./remote-agent";

/** Fake port where the test plays the background host side. */
function fakeHostPort() {
  const received: ChatHostInbound[] = [];
  const messageListeners: Array<(m: ChatHostOutbound) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  let onInbound: ((m: ChatHostInbound) => void) | null = null;

  const port: ClientPortLike = {
    postMessage: (m) => {
      received.push(m);
      onInbound?.(m);
    },
    disconnect: () => {},
    onMessage: {
      addListener: (fn) => {
        messageListeners.push(fn);
      },
      removeListener: (fn) => {
        const i = messageListeners.indexOf(fn);
        if (i >= 0) messageListeners.splice(i, 1);
      },
    },
    onDisconnect: {
      addListener: (fn) => {
        disconnectListeners.push(fn);
      },
    },
  };

  return {
    port,
    received,
    setInboundHandler: (fn: (m: ChatHostInbound) => void) => {
      onInbound = fn;
    },
    emit: (m: ChatHostOutbound) => {
      for (const listener of [...messageListeners]) listener(m);
    },
    disconnect: () => {
      for (const listener of [...disconnectListeners]) listener();
    },
  };
}

const delta = (text: string): AgentEvent => ({
  type: "content_delta",
  delta: text,
});

describe("RemoteBrowserAgent", () => {
  it("streams a turn's events in order and ends on turn_done", async () => {
    const host = fakeHostPort();
    const agent = new RemoteBrowserAgent(() => host.port);

    host.setInboundHandler((m) => {
      if (m.type === "start_turn") {
        host.emit({ type: "event", runId: m.runId, event: delta("a") });
        host.emit({ type: "event", runId: m.runId, event: delta("b") });
        host.emit({ type: "turn_done", runId: m.runId, interrupted: false });
      }
    });

    const events: AgentEvent[] = [];
    for await (const event of agent.chat("hi")) {
      events.push(event);
    }
    expect(events).toEqual([delta("a"), delta("b")]);
  });

  it("keeps one gateway route until New Chat explicitly rotates it", async () => {
    const host = fakeHostPort();
    const agent = new RemoteBrowserAgent(
      () => host.port,
      "client-route",
      "route-stable",
    );

    host.setInboundHandler((message) => {
      if (message.type === "start_turn") {
        host.emit({
          type: "turn_done",
          runId: message.runId,
          interrupted: false,
        });
      } else if (message.type === "rpc") {
        host.emit({
          type: "rpc_result",
          reqId: message.reqId,
          ok: true,
        });
      }
    });

    for await (const _ of agent.chat("first")) {
      // consume
    }
    for await (const _ of agent.chat("follow up")) {
      // consume
    }

    const beforeNewChat = host.received.filter(
      (message) => message.type === "start_turn",
    );
    expect(beforeNewChat[0]?.options.routeId).toBe("route-stable");
    expect(beforeNewChat[1]?.options.routeId).toBe("route-stable");

    await agent.freshGatewayThread("catgpt-browser", {
      resetRemote: false,
    });
    for await (const _ of agent.chat("new conversation")) {
      // consume
    }

    const afterNewChat = host.received.filter(
      (message) => message.type === "start_turn",
    );
    expect(afterNewChat[2]?.options.routeId).toMatch(/^route-/);
    expect(afterNewChat[2]?.options.routeId).not.toBe("route-stable");
  });

  it("restores the saved gateway route when a conversation is selected", async () => {
    const host = fakeHostPort();
    host.setInboundHandler((message) => {
      if (message.type === "start_turn") {
        host.emit({
          type: "turn_done",
          runId: message.runId,
          interrupted: false,
        });
      }
    });
    const firstAgent = new RemoteBrowserAgent(
      () => host.port,
      "client-first",
      "route-for-saved-chat",
    );

    const firstRun = firstAgent.chat("first");
    for await (const _ of firstRun) {
      // consume
    }
    firstAgent.bindConversation("conversation-route-test", firstRun.runId);

    const restoredAgent = new RemoteBrowserAgent(
      () => host.port,
      "client-restored",
      "unrelated-route",
    );
    restoredAgent.activateGatewayConversation("conversation-route-test");
    for await (const _ of restoredAgent.chat("continue saved chat")) {
      // consume
    }

    const starts = host.received.filter(
      (message) => message.type === "start_turn",
    );
    expect(starts.at(-1)?.options.routeId).toBe("route-for-saved-chat");
  });

  it("ignores events for other runs", async () => {
    const host = fakeHostPort();
    const agent = new RemoteBrowserAgent(() => host.port);

    host.setInboundHandler((m) => {
      if (m.type === "start_turn") {
        host.emit({ type: "event", runId: "other", event: delta("noise") });
        host.emit({ type: "event", runId: m.runId, event: delta("mine") });
        host.emit({ type: "turn_done", runId: m.runId, interrupted: false });
      }
    });

    const events: AgentEvent[] = [];
    for await (const event of agent.chat("hi")) {
      events.push(event);
    }
    expect(events).toEqual([delta("mine")]);
  });

  it("revives error events into Error instances", async () => {
    const host = fakeHostPort();
    const agent = new RemoteBrowserAgent(() => host.port);

    host.setInboundHandler((m) => {
      if (m.type === "start_turn") {
        host.emit({
          type: "event",
          runId: m.runId,
          event: {
            type: "error",
            error: { name: "AgentError", message: "boom" },
          } as unknown as AgentEvent,
        });
        host.emit({ type: "turn_done", runId: m.runId, interrupted: false });
      }
    });

    const events: AgentEvent[] = [];
    for await (const event of agent.chat("hi")) {
      events.push(event);
    }
    const errorEvent = events[0];
    expect(errorEvent?.type).toBe("error");
    if (errorEvent?.type === "error") {
      expect(errorEvent.error).toBeInstanceOf(Error);
      expect(errorEvent.error.message).toBe("boom");
    }
  });

  it("throws when the host rejects a concurrent turn", async () => {
    const host = fakeHostPort();
    const agent = new RemoteBrowserAgent(() => host.port);

    host.setInboundHandler((m) => {
      if (m.type === "start_turn") {
        host.emit({ type: "start_rejected", runId: m.runId, reason: "busy" });
      }
    });

    await expect(async () => {
      for await (const _ of agent.chat("hi")) {
        // consume
      }
    }).rejects.toThrow(/still running/);
  });

  it("sends interrupt to the host when the generator is dropped early", async () => {
    const host = fakeHostPort();
    const agent = new RemoteBrowserAgent(() => host.port);

    host.setInboundHandler((m) => {
      if (m.type === "start_turn") {
        host.emit({ type: "event", runId: m.runId, event: delta("a") });
      }
    });

    const generator = agent.chat("hi");
    const first = await generator.next();
    expect(first.value).toEqual(delta("a"));

    await generator.return(undefined);

    const interrupt = host.received.find((m) => m.type === "interrupt");
    expect(interrupt).toBeDefined();
  });

  it("detaches a generator without interrupting its host-side run", async () => {
    const host = fakeHostPort();
    const agent = new RemoteBrowserAgent(() => host.port, "client-1");

    host.setInboundHandler((message) => {
      if (message.type === "start_turn") {
        host.emit({
          type: "event",
          runId: message.runId,
          event: delta("partial"),
        });
      }
    });

    const generator = agent.chat("first");
    expect(generator.runId).toMatch(/^run_/);
    await generator.next();
    generator.detach({
      conversationId: "conv_1",
      persistencePending: true,
      userMessageId: "user_1",
    });
    await generator.return(undefined);

    expect(host.received).toContainEqual({
      type: "detach",
      clientId: "client-1",
      runId: generator.runId,
      consumerId: generator.runId,
      conversationId: "conv_1",
      persistencePending: true,
      userMessageId: "user_1",
    });
    expect(
      host.received.some(
        (message) =>
          message.type === "interrupt" && message.runId === generator.runId,
      ),
    ).toBe(false);
  });

  it("isolates two simultaneous streams by run id", async () => {
    const host = fakeHostPort();
    const agent = new RemoteBrowserAgent(() => host.port);
    const first = agent.chat("first");
    const second = agent.chat("second");
    const collect = async (stream: AsyncGenerator<AgentEvent>) => {
      const events: AgentEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }
      return events;
    };
    const firstEvents = collect(first);
    const secondEvents = collect(second);

    host.emit({
      type: "event",
      runId: second.runId,
      event: delta("second-only"),
    });
    host.emit({
      type: "event",
      runId: first.runId,
      event: delta("first-only"),
    });
    host.emit({
      type: "turn_done",
      runId: first.runId,
      interrupted: false,
    });
    host.emit({
      type: "turn_done",
      runId: second.runId,
      interrupted: false,
    });

    await expect(firstEvents).resolves.toEqual([delta("first-only")]);
    await expect(secondEvents).resolves.toEqual([delta("second-only")]);
  });

  it("fails the stream when the host port disconnects mid-run", async () => {
    const host = fakeHostPort();
    const agent = new RemoteBrowserAgent(() => host.port);

    host.setInboundHandler((m) => {
      if (m.type === "start_turn") {
        host.emit({ type: "event", runId: m.runId, event: delta("a") });
        queueMicrotask(() => host.disconnect());
      }
    });

    await expect(async () => {
      for await (const _ of agent.chat("hi")) {
        // consume
      }
    }).rejects.toThrow(/disconnected/);
  });

  it("resolves rpcs from rpc_result messages", async () => {
    const host = fakeHostPort();
    const agent = new RemoteBrowserAgent(() => host.port);

    host.setInboundHandler((m) => {
      if (m.type === "rpc") {
        host.emit({
          type: "rpc_result",
          reqId: m.reqId,
          ok: m.method === "rollback_last_assistant_turn",
          result: true,
          error:
            m.method === "rollback_last_assistant_turn" ? undefined : "nope",
        });
      }
    });

    await expect(agent.rollbackLastAssistantTurn("s1")).resolves.toBe(true);
    await expect(
      agent.getConversationManager().deleteSession("s1"),
    ).rejects.toThrow("nope");
  });

  it("attachActiveRun replays buffered events then continues live", async () => {
    const host = fakeHostPort();
    const agent = new RemoteBrowserAgent(() => host.port);

    host.setInboundHandler((m) => {
      if (m.type === "attach") {
        host.emit({
          type: "replay",
          requestId: m.requestId,
          run: {
            runId: "r9",
            userText: "search kintara",
            userMessageId: null,
            conversationId: "conv_1",
            sessionId: "s1",
            done: false,
            interrupted: false,
            completedDetached: false,
            error: null,
            events: [delta("buffered-1"), delta("buffered-2")],
            truncated: false,
          },
        });
      }
    });

    const attachment = await agent.attachActiveRun();
    expect(attachment).not.toBeNull();
    expect(attachment?.userText).toBe("search kintara");
    expect(attachment?.userMessageId).toBeNull();
    expect(attachment?.conversationId).toBe("conv_1");

    const collected: AgentEvent[] = [];
    const consume = (async () => {
      for await (const event of attachment!.events) {
        collected.push(event);
      }
    })();

    await Promise.resolve();
    host.emit({ type: "event", runId: "r9", event: delta("live") });
    host.emit({ type: "turn_done", runId: "r9", interrupted: false });
    await consume;

    expect(collected).toEqual([
      delta("buffered-1"),
      delta("buffered-2"),
      delta("live"),
    ]);
  });

  it("targets attachment and binding at explicit conversation and run ids", async () => {
    const host = fakeHostPort();
    const agent = new RemoteBrowserAgent(() => host.port, "client-1");

    host.setInboundHandler((message) => {
      if (message.type === "attach") {
        expect(message.conversationId).toBe("conv_target");
        host.emit({
          type: "no_active_run",
          requestId: message.requestId,
        });
      }
    });

    await expect(agent.attachActiveRun("conv_target")).resolves.toBeNull();
    agent.bindConversation("conv_target", "run_target", true);
    expect(host.received).toContainEqual({
      type: "bind_conversation",
      clientId: "client-1",
      runId: "run_target",
      conversationId: "conv_target",
      persistenceReady: true,
      userMessageId: undefined,
    });
  });

  it("detaches an attachment before its generator starts using its consumer id", async () => {
    const host = fakeHostPort();
    const agent = new RemoteBrowserAgent(() => host.port, "client-1");

    host.setInboundHandler((message) => {
      if (message.type === "attach") {
        host.emit({
          type: "replay",
          requestId: message.requestId,
          run: {
            runId: "run-attached",
            userText: "question",
            userMessageId: "user-1",
            conversationId: "conv-1",
            sessionId: "session-1",
            done: false,
            interrupted: false,
            completedDetached: false,
            error: null,
            events: [],
            truncated: false,
          },
        });
      }
    });

    const attachment = await agent.attachActiveRun("conv-1");
    expect(attachment).not.toBeNull();
    expect(attachment?.userMessageId).toBe("user-1");
    attachment!.detach({ persistencePending: true });

    const attachRequest = host.received.find(
      (message) => message.type === "attach",
    );
    expect(host.received).toContainEqual({
      type: "detach",
      clientId: "client-1",
      runId: "run-attached",
      consumerId:
        attachRequest?.type === "attach" ? attachRequest.requestId : "",
      conversationId: "conv-1",
      persistencePending: true,
      userMessageId: "user-1",
    });
    expect(host.received.some((message) => message.type === "interrupt")).toBe(
      false,
    );
  });

  it("attachActiveRun resolves null when there is no run", async () => {
    const host = fakeHostPort();
    const agent = new RemoteBrowserAgent(() => host.port);

    host.setInboundHandler((m) => {
      if (m.type === "attach") {
        host.emit({ type: "no_active_run", requestId: m.requestId });
      }
    });

    await expect(agent.attachActiveRun()).resolves.toBeNull();
  });
});
