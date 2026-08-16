/**
 * Context utility functions
 */

import type { Context } from "./types";

/**
 * Format contexts for inclusion in the agent prompt
 * Converts Context objects to human-readable text format
 *
 * @param contexts - Array of contexts to format
 * @returns Formatted string suitable for LLM prompt
 *
 * @example
 * ```typescript
 * const contexts = [
 *   { id: "1", type: "page", label: "Homepage", value: "Welcome to..." },
 *   { id: "2", type: "file", label: "config.json", value: "{...}" }
 * ];
 * const formatted = formatContextsForPrompt(contexts);
 * // Returns:
 * // [page: Homepage]
 * // Welcome to...
 * //
 * // [file: config.json]
 * // {...}
 * ```
 */
/**
 * Fingerprint of what a context contributes to the prompt. Two sends with the
 * same fingerprint carry identical text, so the second one has nothing new to
 * tell the model.
 */
export function contextFingerprint(ctx: Context): string {
  const value =
    typeof ctx.value === "string" ? ctx.value : String(ctx.value ?? "");
  // Cheap, stable, and collision-tolerant: a wrong "unchanged" verdict only
  // costs the model a re-read of text it already has earlier in the thread.
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return `${ctx.id}:${ctx.type}:${value.length}:${hash}`;
}

/**
 * Replace contexts the model has already been given with a one-line pointer.
 *
 * A pinned context — the current page above all — rides along on every turn, so
 * without this the full page text is prepended to each message and the same
 * content piles up in the history: paid for, and re-read, once per turn. The
 * pointer keeps the reference alive so a later "summarize this page" still
 * resolves, while the body is sent only when it actually changes.
 */
export function dropUnchangedContexts(
  contexts: Context[],
  alreadySent: ReadonlySet<string>,
): { contexts: Context[]; fingerprints: string[] } {
  const fingerprints = contexts.map(contextFingerprint);
  const next = contexts.map((ctx, index) => {
    const fingerprint = fingerprints[index] as string;
    if (!alreadySent.has(fingerprint)) return ctx;
    return {
      ...ctx,
      value: "(unchanged since earlier in this conversation)",
    };
  });
  return { contexts: next, fingerprints };
}

export function formatContextsForPrompt(contexts: Context[]): string {
  if (contexts.length === 0) return "";

  return contexts
    .map((ctx) => {
      // Convert value to string if it's not already
      let valueStr: string;
      if (typeof ctx.value === "string") {
        valueStr = ctx.value;
      } else if (ctx.value instanceof File) {
        valueStr = `[File: ${ctx.value.name}, Size: ${ctx.value.size} bytes]`;
      } else if (ctx.value instanceof Blob) {
        valueStr = `[Blob: Size: ${ctx.value.size} bytes, Type: ${ctx.value.type}]`;
      } else {
        valueStr = String(ctx.value);
      }

      return `[${ctx.type}: ${ctx.label}]\n${valueStr}`;
    })
    .join("\n\n");
}

/**
 * Check if a value is a valid Context object
 */
export function isContext(value: unknown): value is Context {
  if (!value || typeof value !== "object") return false;

  const obj = value as Record<string, unknown>;
  return (
    typeof obj["id"] === "string" &&
    typeof obj["type"] === "string" &&
    typeof obj["providerId"] === "string" &&
    typeof obj["label"] === "string" &&
    (typeof obj["value"] === "string" ||
      obj["value"] instanceof File ||
      obj["value"] instanceof Blob)
  );
}

/**
 * Resolve context IDs to Context objects
 * Accepts either Context objects or context IDs (strings)
 *
 * @param contextOrIds - Array of Context objects or context ID strings
 * @param getContext - Function to fetch context by ID
 * @returns Promise resolving to array of Context objects
 */
export async function resolveContexts(
  contextOrIds: (Context | string)[],
  getContext: (id: string) => Promise<Context | null>,
): Promise<Context[]> {
  const resolved: Context[] = [];

  for (const item of contextOrIds) {
    if (typeof item === "string") {
      // It's a context ID, fetch it
      const context = await getContext(item);
      if (context) {
        resolved.push(context);
      }
    } else if (isContext(item)) {
      // It's already a Context object
      resolved.push(item);
    }
  }

  return resolved;
}
