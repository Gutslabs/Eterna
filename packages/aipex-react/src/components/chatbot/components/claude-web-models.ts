import type { ModelEntry } from "./model-picker";

export const CLAUDE_WEB_MODEL_FAMILIES = [
  "Fable 5",
  "Opus 5",
  "Sonnet 5",
] as const;

export const CLAUDE_WEB_EFFORT_LEVELS = [
  "Low",
  "Medium",
  "High",
  "Extra",
  "Max",
] as const;

const DEFAULT_CLAUDE_WEB_FAMILY = "Opus 5";
const DEFAULT_CLAUDE_WEB_EFFORT = "High";

const FAMILY_DESCRIPTIONS: Record<
  (typeof CLAUDE_WEB_MODEL_FAMILIES)[number],
  string
> = {
  "Fable 5": "For your toughest challenges",
  "Opus 5": "For complex tasks",
  "Sonnet 5": "Most efficient for everyday tasks",
};

const FAMILY_ALIASES: Record<
  string,
  (typeof CLAUDE_WEB_MODEL_FAMILIES)[number]
> = {
  "fable 5": "Fable 5",
  "opus 5": "Opus 5",
  "opus 4.8": "Opus 5",
  "sonnet 5": "Sonnet 5",
  "sonnet 4.6": "Sonnet 5",
  "haiku 4.5": "Sonnet 5",
};

const EFFORT_ALIASES: Record<
  string,
  (typeof CLAUDE_WEB_EFFORT_LEVELS)[number]
> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  extra: "Extra",
  xhigh: "Extra",
  max: "Max",
};

export function normalizeClaudeWebModelValue(value: string): string {
  const trimmed = value.trim();
  const normalizedPrefix = trimmed.toLowerCase();
  if (
    normalizedPrefix !== "claude-browser" &&
    !normalizedPrefix.startsWith("claude-browser::")
  ) {
    return value;
  }
  if (normalizedPrefix === "claude-browser") {
    return `claude-browser::${DEFAULT_CLAUDE_WEB_FAMILY}|${DEFAULT_CLAUDE_WEB_EFFORT}`;
  }

  const match = /^claude-browser::([^|]+)(?:\|(.+))?$/i.exec(trimmed);
  if (!match) {
    return `claude-browser::${DEFAULT_CLAUDE_WEB_FAMILY}|${DEFAULT_CLAUDE_WEB_EFFORT}`;
  }

  const family =
    FAMILY_ALIASES[match[1]?.trim().toLowerCase() ?? ""] ??
    DEFAULT_CLAUDE_WEB_FAMILY;
  const effort =
    EFFORT_ALIASES[match[2]?.trim().toLowerCase() ?? ""] ??
    DEFAULT_CLAUDE_WEB_EFFORT;

  return `claude-browser::${family}|${effort}`;
}

export function createClaudeWebModelEntries(): ModelEntry[] {
  return CLAUDE_WEB_MODEL_FAMILIES.flatMap((family) =>
    CLAUDE_WEB_EFFORT_LEVELS.map((effort) => ({
      name: `${family} · ${effort}`,
      value: `claude-browser::${family}|${effort}`,
      group: family,
      groupDescription: FAMILY_DESCRIPTIONS[family],
      optionName: effort,
      optionDescription:
        effort === DEFAULT_CLAUDE_WEB_EFFORT ? "Default" : undefined,
    })),
  );
}
