import type { AgentInputItem } from "@openai/agents";

/**
 * Large, re-fetchable READ tools whose old result bodies can be dropped from the
 * model input once newer reads supersede them — the agent can always re-read.
 * Deliberately conservative: excludes uid-bearing tools (search_elements /
 * take_snapshot) and small metadata tools.
 */
const REFETCHABLE_READ_TOOLS = new Set([
  "read_page",
  "read_url",
  "get_youtube_transcript",
]);
const KEEP_RECENT_READS = 6;
const STUB_PREFIX = "[cleared to save context";

function isClearedStub(output: unknown): boolean {
  return typeof output === "string" && output.startsWith(STUB_PREFIX);
}

/** Recover the source URL from a tool call's arguments, when it has one. */
function urlFromArgs(args: unknown): string | undefined {
  let obj: unknown = args;
  if (typeof args === "string") {
    try {
      obj = JSON.parse(args);
    } catch {
      return undefined;
    }
  }
  if (obj && typeof obj === "object") {
    const url = (obj as { url?: unknown }).url;
    if (typeof url === "string") return url;
  }
  return undefined;
}

/**
 * Transiently shrink the model input by replacing OLD re-fetchable read results
 * (read_page / read_url / transcript) with a short stub that keeps the source
 * URL, so the model can re-read on demand. The newest KEEP_RECENT_READS are left
 * intact.
 *
 * Only the function_call_result OUTPUT is replaced — the item and its callId
 * stay, so tool-call/result pairing is never broken. This operates on the model
 * input only (via callModelInputFilter); the persisted session keeps the full
 * bodies, so nothing is lost and the effect is fully reversible. When >80% of a
 * browsing context is re-fetchable read output, clearing beats summarizing: no
 * LLM call, no information destroyed, just deferred.
 */
export function clearStaleReadResults(
  items: AgentInputItem[],
): AgentInputItem[] {
  const callArgsById = new Map<string, unknown>();
  for (const item of items) {
    if (item.type === "function_call") {
      const call = item as { callId?: string; arguments?: unknown };
      if (call.callId) callArgsById.set(call.callId, call.arguments);
    }
  }

  const readResultIndices: number[] = [];
  items.forEach((item, index) => {
    if (item.type === "function_call_result") {
      const name = (item as { name?: string }).name;
      if (name && REFETCHABLE_READ_TOOLS.has(name)) {
        readResultIndices.push(index);
      }
    }
  });

  if (readResultIndices.length <= KEEP_RECENT_READS) return items;

  const indicesToClear = new Set(
    readResultIndices.slice(0, readResultIndices.length - KEEP_RECENT_READS),
  );

  return items.map((item, index) => {
    if (!indicesToClear.has(index)) return item;
    const result = item as { callId?: string; name?: string; output?: unknown };
    if (isClearedStub(result.output)) return item;
    const url = urlFromArgs(callArgsById.get(result.callId ?? ""));
    const stub = url
      ? `${STUB_PREFIX} — re-run ${result.name} for ${url} if you need it again]`
      : `${STUB_PREFIX} — re-run ${result.name} if you need this content again]`;
    return { ...item, output: stub } as AgentInputItem;
  });
}
