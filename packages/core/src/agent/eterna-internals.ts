import type { AgentInputItem, RunItemStreamEvent } from "@openai/agents";
import type { AgentMetrics } from "../types.js";
import { AgentError, ErrorCode } from "../utils/errors.js";
import { safeJsonParse } from "../utils/json.js";

/**
 * Gemini 3.x via OpenAI-compatible gateways occasionally leaks its internal
 * thinking into the visible text channel, opening the response with a raw
 * delimiter token observed as "待94>thought\n". When a response's text starts
 * with this marker the whole flow is the model's thought, not the answer.
 */
export const LEAKED_THOUGHT_MARKER = /^[㐀-鿿]\d{1,3}>thought\r?\n/;
/** Buffered-text length at which the marker check is decidable without a newline. */
export const LEAKED_THOUGHT_DECIDE_AT = 16;

/** Consecutive tool failures after which the failure-guard nudge is injected. */
export const FAILURE_NUDGE_THRESHOLD = 3;
/**
 * Transient instruction appended to the model input (never persisted) once
 * tool calls have failed FAILURE_NUDGE_THRESHOLD times in a row, to stop the
 * agent from burning turns on a stuck action. Same role/shape as the summary
 * item the conversation manager injects, so the gateways accept it mid-thread.
 */
export const FAILURE_GUARD_ITEM = {
  type: "message",
  role: "system",
  content:
    "Several tool calls have just failed in a row. Stop calling tools now — tell the user briefly what is blocking you and what they could try next, answering in their language.",
} as AgentInputItem;

export function getToolStatus(item: RunItemStreamEvent["item"]): string {
  const rawItem = (item as unknown as { rawItem?: { status?: string } })
    .rawItem;
  if (rawItem && typeof rawItem.status === "string") {
    return rawItem.status;
  }
  return "completed";
}

export function extractToolName(item: RunItemStreamEvent["item"]): string {
  const raw = (item as unknown as { rawItem?: { name?: string } }).rawItem;
  if (raw && typeof raw.name === "string" && raw.name.length > 0) {
    return raw.name;
  }
  return "tool";
}

export function extractToolArguments(
  item: RunItemStreamEvent["item"],
): unknown {
  const raw = item as unknown as { rawItem?: { arguments?: unknown } };
  const args = raw.rawItem?.arguments;
  if (typeof args === "string") {
    if (args === "") return {};
    const parsed = safeJsonParse<unknown>(args);
    if (parsed !== undefined) return parsed;
    return args;
  }
  return args;
}

export function extractToolOutput(item: RunItemStreamEvent["item"]): unknown {
  const outputCarrier = item as unknown as { output?: unknown };
  if (typeof outputCarrier.output === "string") {
    const parsed = safeJsonParse<unknown>(outputCarrier.output);
    if (parsed !== undefined) return parsed;
    return outputCarrier.output;
  }
  if (outputCarrier.output !== undefined) {
    return outputCarrier.output;
  }

  const rawOutput = (item as unknown as { rawItem?: { output?: unknown } })
    .rawItem?.output;
  if (typeof rawOutput === "string") {
    const parsed = safeJsonParse<unknown>(rawOutput);
    if (parsed !== undefined) return parsed;
    return rawOutput;
  }
  return rawOutput;
}

/**
 * Extract a human-readable failure message from a tool execution.
 * Attempts to find the real error message from various locations in the item,
 * with basic truncation and sanitization.
 */
export function extractToolFailureMessage(
  item: RunItemStreamEvent["item"],
  status: string,
): string {
  const MAX_MESSAGE_LENGTH = 500;

  // Try to extract error message from various sources
  let message: string | undefined;

  // Check item.output for error info
  const outputCarrier = item as unknown as { output?: unknown };
  if (outputCarrier.output !== undefined) {
    message = extractErrorFromValue(outputCarrier.output);
  }

  // Check rawItem.output
  if (!message) {
    const rawOutput = (item as unknown as { rawItem?: { output?: unknown } })
      .rawItem?.output;
    if (rawOutput !== undefined) {
      message = extractErrorFromValue(rawOutput);
    }
  }

  // Check rawItem.error directly
  if (!message) {
    const rawError = (item as unknown as { rawItem?: { error?: unknown } })
      .rawItem?.error;
    if (rawError !== undefined) {
      message = extractErrorFromValue(rawError);
    }
  }

  // Fallback to status-based message
  if (!message) {
    message = `Tool call ${status}`;
  }

  // Truncate and sanitize
  return sanitizeErrorMessage(message, MAX_MESSAGE_LENGTH);
}

/**
 * Extract error message from a value that could be:
 * - A string (possibly JSON)
 * - An Error object
 * - An object with error/message properties
 */
function extractErrorFromValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  // Handle Error objects
  if (value instanceof Error) {
    return value.message;
  }

  // Handle string values
  if (typeof value === "string") {
    // Try to parse as JSON
    const parsed = safeJsonParse<unknown>(value);
    if (parsed !== undefined) {
      return extractErrorFromValue(parsed);
    }
    return value;
  }

  // Handle objects with error-related properties
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;

    // Check for common error patterns
    if (typeof obj.error === "string" && obj.error.length > 0) {
      return obj.error;
    }
    if (typeof obj.message === "string" && obj.message.length > 0) {
      return obj.message;
    }
    if (
      obj.error &&
      typeof obj.error === "object" &&
      typeof (obj.error as Record<string, unknown>).message === "string"
    ) {
      return (obj.error as Record<string, unknown>).message as string;
    }

    // If it's a failure result object, try to extract useful info
    if (obj.success === false) {
      if (typeof obj.error === "string") {
        return obj.error;
      }
      // Return a stringified version as last resort
      try {
        return JSON.stringify(obj);
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

/**
 * Sanitize and truncate error message for safe display.
 * - Truncates to maxLength
 * - Masks potential sensitive patterns (tokens, auth headers)
 */
function sanitizeErrorMessage(message: string, maxLength: number): string {
  let sanitized = message;

  // Mask potential sensitive patterns
  // Authorization headers
  sanitized = sanitized.replace(
    /Authorization:\s*(Bearer\s+)?[^\s,}"\]]+/gi,
    "Authorization: [REDACTED]",
  );
  // API keys patterns
  sanitized = sanitized.replace(
    /(['"](api[_-]?key|apikey|token|secret|password)['"]\s*[=:]\s*['"])[^'"]+(['"])/gi,
    "$1[REDACTED]$3",
  );
  // Bearer tokens in JSON
  sanitized = sanitized.replace(
    /(bearer\s+)[a-zA-Z0-9._-]{20,}/gi,
    "$1[REDACTED]",
  );

  // Truncate if needed
  if (sanitized.length > maxLength) {
    sanitized = `${sanitized.substring(0, maxLength - 3)}...`;
  }

  return sanitized;
}

export function applyUsageMetrics(
  metrics: AgentMetrics,
  result: { rawResponses?: Array<{ usage?: UsageShape }> },
): void {
  const responses = result.rawResponses ?? [];

  // Use the LAST response with usage data (typically the final model response)
  // This represents the total tokens for this execution, not a running sum
  let lastUsage: UsageShape | undefined;
  for (let i = responses.length - 1; i >= 0; i--) {
    const response = responses[i];
    if (response?.usage) {
      lastUsage = response.usage;
      break;
    }
  }

  const promptTokens = lastUsage?.inputTokens ?? 0;
  const completionTokens = lastUsage?.outputTokens ?? 0;

  metrics.promptTokens = promptTokens;
  metrics.completionTokens = completionTokens;
  metrics.tokensUsed = promptTokens + completionTokens;
}

export function normalizeError(error: unknown): AgentError {
  if (error instanceof AgentError) {
    return error;
  }

  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  return new AgentError(message, ErrorCode.LLM_API_ERROR, false, {
    cause: error instanceof Error ? error.stack : error,
  });
}

export interface UsageShape {
  inputTokens?: number;
  outputTokens?: number;
}
