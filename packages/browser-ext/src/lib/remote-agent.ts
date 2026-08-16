/**
 * Port-backed stand-in for the Eterna agent.
 *
 * The real run loop executes in the background service worker (chat-host);
 * this client exposes the slice of the Eterna surface that useChat consumes —
 * chat() as an async generator, rollbackLastAssistantTurn, and
 * getConversationManager().deleteSession — plus attach/replay so the sidebar
 * can re-join a turn that kept running while the page reloaded.
 */

import type { AgentEvent, ChatOptions } from "@eterna/core";
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

const CLIENT_ID_KEY = "eterna-chat-client-id";
function createClientId(): string {
  try {
    const existing = globalThis.sessionStorage?.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    globalThis.sessionStorage?.setItem(CLIENT_ID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

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

interface StreamControl {
  suppressInterrupt: boolean;
}

export interface RunDetachOptions {
  conversationId?: string;
  persistencePending?: boolean;
  userMessageId?: string;
}

export type RunEventStream = AsyncGenerator<AgentEvent> & {
  readonly runId: string;
  detach(options?: RunDetachOptions): void;
};

export interface ActiveRunAttachment {
  runId: string;
  userText: string;
  userMessageId: string | null;
  conversationId: string | null;
  sessionId: string | null;
  done: boolean;
  /** True when the run finished while no UI was attached. */
  completedDetached: boolean;
  truncated: boolean;
  /** Stop observing this run while allowing it to continue host-side. */
  detach(options?: RunDetachOptions): void;
  /**
   * Whole-turn event stream: buffered events first, then live ones until the
   * turn finishes. Feed it to attachExternalTurn to rebuild + continue.
   */
  events: RunEventStream;
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
  private readonly streamControls = new Map<string, Set<StreamControl>>();
  private readonly clientId: string;

  constructor(
    connector: Connector = defaultConnector,
    clientId = createClientId(),
  ) {
    this.connector = connector;
    this.clientId = clientId;
  }

  private newId(prefix: string): string {
    this.nextId += 1;
    return `${prefix}_${Date.now().toString(36)}_${this.nextId}`;
  }

  private registerStream(runId: string): StreamControl {
    const control = { suppressInterrupt: false };
    const controls = this.streamControls.get(runId) ?? new Set<StreamControl>();
    controls.add(control);
    this.streamControls.set(runId, controls);
    return control;
  }

  private unregisterStream(runId: string, control: StreamControl): void {
    const controls = this.streamControls.get(runId);
    if (!controls) return;
    controls.delete(control);
    if (controls.size === 0) {
      this.streamControls.delete(runId);
    }
  }

  private suppressStreamInterrupts(runId: string): void {
    for (const control of this.streamControls.get(runId) ?? []) {
      control.suppressInterrupt = true;
    }
  }

  private sendDetach(
    runId: string,
    consumerId: string,
    options: RunDetachOptions = {},
  ): void {
    try {
      this.ensurePort().postMessage({
        type: "detach",
        clientId: this.clientId,
        runId,
        consumerId,
        conversationId: options.conversationId,
        persistencePending: options.persistencePending,
        userMessageId: options.userMessageId,
      });
    } catch {
      // Host gone; local stream cleanup still proceeds.
    }
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
      port.postMessage({
        type: "rpc",
        clientId: this.clientId,
        reqId,
        method,
        args,
      });
    });
  }

  /**
   * Stream a turn through the background host. Mirrors Eterna.chat:
   * generator.return() interrupts the run host-side.
   */
  chat(text: string, options?: ChatOptions): RunEventStream {
    const runId = this.newId("run");
    this.lastRunId = runId;
    const streamControl = this.registerStream(runId);
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
      clientId: this.clientId,
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
    const stream = (async function* remoteChat(): AsyncGenerator<AgentEvent> {
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
        agent.unregisterStream(runId, streamControl);
        if (!finished && !streamControl.suppressInterrupt && agent.portAlive) {
          // Generator dropped early (Stop pressed / chat reset) — abort the
          // host-side run too.
          try {
            agent.ensurePort().postMessage({
              type: "interrupt",
              clientId: agent.clientId,
              runId,
            });
          } catch {
            // Host already gone — nothing to interrupt.
          }
        }
      }
    })();
    return Object.assign(stream, {
      runId,
      detach: (options?: RunDetachOptions) => {
        streamControl.suppressInterrupt = true;
        agent.sendDetach(runId, runId, options);
      },
    });
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

  /**
   * Associate the most recent run started by this client (or the run
   * attached to) with a saved conversation id — best-effort.
   */
  bindConversation(
    conversationId: string,
    runId = this.lastRunId,
    persistenceReady = false,
    userMessageId?: string,
  ): void {
    if (!runId) return;
    try {
      this.ensurePort().postMessage({
        type: "bind_conversation",
        clientId: this.clientId,
        runId,
        conversationId,
        persistenceReady,
        userMessageId,
      });
    } catch {
      // Host gone; binding is best-effort.
    }
  }

  /**
   * Release a run from this UI without cancelling its host-side execution.
   * Closing the matching local generator after this call will not emit an
   * interrupt.
   */
  detachRun(
    runId: string,
    conversationId?: string,
    persistencePending?: boolean,
    consumerId = runId,
    userMessageId?: string,
  ): void {
    this.suppressStreamInterrupts(runId);
    this.sendDetach(runId, consumerId, {
      conversationId,
      persistencePending,
      userMessageId,
    });
  }

  /**
   * Attach to the newest visible run, or to the retained run for a specific
   * conversation. Buffered events are replayed before live events.
   */
  async attachActiveRun(
    conversationId?: string,
  ): Promise<ActiveRunAttachment | null> {
    const port = this.ensurePort();
    const requestId = this.newId("attach");
    const queue = new AsyncEventQueue<StreamItem>();
    let runId: string | null = null;
    let streamListener: ((message: ChatHostOutbound) => void) | null = null;

    const snapshot = await new Promise<RunSnapshot | null>((resolve) => {
      const onReply = (message: ChatHostOutbound): void => {
        if (message.type === "replay" && message.requestId === requestId) {
          runId = message.run.runId;
          if (message.run.done) {
            this.messageListeners.delete(onReply);
          }
          resolve(message.run);
        } else if (
          message.type === "no_active_run" &&
          message.requestId === requestId
        ) {
          this.messageListeners.delete(onReply);
          resolve(null);
        } else if ((message as { type?: string }).type === "__disconnected") {
          this.messageListeners.delete(onReply);
          if (runId) {
            queue.push({ kind: "done" });
          } else {
            resolve(null);
          }
        } else if (message.type === "event" && message.runId === runId) {
          queue.push({
            kind: "event",
            event: deserializeAgentEvent(message.event),
          });
        } else if (message.type === "turn_done" && message.runId === runId) {
          queue.push({ kind: "done" });
        }
      };
      streamListener = onReply;
      this.messageListeners.add(onReply);
      port.postMessage({
        type: "attach",
        clientId: this.clientId,
        requestId,
        conversationId,
      });
    });

    if (!snapshot) {
      return null;
    }

    this.lastRunId = snapshot.runId;

    const messageListeners = this.messageListeners;
    const buffered = snapshot.events.map(deserializeAgentEvent);
    const isDone = snapshot.done;
    const activeRunId = snapshot.runId;
    const agent = this;
    let finished = isDone;
    const streamControl = this.registerStream(activeRunId);
    let released = false;
    const releaseListener = (): void => {
      if (released) return;
      released = true;
      if (streamListener) {
        messageListeners.delete(streamListener);
      }
      agent.unregisterStream(activeRunId, streamControl);
    };
    const detach = (options: RunDetachOptions = {}): void => {
      if (!finished) {
        streamControl.suppressInterrupt = true;
        agent.sendDetach(activeRunId, requestId, {
          conversationId:
            options.conversationId ?? snapshot.conversationId ?? undefined,
          persistencePending: options.persistencePending,
          userMessageId:
            options.userMessageId ?? snapshot.userMessageId ?? undefined,
        });
      }
      releaseListener();
    };

    const events = Object.assign(
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
              finished = true;
              return;
            }
            if (item.kind === "failed") {
              throw item.error;
            }
            yield item.event;
          }
        } finally {
          releaseListener();
          if (
            !finished &&
            !streamControl.suppressInterrupt &&
            agent.portAlive
          ) {
            try {
              agent.ensurePort().postMessage({
                type: "interrupt",
                clientId: agent.clientId,
                runId: activeRunId,
              });
            } catch {
              // Host already gone — nothing to interrupt.
            }
          }
        }
      })(),
      { runId: activeRunId, detach },
    );

    return {
      runId: snapshot.runId,
      userText: snapshot.userText,
      userMessageId: snapshot.userMessageId,
      conversationId: snapshot.conversationId,
      sessionId: snapshot.sessionId,
      done: snapshot.done,
      completedDetached: snapshot.completedDetached,
      truncated: snapshot.truncated,
      detach,
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
