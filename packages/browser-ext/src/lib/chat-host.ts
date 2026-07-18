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

export interface ChatHostDeps {
  createAgent(): Promise<ChatHostAgent>;
  /**
   * Capture the user's current viewport as a data URL (or null when disabled or
   * not possible). Injected so this chrome-free host stays testable; powers the
   * "auto-attach a screenshot to every message" feature.
   */
  captureViewport?(): Promise<string | null>;
  freshGatewayThread?(model: string | undefined): void;
  /** Toggled when a run starts/finishes — drives the SW keepalive. */
  onActiveChange?(active: boolean): void;
  /** How long a finished run stays attachable. Default 10 minutes. */
  retentionMs?: number;
  /** Replay buffer cap; overflowing marks the run truncated. Default 5000. */
  maxBufferedEvents?: number;
}

interface RunState {
  clientId: string;
  runId: string;
  userText: string;
  conversationId: string | null;
  sessionId: string | null;
  events: WireAgentEvent[];
  truncated: boolean;
  done: boolean;
  interrupted: boolean;
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
}

export function createChatHost(deps: ChatHostDeps): ChatHost {
  const retentionMs = deps.retentionMs ?? DEFAULT_RETENTION_MS;
  const maxBufferedEvents =
    deps.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS;

  let currentRun: RunState | null = null;
  let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  const ports = new Set<ChatPortLike>();
  const portClients = new Map<ChatPortLike, string>();

  const broadcast = (run: RunState, message: ChatHostOutbound): void => {
    for (const port of ports) {
      if (portClients.get(port) !== run.clientId) continue;
      try {
        port.postMessage(message);
      } catch {
        // Port died between disconnect event and now — drop it.
        ports.delete(port);
      }
    }
  };

  const snapshot = (run: RunState): RunSnapshot => ({
    runId: run.runId,
    userText: run.userText,
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

  const finishRun = (run: RunState): void => {
    if (run.done) return;
    run.done = true;
    run.completedDetached = !Array.from(portClients.values()).includes(
      run.clientId,
    );
    run.generator = null;
    broadcast(run, {
      type: "turn_done",
      runId: run.runId,
      interrupted: run.interrupted,
    });
    deps.onActiveChange?.(false);
    if (cleanupTimer) clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(() => {
      if (currentRun === run && run.done) {
        currentRun = null;
      }
    }, retentionMs);
  };

  const pumpRun = async (run: RunState): Promise<void> => {
    try {
      const agent = await deps.createAgent();
      if (run.done || run.interrupted || currentRun !== run) return;
      // Auto-attach a fresh viewport screenshot to this turn (when enabled), so
      // the model always sees what's on the user's screen right now. Best-effort:
      // any failure just sends the turn without an ambient image.
      const ambientImage = deps.captureViewport
        ? await deps.captureViewport().catch(() => null)
        : null;
      if (run.done || run.interrupted || currentRun !== run) return;
      const generator = agent.chat(run.userText, {
        sessionId: run.sessionId ?? undefined,
        contexts: run.pendingOptions?.contexts as ChatOptions["contexts"],
        images: run.pendingOptions?.images as ChatOptions["images"],
        ambientImage: ambientImage ?? undefined,
      });
      run.generator = generator;
      for await (const event of generator) {
        if (run.done || run.interrupted || currentRun !== run) break;
        if (
          event.type === "session_created" ||
          event.type === "session_resumed"
        ) {
          run.sessionId = event.sessionId;
        }
        const wire = serializeAgentEvent(event);
        bufferEvent(run, wire);
        broadcast(run, { type: "event", runId: run.runId, event: wire });
      }
    } catch (error) {
      if (run.done || run.interrupted || currentRun !== run) return;
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
          const agent = await deps.createAgent();
          const result = await agent.rollbackLastAssistantTurn(
            String(message.args.sessionId ?? ""),
          );
          reply(true, result);
          return;
        }
        case "delete_session": {
          const agent = await deps.createAgent();
          await agent
            .getConversationManager()
            ?.deleteSession(String(message.args.sessionId ?? ""));
          reply(true);
          return;
        }
        case "fresh_gateway_thread": {
          if (
            currentRun &&
            !currentRun.done &&
            currentRun.clientId !== message.clientId
          ) {
            reply(
              false,
              undefined,
              "Another Eterna window is already running.",
            );
            return;
          }
          deps.freshGatewayThread?.(
            typeof message.args.model === "string"
              ? message.args.model
              : undefined,
          );
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
        if (currentRun && !currentRun.done) {
          port.postMessage({
            type: "start_rejected",
            runId: message.runId,
            reason: "busy",
          });
          return;
        }
        if (cleanupTimer) {
          clearTimeout(cleanupTimer);
          cleanupTimer = null;
        }
        const run: RunState = {
          clientId: message.clientId,
          runId: message.runId,
          userText: message.text,
          conversationId: null,
          sessionId: message.options.sessionId ?? null,
          events: [],
          truncated: false,
          done: false,
          interrupted: false,
          completedDetached: false,
          error: null,
          generator: null,
          pendingOptions: {
            contexts: message.options.contexts,
            images: message.options.images,
          },
        };
        currentRun = run;
        deps.onActiveChange?.(true);
        void pumpRun(run);
        return;
      }

      case "interrupt": {
        const run = currentRun;
        if (
          run &&
          run.clientId === message.clientId &&
          run.runId === message.runId &&
          !run.done
        ) {
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

      case "attach": {
        if (currentRun?.clientId === message.clientId) {
          port.postMessage({ type: "replay", run: snapshot(currentRun) });
        } else {
          port.postMessage({ type: "no_active_run" });
        }
        return;
      }

      case "bind_conversation": {
        if (
          currentRun &&
          currentRun.clientId === message.clientId &&
          currentRun.runId === message.runId
        ) {
          currentRun.conversationId = message.conversationId;
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
      return currentRun ? snapshot(currentRun) : null;
    },
  };
}
