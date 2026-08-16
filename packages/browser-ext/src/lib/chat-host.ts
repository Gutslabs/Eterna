/**
 * Background chat host — owns the agent run loop so an in-flight turn
 * survives host-page refresh/navigation. The sidebar UI is a thin view that
 * talks to this host over a chrome.runtime Port (see chat-port-protocol).
 *
 * This module is dependency-injected and chrome-free so the run/replay
 * state machine is unit-testable; chat-host-init.ts wires it to chrome in
 * the service worker.
 */

import type { AgentEvent, ChatOptions } from "@eterna/core";
import {
  type ChatHostInbound,
  type ChatHostOutbound,
  type RunSnapshot,
  serializeAgentEvent,
  type WireAgentEvent,
} from "./chat-port-protocol";

/** Minimal port surface so tests can use fake ports. */
export interface ChatPortLike {
  postMessage(message: ChatHostOutbound): void;
  onMessage: {
    addListener(listener: (message: ChatHostInbound) => void): void;
  };
  onDisconnect: { addListener(listener: () => void): void };
}

/** The agent surface the host needs (Eterna satisfies it structurally). */
export interface ChatHostAgent {
  chat(input: string, options?: ChatOptions): AsyncGenerator<AgentEvent>;
  rollbackLastAssistantTurn(sessionId: string): Promise<boolean>;
  getConversationManager():
    | { deleteSession(sessionId: string): Promise<unknown> }
    | undefined;
}

export interface ChatHostAgentContext {
  clientId: string;
  runId?: string;
  sessionId?: string;
  automationMode?: "focus" | "background";
}

export interface ChatHostDeps {
  createAgent(context?: ChatHostAgentContext): Promise<ChatHostAgent>;
  /**
   * Capture the user's current viewport as a data URL (or null when disabled or
   * not possible). Injected so this chrome-free host stays testable; powers the
   * "auto-attach a screenshot to every message" feature.
   */
  captureViewport?(): Promise<string | null>;
  /** Toggled when a run starts/finishes — drives the SW keepalive. */
  onActiveChange?(active: boolean): void;
  /** Persist a completed run that no UI is currently rendering. */
  onRunComplete?(run: RunSnapshot): void | Promise<void>;
  /**
   * Every cleanly finished turn (attached or detached; not interrupted, not
   * errored). Fire-and-forget — powers conversation auto-capture into memory.
   */
  onTurnComplete?(run: RunSnapshot): void;
  /**
   * Extra context items to attach to a turn based on its user text —
   * deterministic skill routing lives here. Failures must not block the turn.
   */
  resolveTurnContexts?(userText: string): Promise<unknown[]>;
  /** How long a finished run stays attachable. Default 10 minutes. */
  retentionMs?: number;
  /** Replay buffer cap; overflowing marks the run truncated. Default 5000. */
  maxBufferedEvents?: number;
}

interface RunState {
  clientId: string;
  runId: string;
  sequence: number;
  userText: string;
  userMessageId: string | null;
  conversationId: string | null;
  sessionId: string | null;
  events: WireAgentEvent[];
  truncated: boolean;
  done: boolean;
  interrupted: boolean;
  detached: boolean;
  attachedConsumerId: string | null;
  persistencePending: boolean;
  persistedConversationId: string | null;
  completedDetached: boolean;
  error: string | null;
  generator: AsyncGenerator<AgentEvent> | null;
  pendingOptions: { contexts?: unknown[]; images?: unknown[] } | null;
}

const DEFAULT_RETENTION_MS = 10 * 60 * 1000;
const DEFAULT_MAX_BUFFERED_EVENTS = 5000;
// Streaming delta coalescing window for the port wire. Below the panel's own
// ~50ms commit throttle, so batching adds no visible latency.
const DELTA_FLUSH_MS = 30;
// A run whose generator produces nothing for this long is treated as stalled
// and force-finished. Without this, one hung model stream pins the keepalive
// forever: the service worker never sleeps again until browser restart.
const RUN_STALL_TIMEOUT_MS = 5 * 60 * 1000;

const BUFFERED_IMAGE_PLACEHOLDER =
  "[image data removed - view screenshot in original message]";

function stripBufferedImages(value: unknown, depth: number): unknown {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    depth > 3
  ) {
    return value;
  }
  const obj = value as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;
  for (const [key, entry] of Object.entries(obj)) {
    if (
      key === "imageData" &&
      typeof entry === "string" &&
      entry.startsWith("data:image/")
    ) {
      next ??= { ...obj };
      next[key] = BUFFERED_IMAGE_PLACEHOLDER;
    } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const stripped = stripBufferedImages(entry, depth + 1);
      if (stripped !== entry) {
        next ??= { ...obj };
        next[key] = stripped;
      }
    }
  }
  return next ?? value;
}

/**
 * The replay buffer keeps events for ten minutes; a screenshot-heavy run would
 * otherwise pin megabytes of base64 in the worker heap for that whole window.
 * The bytes are already durable in screenshot storage under `screenshotUid`
 * (the tool saves them at capture time), so replays render from there — only
 * the live broadcast carries the pixels.
 */
function stripBufferedEventImages(event: WireAgentEvent): WireAgentEvent {
  if (event.type !== "tool_call_complete") return event;
  const result = (event as { result?: unknown }).result;
  const stripped = stripBufferedImages(result, 0);
  if (stripped === result) return event;
  return { ...event, result: stripped } as WireAgentEvent;
}

export interface ChatHost {
  handlePort(port: ChatPortLike): void;
  /** Test/debug introspection. */
  getCurrentRun(): RunSnapshot | null;
  /** Test/debug introspection for a specific retained run. */
  getRun(runId: string, clientId?: string): RunSnapshot | null;
}

export function createChatHost(deps: ChatHostDeps): ChatHost {
  const retentionMs = deps.retentionMs ?? DEFAULT_RETENTION_MS;
  const maxBufferedEvents =
    deps.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS;

  const runs = new Map<string, RunState>();
  const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const ports = new Set<ChatPortLike>();
  const portClients = new Map<ChatPortLike, string>();
  let nextSequence = 0;
  let activeRunCount = 0;
  let persistenceTaskCount = 0;
  let activeSignal = false;

  const syncActiveSignal = (): void => {
    const active = activeRunCount + persistenceTaskCount > 0;
    if (active !== activeSignal) {
      activeSignal = active;
      deps.onActiveChange?.(active);
    }
  };

  const runKey = (clientId: string, runId: string): string =>
    `${clientId}\0${runId}`;

  const retainedRun = (clientId: string, runId: string): RunState | undefined =>
    runs.get(runKey(clientId, runId));

  const latestRun = (
    predicate: (run: RunState) => boolean,
  ): RunState | null => {
    let latest: RunState | null = null;
    for (const run of runs.values()) {
      if (predicate(run) && (!latest || run.sequence > latest.sequence)) {
        latest = run;
      }
    }
    return latest;
  };

  const isRunnable = (run: RunState): boolean =>
    runs.get(runKey(run.clientId, run.runId)) === run &&
    !run.done &&
    !run.interrupted;

  const broadcast = (run: RunState, message: ChatHostOutbound): void => {
    for (const port of ports) {
      if (portClients.get(port) !== run.clientId) continue;
      try {
        port.postMessage(message);
      } catch {
        // Port died between disconnect event and now — drop it.
        ports.delete(port);
        portClients.delete(port);
      }
    }
  };

  const snapshot = (run: RunState): RunSnapshot => ({
    runId: run.runId,
    userText: run.userText,
    userMessageId: run.userMessageId,
    conversationId: run.conversationId,
    sessionId: run.sessionId,
    done: run.done,
    interrupted: run.interrupted,
    completedDetached: run.completedDetached,
    error: run.error,
    events: [...run.events],
    truncated: run.truncated,
  });

  const bufferEvent = (run: RunState, event: WireAgentEvent): void => {
    const previous = run.events[run.events.length - 1];
    if (previous?.type === "content_delta" && event.type === "content_delta") {
      run.events[run.events.length - 1] = {
        ...previous,
        delta: previous.delta + event.delta,
      };
      return;
    }
    if (
      previous?.type === "reasoning_delta" &&
      event.type === "reasoning_delta"
    ) {
      run.events[run.events.length - 1] = {
        ...previous,
        delta: previous.delta + event.delta,
      };
      return;
    }

    if (run.events.length >= maxBufferedEvents) {
      run.truncated = true;
      return;
    }
    run.events.push(stripBufferedEventImages(event));
  };

  const persistCompletedRun = (run: RunState): void => {
    const conversationId = run.conversationId;
    if (
      !deps.onRunComplete ||
      !run.done ||
      !run.completedDetached ||
      run.persistencePending ||
      !conversationId ||
      run.persistedConversationId === conversationId
    ) {
      return;
    }

    run.persistedConversationId = conversationId;
    persistenceTaskCount += 1;
    syncActiveSignal();
    void Promise.resolve(deps.onRunComplete(snapshot(run)))
      .catch(() => {
        if (run.persistedConversationId === conversationId) {
          run.persistedConversationId = null;
        }
      })
      .finally(() => {
        persistenceTaskCount = Math.max(0, persistenceTaskCount - 1);
        syncActiveSignal();
      });
  };

  const finishRun = (run: RunState): void => {
    if (run.done) return;
    run.done = true;
    run.completedDetached =
      run.detached || !Array.from(portClients.values()).includes(run.clientId);
    run.generator = null;
    broadcast(run, {
      type: "turn_done",
      runId: run.runId,
      interrupted: run.interrupted,
    });
    if (!run.interrupted && !run.error) {
      deps.onTurnComplete?.(snapshot(run));
    }
    persistCompletedRun(run);
    activeRunCount = Math.max(0, activeRunCount - 1);
    syncActiveSignal();

    const key = runKey(run.clientId, run.runId);
    const existingTimer = cleanupTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);
    const cleanupTimer = setTimeout(() => {
      if (runs.get(key) === run && run.done) {
        runs.delete(key);
      }
      cleanupTimers.delete(key);
    }, retentionMs);
    cleanupTimers.set(key, cleanupTimer);
  };

  const pumpRun = async (run: RunState): Promise<void> => {
    // Streaming deltas are coalesced before hitting the wire: every token as
    // its own port message means one structured-clone IPC per token, while the
    // panel only commits at ~20Hz. Deltas accumulate here and flush at most
    // every DELTA_FLUSH_MS (immediately when a non-delta event or the end of
    // the run needs ordering), cutting port traffic 10-50x.
    let pendingDeltaType: "content_delta" | "reasoning_delta" | null = null;
    let pendingDeltaText = "";
    let deltaFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    const flushPendingDelta = (): void => {
      if (deltaFlushTimer !== null) {
        clearTimeout(deltaFlushTimer);
        deltaFlushTimer = null;
      }
      if (pendingDeltaType === null) return;
      const event: WireAgentEvent =
        pendingDeltaType === "content_delta"
          ? { type: "content_delta", delta: pendingDeltaText }
          : { type: "reasoning_delta", delta: pendingDeltaText };
      pendingDeltaType = null;
      pendingDeltaText = "";
      bufferEvent(run, event);
      broadcast(run, { type: "event", runId: run.runId, event });
    };

    try {
      const agent = await deps.createAgent({
        clientId: run.clientId,
        runId: run.runId,
        sessionId: run.sessionId ?? undefined,
      });
      if (!isRunnable(run)) return;
      // Auto-attach a fresh viewport screenshot to this turn (when enabled), so
      // the model always sees what's on the user's screen right now. Best-effort:
      // any failure just sends the turn without an ambient image.
      const ambientImage = deps.captureViewport
        ? await deps.captureViewport().catch(() => null)
        : null;
      if (!isRunnable(run)) return;
      const routedContexts = deps.resolveTurnContexts
        ? await deps.resolveTurnContexts(run.userText).catch(() => [])
        : [];
      if (!isRunnable(run)) return;
      const baseContexts =
        (run.pendingOptions?.contexts as unknown[] | undefined) ?? [];
      const mergedContexts = [...baseContexts, ...routedContexts];
      const generator = agent.chat(run.userText, {
        sessionId: run.sessionId ?? undefined,
        contexts: (mergedContexts.length > 0
          ? mergedContexts
          : undefined) as ChatOptions["contexts"],
        images: run.pendingOptions?.images as ChatOptions["images"],
        ambientImage: ambientImage ?? undefined,
      });
      run.generator = generator;
      // Inactivity watchdog: the model fetch carries no abort signal, so a
      // stalled SSE stream would otherwise leave this loop awaiting forever
      // with the keepalive held. Force-finishing releases the keepalive and
      // the buffered run; if the stream ever revives, isRunnable() is false
      // and the loop exits on the next event.
      const armStallTimer = (): void => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          if (!isRunnable(run)) return;
          run.interrupted = true;
          run.error ??= "Run stalled: no events from the model stream.";
          void generator.return(undefined as never).catch(() => {});
          flushPendingDelta();
          finishRun(run);
        }, RUN_STALL_TIMEOUT_MS);
      };
      armStallTimer();
      for await (const event of generator) {
        armStallTimer();
        if (!isRunnable(run)) break;
        if (
          event.type === "session_created" ||
          event.type === "session_resumed"
        ) {
          run.sessionId = event.sessionId;
        }
        const wire = serializeAgentEvent(event);
        if (wire.type === "content_delta" || wire.type === "reasoning_delta") {
          if (pendingDeltaType !== wire.type) {
            flushPendingDelta();
            pendingDeltaType = wire.type;
          }
          pendingDeltaText += wire.delta;
          if (deltaFlushTimer === null) {
            deltaFlushTimer = setTimeout(flushPendingDelta, DELTA_FLUSH_MS);
          }
        } else {
          flushPendingDelta();
          bufferEvent(run, wire);
          broadcast(run, { type: "event", runId: run.runId, event: wire });
        }
      }
    } catch (error) {
      flushPendingDelta();
      if (!isRunnable(run)) return;
      run.error = error instanceof Error ? error.message : String(error);
      const wire = serializeAgentEvent({
        type: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      } as AgentEvent);
      bufferEvent(run, wire);
      broadcast(run, { type: "event", runId: run.runId, event: wire });
    } finally {
      clearTimeout(stallTimer);
      flushPendingDelta();
      finishRun(run);
    }
  };

  const handleRpc = async (
    port: ChatPortLike,
    message: Extract<ChatHostInbound, { type: "rpc" }>,
  ): Promise<void> => {
    const reply = (ok: boolean, result?: unknown, error?: string): void => {
      try {
        port.postMessage({
          type: "rpc_result",
          reqId: message.reqId,
          ok,
          result,
          error,
        });
      } catch {
        // Caller port already gone; nothing to deliver to.
      }
    };

    try {
      switch (message.method) {
        case "rollback_last_assistant_turn": {
          const targetSessionId = String(message.args.sessionId ?? "");
          const agent = await deps.createAgent({
            clientId: message.clientId,
            sessionId: targetSessionId,
          });
          const result = await agent.rollbackLastAssistantTurn(targetSessionId);
          reply(true, result);
          return;
        }
        case "delete_session": {
          const targetSessionId = String(message.args.sessionId ?? "");
          const agent = await deps.createAgent({
            clientId: message.clientId,
            sessionId: targetSessionId,
          });
          await agent.getConversationManager()?.deleteSession(targetSessionId);
          reply(true);
          return;
        }
        default:
          reply(false, undefined, `Unknown rpc method`);
      }
    } catch (error) {
      reply(
        false,
        undefined,
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleMessage = (
    port: ChatPortLike,
    message: ChatHostInbound,
  ): void => {
    if ("clientId" in message) {
      portClients.set(port, message.clientId);
    }
    switch (message.type) {
      case "start_turn": {
        const existingRun = retainedRun(message.clientId, message.runId);
        const attachedActiveRun = latestRun(
          (run) =>
            run.clientId === message.clientId && !run.done && !run.detached,
        );
        if (existingRun || attachedActiveRun) {
          port.postMessage({
            type: "start_rejected",
            runId: message.runId,
            reason: "busy",
          });
          return;
        }
        const run: RunState = {
          clientId: message.clientId,
          runId: message.runId,
          sequence: ++nextSequence,
          userText: message.text,
          userMessageId: null,
          conversationId: null,
          sessionId: message.options.sessionId ?? null,
          events: [],
          truncated: false,
          done: false,
          interrupted: false,
          detached: false,
          attachedConsumerId: message.runId,
          persistencePending: false,
          persistedConversationId: null,
          completedDetached: false,
          error: null,
          generator: null,
          pendingOptions: {
            contexts: message.options.contexts,
            images: message.options.images,
          },
        };
        runs.set(runKey(run.clientId, run.runId), run);
        activeRunCount += 1;
        syncActiveSignal();
        void pumpRun(run);
        return;
      }

      case "interrupt": {
        const run = retainedRun(message.clientId, message.runId);
        if (run && !run.done) {
          run.interrupted = true;
          const generator = run.generator;
          if (generator && typeof generator.return === "function") {
            void generator.return(undefined);
          } else {
            // Interrupted before the generator existed (e.g. while the
            // agent was still being built) — finish the run directly.
            finishRun(run);
          }
        }
        return;
      }

      case "detach": {
        const run = retainedRun(message.clientId, message.runId);
        if (run) {
          if (
            message.consumerId &&
            run.attachedConsumerId !== message.consumerId
          ) {
            return;
          }
          run.detached = true;
          run.attachedConsumerId = null;
          if (message.persistencePending !== undefined) {
            run.persistencePending = message.persistencePending;
          }
          if (message.conversationId) {
            run.conversationId = message.conversationId;
          }
          if (message.userMessageId) {
            run.userMessageId = message.userMessageId;
          }
          if (run.done) {
            run.completedDetached = true;
            persistCompletedRun(run);
          }
        }
        return;
      }

      case "attach": {
        const run = message.conversationId
          ? latestRun(
              (candidate) =>
                candidate.clientId === message.clientId &&
                candidate.conversationId === message.conversationId,
            )
          : latestRun(
              (candidate) =>
                candidate.clientId === message.clientId &&
                !candidate.detached &&
                (!candidate.done || candidate.completedDetached),
            );
        if (!run) {
          port.postMessage({
            type: "no_active_run",
            requestId: message.requestId,
          });
          return;
        }
        const replay = snapshot(run);
        port.postMessage({
          type: "replay",
          requestId: message.requestId,
          run: replay,
        });
        run.detached = false;
        run.attachedConsumerId = message.requestId;
        if (run.done) {
          run.completedDetached = false;
        }
        return;
      }

      case "bind_conversation": {
        const run = retainedRun(message.clientId, message.runId);
        if (run) {
          run.conversationId = message.conversationId;
          if (message.userMessageId) {
            run.userMessageId = message.userMessageId;
          }
          if (message.persistenceReady) {
            run.persistencePending = false;
          }
          persistCompletedRun(run);
        }
        return;
      }

      case "rpc": {
        void handleRpc(port, message);
        return;
      }
    }
  };

  return {
    handlePort(port: ChatPortLike): void {
      ports.add(port);
      port.onMessage.addListener((message) => handleMessage(port, message));
      port.onDisconnect.addListener(() => {
        ports.delete(port);
        portClients.delete(port);
      });
    },
    getCurrentRun(): RunSnapshot | null {
      const run = latestRun(() => true);
      return run ? snapshot(run) : null;
    },
    getRun(runId: string, clientId?: string): RunSnapshot | null {
      const run = clientId
        ? retainedRun(clientId, runId)
        : latestRun((candidate) => candidate.runId === runId);
      return run ? snapshot(run) : null;
    },
  };
}
