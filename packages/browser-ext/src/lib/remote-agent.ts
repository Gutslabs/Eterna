/**
 * Port-backed stand-in for the AIPex agent.
 *
 * The real run loop executes in the background service worker (chat-host);
 * this client exposes the slice of the AIPex surface that useChat consumes —
 * chat() as an async generator, rollbackLastAssistantTurn, and
 * getConversationManager().deleteSession — plus attach/replay so the sidebar
 * can re-join a turn that kept running while the page reloaded.
 */

import type { AgentEvent, ChatOptions } from "@aipexstudio/aipex-core";
import {
  CHAT_PORT_NAME,
  type ChatHostInbound,
  type ChatHostOutbound,
  deserializeAgentEvent,
  type RunSnapshot,
} from "./chat-port-protocol";

/** Minimal port surface (chrome.runtime.Port satisfies it). */
export interface ClientPortLike {
  postMessage(message: ChatHostInbound): void;
  disconnect(): void;
  onMessage: {
    addListener(listener: (message: ChatHostOutbound) => void): void;
    removeListener(listener: (message: ChatHostOutbound) => void): void;
  };
  onDisconnect: { addListener(listener: () => void): void };
}

type Connector = () => ClientPortLike;

const defaultConnector: Connector = () =>
  chrome.runtime.connect({ name: CHAT_PORT_NAME }) as unknown as ClientPortLike;

/** Pull-based queue bridging port callbacks into an async generator. */
class AsyncEventQueue<T> {
  private items: T[] = [];
  private waiters: Array<(item: T) => void> = [];

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
    } else {
      this.items.push(item);
    }
  }

  next(): Promise<T> {
    const item = this.items.shift();
    if (item !== undefined) {
      return Promise.resolve(item);
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

type StreamItem =
  | { kind: "event"; event: AgentEvent }
  | { kind: "done" }
  | { kind: "failed"; error: Error };

export interface ActiveRunAttachment {
  runId: string;
  userText: string;
  conversationId: string | null;
  sessionId: string | null;
  done: boolean;
  /** True when the run finished while no UI was attached. */
  completedDetached: boolean;
  truncated: boolean;
  /**
   * Whole-turn event stream: buffered events first, then live ones until the
   * turn finishes. Feed it to attachExternalTurn to rebuild + continue.
   */
  events: AsyncGenerator<AgentEvent>;
}

export class RemoteBrowserAgent {
  private port: ClientPortLike | null = null;
  private portAlive = false;
  private readonly connector: Connector;
  private readonly rpcWaiters = new Map<
    string,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private readonly messageListeners = new Set<
    (message: ChatHostOutbound) => void
  >();
  private nextId = 0;
  private lastRunId: string | null = null;

  constructor(connector: Connector = defaultConnector) {
    this.connector = connector;
  }

  private newId(prefix: string): string {
    this.nextId += 1;
    return `${prefix}_${Date.now().toString(36)}_${this.nextId}`;
  }

  private ensurePort(): ClientPortLike {
    if (this.port && this.portAlive) {
      return this.port;
    }
    const port = this.connector();
    this.port = port;
    this.portAlive = true;
    port.onMessage.addListener((message) => {
      if (message.type === "rpc_result") {
        const waiter = this.rpcWaiters.get(message.reqId);
        if (waiter) {
          this.rpcWaiters.delete(message.reqId);
          if (message.ok) {
            waiter.resolve(message.result);
          } else {
            waiter.reject(new Error(message.error ?? "RPC failed"));
          }
        }
        return;
      }
      for (const listener of this.messageListeners) {
        listener(message);
      }
    });
    port.onDisconnect.addListener(() => {
      this.portAlive = false;
      this.port = null;
      const disconnectError = new Error("Background chat host disconnected");
      for (const [, waiter] of this.rpcWaiters) {
        waiter.reject(disconnectError);
      }
      this.rpcWaiters.clear();
      for (const listener of this.messageListeners) {
        listener({ type: "__disconnected" } as unknown as ChatHostOutbound);
      }
    });
    return port;
  }

  private rpc<T>(
    method: Extract<ChatHostInbound, { type: "rpc" }>["method"],
    args: Record<string, unknown>,
  ): Promise<T> {
    const port = this.ensurePort();
    const reqId = this.newId("rpc");
    return new Promise<T>((resolve, reject) => {
      this.rpcWaiters.set(reqId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      port.postMessage({ type: "rpc", reqId, method, args });
    });
  }

  /**
   * Stream a turn through the background host. Mirrors AIPex.chat:
   * generator.return() interrupts the run host-side.
   */
  chat(text: string, options?: ChatOptions): AsyncGenerator<AgentEvent> {
    const runId = this.newId("run");
    this.lastRunId = runId;
    const queue = new AsyncEventQueue<StreamItem>();
    let finished = false;

    const listener = (message: ChatHostOutbound): void => {
      if ((message as { type?: string }).type === "__disconnected") {
        queue.push({
          kind: "failed",
          error: new Error(
            "Background chat host disconnected mid-run. The turn may still finish in the background.",
          ),
        });
        return;
      }
      switch (message.type) {
        case "event":
          if (message.runId === runId) {
            queue.push({
              kind: "event",
              event: deserializeAgentEvent(message.event),
            });
          }
          return;
        case "turn_done":
          if (message.runId === runId) {
            queue.push({ kind: "done" });
          }
          return;
        case "start_rejected":
          if (message.runId === runId) {
            queue.push({
              kind: "failed",
              error: new Error(
                "Another response is still running in the background. Stop it or wait for it to finish.",
              ),
            });
          }
          return;
        default:
          return;
      }
    };

    const port = this.ensurePort();
    this.messageListeners.add(listener);
    port.postMessage({
      type: "start_turn",
      runId,
      text,
      options: {
        sessionId: options?.sessionId,
        contexts: options?.contexts as unknown[] | undefined,
        images: options?.images,
      },
    });

    const cleanup = (): void => {
      this.messageListeners.delete(listener);
    };

    const agent = this;
    return (async function* remoteChat(): AsyncGenerator<AgentEvent> {
      try {
        while (true) {
          const item = await queue.next();
          if (item.kind === "done") {
            finished = true;
            return;
          }
          if (item.kind === "failed") {
            finished = true;
            throw item.error;
          }
          yield item.event;
        }
      } finally {
        cleanup();
        if (!finished && agent.portAlive) {
          // Generator dropped early (Stop pressed / chat reset) — abort the
          // host-side run too.
          try {
            agent.ensurePort().postMessage({ type: "interrupt", runId });
          } catch {
            // Host already gone — nothing to interrupt.
          }
        }
      }
    })();
  }

  async rollbackLastAssistantTurn(sessionId: string): Promise<boolean> {
    return await this.rpc<boolean>("rollback_last_assistant_turn", {
      sessionId,
    });
  }

  getConversationManager(): {
    deleteSession(sessionId: string): Promise<void>;
  } {
    return {
      deleteSession: async (sessionId: string): Promise<void> => {
        await this.rpc("delete_session", { sessionId });
      },
    };
  }

  /** Reset the gateway web-thread state host-side (New Chat / restore). */
  async freshGatewayThread(model: string | undefined): Promise<void> {
    await this.rpc("fresh_gateway_thread", { model });
  }

  /**
   * Associate the most recent run started by this client (or the run
   * attached to) with a saved conversation id — best-effort.
   */
  bindConversation(conversationId: string): void {
    if (!this.lastRunId) return;
    try {
      this.ensurePort().postMessage({
        type: "bind_conversation",
        runId: this.lastRunId,
        conversationId,
      });
    } catch {
      // Host gone; binding is best-effort.
    }
  }

  /**
   * Attach to the host's current run (if any): returns the run metadata and
   * a generator that replays buffered events then continues live.
   */
  async attachActiveRun(): Promise<ActiveRunAttachment | null> {
    const port = this.ensurePort();

    const snapshot = await new Promise<RunSnapshot | null>((resolve) => {
      const onReply = (message: ChatHostOutbound): void => {
        if (message.type === "replay") {
          this.messageListeners.delete(onReply);
          resolve(message.run);
        } else if (message.type === "no_active_run") {
          this.messageListeners.delete(onReply);
          resolve(null);
        } else if ((message as { type?: string }).type === "__disconnected") {
          this.messageListeners.delete(onReply);
          resolve(null);
        }
      };
      this.messageListeners.add(onReply);
      port.postMessage({ type: "attach" });
    });

    if (!snapshot) {
      return null;
    }

    this.lastRunId = snapshot.runId;
    const queue = new AsyncEventQueue<StreamItem>();
    const runId = snapshot.runId;
    const listener = (message: ChatHostOutbound): void => {
      if ((message as { type?: string }).type === "__disconnected") {
        queue.push({ kind: "done" });
        return;
      }
      if (message.type === "event" && message.runId === runId) {
        queue.push({
          kind: "event",
          event: deserializeAgentEvent(message.event),
        });
      } else if (message.type === "turn_done" && message.runId === runId) {
        queue.push({ kind: "done" });
      }
    };

    // Live listener registered before consuming the buffer; the host pauses
    // nothing, but events arriving while we replay simply queue up behind.
    if (!snapshot.done) {
      this.messageListeners.add(listener);
    }

    const messageListeners = this.messageListeners;
    const buffered = snapshot.events.map(deserializeAgentEvent);
    const isDone = snapshot.done;

    const events =
      (async function* replayThenLive(): AsyncGenerator<AgentEvent> {
        try {
          for (const event of buffered) {
            yield event;
          }
          if (isDone) {
            return;
          }
          while (true) {
            const item = await queue.next();
            if (item.kind === "done") {
              return;
            }
            if (item.kind === "failed") {
              throw item.error;
            }
            yield item.event;
          }
        } finally {
          messageListeners.delete(listener);
        }
      })();

    return {
      runId: snapshot.runId,
      userText: snapshot.userText,
      conversationId: snapshot.conversationId,
      sessionId: snapshot.sessionId,
      done: snapshot.done,
      completedDetached: snapshot.completedDetached,
      truncated: snapshot.truncated,
      events,
    };
  }
}

let singleton: RemoteBrowserAgent | null = null;

/** Shared client instance for the whole sidebar UI. */
export function getRemoteBrowserAgent(): RemoteBrowserAgent {
  if (!singleton) {
    singleton = new RemoteBrowserAgent();
  }
  return singleton;
}
