/**
 * Wire protocol between the sidebar UI and the background chat host.
 *
 * The agent run loop lives in the background service worker so an in-flight
 * turn survives host-page refresh/navigation. The UI talks to it over a
 * long-lived chrome.runtime Port using these messages.
 *
 * Port messages are JSON-serialized by Chrome, so Error instances inside
 * AgentEvents must be flattened before sending and revived on receipt.
 */

import type { AgentEvent, ImageInput } from "@aipexstudio/aipex-core";

export const CHAT_PORT_NAME = "eterna-chat";

/** Plain-JSON replacement for Error fields inside AgentEvents. */
export interface WireError {
  name: string;
  message: string;
  code?: string;
}

export type WireAgentEvent = AgentEvent; // structurally identical; error fields carry WireError at runtime

export interface StartTurnOptions {
  sessionId?: string;
  contexts?: unknown[];
  images?: ImageInput[];
}

export type ChatHostInbound =
  | {
      type: "start_turn";
      runId: string;
      text: string;
      options: StartTurnOptions;
    }
  | { type: "interrupt"; runId: string }
  | { type: "attach" }
  | { type: "bind_conversation"; runId: string; conversationId: string }
  | {
      type: "rpc";
      reqId: string;
      method:
        | "rollback_last_assistant_turn"
        | "delete_session"
        | "fresh_gateway_thread";
      args: Record<string, unknown>;
    };

export interface RunSnapshot {
  runId: string;
  userText: string;
  conversationId: string | null;
  sessionId: string | null;
  done: boolean;
  interrupted: boolean;
  /** True when the run finished with no UI attached (page was reloading). */
  completedDetached: boolean;
  error: string | null;
  /** Whole-turn event buffer from turn start (serialized). */
  events: WireAgentEvent[];
  /** True when the buffer overflowed and replay is no longer faithful. */
  truncated: boolean;
}

export type ChatHostOutbound =
  | { type: "event"; runId: string; event: WireAgentEvent }
  | { type: "turn_done"; runId: string; interrupted: boolean }
  | { type: "start_rejected"; runId: string; reason: "busy" }
  | { type: "replay"; run: RunSnapshot }
  | { type: "no_active_run" }
  | {
      type: "rpc_result";
      reqId: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    };

function toWireError(error: unknown): WireError {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      name: error.name,
      message: error.message,
      ...(typeof code === "string" ? { code } : {}),
    };
  }
  return { name: "Error", message: String(error) };
}

function fromWireError(wire: unknown): Error {
  const w = (wire ?? {}) as Partial<WireError>;
  const error = new Error(w.message ?? "Unknown error");
  if (w.name) error.name = w.name;
  if (w.code) (error as { code?: string }).code = w.code;
  return error;
}

/** Flatten Error instances so the event survives Chrome's JSON port channel. */
export function serializeAgentEvent(event: AgentEvent): WireAgentEvent {
  if (
    event.type === "error" ||
    event.type === "tool_call_error" ||
    event.type === "context_error"
  ) {
    return {
      ...event,
      error: toWireError(event.error),
    } as unknown as WireAgentEvent;
  }
  return event;
}

/** Revive Error fields on events received from the port. */
export function deserializeAgentEvent(event: WireAgentEvent): AgentEvent {
  if (
    event.type === "error" ||
    event.type === "tool_call_error" ||
    event.type === "context_error"
  ) {
    return { ...event, error: fromWireError(event.error) } as AgentEvent;
  }
  return event;
}
