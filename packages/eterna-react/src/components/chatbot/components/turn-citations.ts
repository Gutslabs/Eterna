/**
 * Derive citation entries for a turn from its web-tool calls.
 *
 * Sources are read at render time from the tool parts the turn already
 * carries (read_url pages), so citations need no new persistence or wire
 * format — saved conversations gain them retroactively. Only successful calls
 * contribute; a page the fetch failed on was never a source.
 */

import type { UIMessage, UIToolPart } from "../../../types";

export interface TurnCitation {
  id: string;
  title: string;
  url: string;
  domain: string;
}

const WEB_TOOL_NAMES = new Set(["read_url"]);

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      return parseRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return null;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function pushCitation(
  found: Map<string, TurnCitation>,
  url: unknown,
  title: unknown,
): void {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
  if (found.has(url)) return;
  const label =
    typeof title === "string" && title.trim() ? title.trim() : domainOf(url);
  found.set(url, {
    id: `citation-${found.size}`,
    title: label,
    url,
    domain: domainOf(url),
  });
}

function collectFromPart(
  found: Map<string, TurnCitation>,
  part: UIToolPart,
): void {
  if (part.state !== "completed" || !WEB_TOOL_NAMES.has(part.toolName)) return;
  const output = parseRecord(part.output);
  if (!output) return;

  // read_url: one page per call. Failed fetches report success:false and are
  // skipped.
  if (output.success === false) return;
  const input = parseRecord(part.input);
  pushCitation(found, output.url ?? input?.url, output.title);
}

export function collectTurnCitations(
  assistantMessages: UIMessage[],
): TurnCitation[] {
  const found = new Map<string, TurnCitation>();
  for (const message of assistantMessages) {
    for (const part of message.parts) {
      if (part.type === "tool") {
        collectFromPart(found, part as UIToolPart);
      }
    }
  }
  return [...found.values()];
}
