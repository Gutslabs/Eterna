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
          run: {
            runId: "r9",
            userText: "search kintara",
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

  it("attachActiveRun resolves null when there is no run", async () => {
    const host = fakeHostPort();
    const agent = new RemoteBrowserAgent(() => host.port);

    host.setInboundHandler((m) => {
      if (m.type === "attach") {
        host.emit({ type: "no_active_run" });
      }
    });

    await expect(agent.attachActiveRun()).resolves.toBeNull();
  });
});
