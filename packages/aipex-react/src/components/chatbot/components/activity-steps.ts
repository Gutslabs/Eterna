import type { UIMessage, UIToolPart } from "../../../types";

export type ActivityStep =
  | { kind: "thought"; key: string; text: string }
  | { kind: "tool"; key: string; part: UIToolPart };

export type TurnBlock =
  | { type: "activity"; key: string; steps: ActivityStep[] }
  | { type: "message"; key: string; message: UIMessage };

/**
 * Lay a turn's assistant messages out as an ordered sequence of blocks:
 * every non-empty text part is a message bubble IN PLACE, and consecutive
 * runs of tool/reasoning parts (across message boundaries) merge into one
 * activity rail between bubbles.
 *
 * Classification is positional and never changes retroactively — a streamed
 * text bubble stays a bubble even when a tool call follows it. (The previous
 * design reclassified trailing text into a rail "thought" the moment a tool
 * arrived, which made messages visibly vanish mid-read.)
 */
export function buildTurnBlocks(assistantMessages: UIMessage[]): TurnBlock[] {
  const blocks: TurnBlock[] = [];
  let openActivity: { key: string; steps: ActivityStep[] } | null = null;

  const pushStep = (key: string, step: ActivityStep) => {
    if (!openActivity) {
      openActivity = { key, steps: [] };
      blocks.push({ type: "activity", ...openActivity });
    }
    openActivity.steps.push(step);
  };

  for (const message of assistantMessages) {
    message.parts.forEach((part, index) => {
      const key = `${message.id}-${index}`;
      if (part.type === "tool") {
        pushStep(key, { kind: "tool", key, part });
        return;
      }
      if (part.type === "reasoning" && part.text.trim()) {
        pushStep(key, { kind: "thought", key, text: part.text });
        return;
      }
      if (part.type === "text" && part.text.trim()) {
        openActivity = null;
        blocks.push({
          type: "message",
          key,
          // A bubble for just this text part; sources stay with the bubble.
          message: {
            ...message,
            parts: message.parts.filter(
              (p, i) => i === index || p.type === "source-url",
            ),
          },
        });
      }
    });
  }

  return blocks;
}

const TARGET_KEYS = [
  "url",
  "query",
  "searchText",
  "selector",
  "text",
  "title",
  "filename",
  "language",
] as const;

const TARGET_MAX_LENGTH = 44;

function compactUrl(value: string): string {
  try {
    const parsed = new URL(value);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return value;
  }
}

/**
 * A short human-readable hint of what a tool call targets (url, query, …),
 * shown next to the tool chip on the rail.
 */
export function toolTargetText(input: unknown): string | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const record = input as Record<string, unknown>;

  let value: string | null = null;
  for (const key of TARGET_KEYS) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      value = key === "url" ? compactUrl(candidate.trim()) : candidate.trim();
      break;
    }
  }
  if (value === null) {
    const firstString = Object.values(record).find(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.trim() !== "",
    );
    value = firstString?.trim() ?? null;
  }
  if (value === null) {
    return null;
  }

  value = value.replace(/\s+/g, " ");
  return value.length > TARGET_MAX_LENGTH
    ? `${value.slice(0, TARGET_MAX_LENGTH - 1)}…`
    : value;
}

/** Sum of recorded tool durations across the rail's steps. */
export function totalToolDurationMs(steps: ActivityStep[]): number {
  let total = 0;
  for (const step of steps) {
    if (step.kind === "tool" && typeof step.part.duration === "number") {
      total += step.part.duration;
    }
  }
  return total;
}

export function formatActivityDuration(ms: number): string {
  if (ms <= 0) {
    return "";
  }
  const seconds = ms / 1000;
  if (seconds < 10) {
    return `${(Math.round(seconds * 10) / 10).toFixed(1)}s`;
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}
