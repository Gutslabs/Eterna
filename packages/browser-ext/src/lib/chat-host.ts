/**
 * Background chat host — owns the agent run loop so an in-flight turn
 * survives host-page refresh/navigation. The sidebar UI is a thin view that
 * talks to this host over a chrome.runtime Port (see chat-port-protocol).
 *
 * This module is dependency-injected and chrome-free so the run/replay
 * state machine is unit-testable; chat-host-init.ts wires it to chrome in
 * the service worker.
 */

import type { AgentEvent, ChatOptions } from "@aipexstudio/aipex-core";
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

/** The agent surface the host needs (AIPex satisfies it structurally). */
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
  routeId?: string;
}

export interface ChatHostDeps {
  createAgent(context?: ChatHostAgentContext): Promise<ChatHostAgent>;
  /**
   * Capture the user's current viewport as a data URL (or null when disabled or
   * not possible). Injected so this chrome-free host stays testable; powers the
   * "auto-attach a screenshot to every message" feature.
   */
  captureViewport?(): Promise<string | null>;
  freshGatewayThread?(
    model: string | undefined,
    options?: { resetRemote?: boolean },
  ): void;
  /** Toggled when a run starts/finishes — drives the SW keepalive. */
  onActiveChange?(active: boolean): void;
  /** Persist a completed run that no UI is currently rendering. */
  onRunComplete?(run: RunSnapshot): void | Promise<void>;
  /** How long a finished run stays attachable. Default 10 minutes. */
  retentionMs?: number;
  /** Replay buffer cap; overflowing marks the run truncated. Default 5000. */
  maxBufferedEvents?: number;
}

interface RunState {
  clientId: string;
  runId: string;
  routeId: string;
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
  const sessionRouteIds = new Map<string, string>();
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
  const sessionKey = (clientId: string, sessionId: string): string =>
    `${clientId}\0${sessionId}`;

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
    run.events.push(event);
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
    try {
      const agent = await deps.createAgent({
        clientId: run.clientId,
        runId: run.runId,
        sessionId: run.sessionId ?? undefined,
        routeId: run.routeId,
      });
      if (!isRunnable(run)) return;
      // Auto-attach a fresh viewport screenshot to this turn (when enabled), so
      // the model always sees what's on the user's screen right now. Best-effort:
      // any failure just sends the turn without an ambient image.
      const ambientImage = deps.captureViewport
        ? await deps.captureViewport().catch(() => null)
        : null;
      if (!isRunnable(run)) return;
      const generator = agent.chat(run.userText, {
        sessionId: run.sessionId ?? undefined,
        contexts: run.pendingOptions?.contexts as ChatOptions["contexts"],
        images: run.pendingOptions?.images as ChatOptions["images"],
        ambientImage: ambientImage ?? undefined,
      });
      run.generator = generator;
      for await (const event of generator) {
        if (!isRunnable(run)) break;
        if (
          event.type === "session_created" ||
          event.type === "session_resumed"
        ) {
          run.sessionId = event.sessionId;
          sessionRouteIds.set(
            sessionKey(run.clientId, event.sessionId),
            run.routeId,
          );
        }
        const wire = serializeAgentEvent(event);
        bufferEvent(run, wire);
        broadcast(run, { type: "event", runId: run.runId, event: wire });
      }
    } catch (error) {
      if (!isRunnable(run)) return;
      run.error = error instanceof Error ? error.message : String(error);
      const wire = serializeAgentEvent({
        type: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      } as AgentEvent);
      bufferEvent(run, wire);
      broadcast(run, { type: "event", runId: run.runId, event: wire });
    } finally {
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
            routeId: sessionRouteIds.get(
              sessionKey(message.clientId, targetSessionId),
            ),
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
            routeId: sessionRouteIds.get(
              sessionKey(message.clientId, targetSessionId),
            ),
          });
          await agent.getConversationManager()?.deleteSession(targetSessionId);
          sessionRouteIds.delete(sessionKey(message.clientId, targetSessionId));
          reply(true);
          return;
        }
        case "fresh_gateway_thread": {
          const hasActiveRun = Array.from(runs.values()).some(
            (run) => !run.done,
          );
          const resetRemote = message.args.resetRemote !== false;
          deps.freshGatewayThread?.(
            typeof message.args.model === "string"
              ? message.args.model
              : undefined,
            { resetRemote: resetRemote && !hasActiveRun },
          );
          if (hasActiveRun && resetRemote) {
            reply(
              false,
              undefined,
              "A response is still running in the background.",
            );
            return;
          }
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
          routeId:
            message.options.routeId ??
            (message.options.sessionId
              ? sessionRouteIds.get(
                  sessionKey(message.clientId, message.options.sessionId),
                )
              : undefined) ??
            `${message.clientId}:${message.runId}`,
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
