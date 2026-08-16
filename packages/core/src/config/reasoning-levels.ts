/**
 * Reasoning effort for the subscription-backed models served by the local
 * CLIProxyAPI instance.
 *
 * The accepted vocabulary differs per model, not per vendor — gpt-5.6-* takes
 * `max` while gpt-5.5 stops at `xhigh`, and only the newer Gemini Flash builds
 * accept `minimal`. Sending an unsupported level is a hard error from the
 * proxy, so the table below is transcribed from what each model reports as its
 * own valid set rather than guessed from the family name.
 *
 * A selection travels as "<model>::<level>" through `AppSettings.aiModel`; the
 * provider splits it back into a plain model id plus `reasoning_effort`.
 */

export const REASONING_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

/** Display names; the wire values stay lowercase. */
export const REASONING_LEVEL_LABELS: Record<ReasoningLevel, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra",
  max: "Max",
};

const FULL: readonly ReasoningLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const NO_MAX: readonly ReasoningLevel[] = ["low", "medium", "high", "xhigh"];
const BASIC: readonly ReasoningLevel[] = ["low", "medium", "high"];
const WITH_MINIMAL: readonly ReasoningLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
];

/**
 * Covers every model the proxy serves, not just the ones the picker currently
 * offers — each row cost a live probe to establish, and a model dropped from
 * the lineup keeps working if it is put back.
 */
const MODEL_REASONING_LEVELS: Record<string, readonly ReasoningLevel[]> = {
  "gpt-5.6-sol": FULL,
  "gpt-5.6-terra": FULL,
  "gpt-5.6-luna": FULL,
  "gpt-5.5": NO_MAX,
  "gpt-5.4": NO_MAX,
  "gpt-5.4-mini": NO_MAX,

  "claude-fable-5": FULL,
  "claude-opus-5": FULL,
  "claude-opus-4-8": FULL,
  "claude-sonnet-5": FULL,

  // The proxy advertises `minimal` for 3.7 too, but Google rejects it with
  // "Thinking level MINIMAL is not supported for this model" — the advertised
  // list is a proxy-side table, so trust the end-to-end result over it.
  "gemini-3.7-flash-high": BASIC,
  "gemini-3.6-flash-high": WITH_MINIMAL,
  "gemini-3.5-flash-low": BASIC,
  "gemini-3.1-pro-low": BASIC,

  "grok-4.6": NO_MAX,
  "grok-4.5": BASIC,
  // grok-composer-2.5-fast accepts the field but does no reasoning, so it is
  // deliberately absent: no submenu, no level appended.
};

/**
 * Gemini leaks raw thoughts into the visible text channel when no effort is
 * set, so it defaults low rather than unset. The rest default to a middle
 * setting the user can move in either direction.
 */
const MODEL_DEFAULT_LEVEL: Record<string, ReasoningLevel> = {
  "gemini-3.7-flash-high": "low",
  "gemini-3.6-flash-high": "low",
  "gemini-3.5-flash-low": "low",
  "gemini-3.1-pro-low": "low",
};

const DEFAULT_LEVEL: ReasoningLevel = "medium";

export function reasoningLevelsFor(
  model: string | undefined,
): readonly ReasoningLevel[] {
  if (!model) return [];
  return MODEL_REASONING_LEVELS[baseModelId(model)] ?? [];
}

export function supportsReasoningLevels(model: string | undefined): boolean {
  return reasoningLevelsFor(model).length > 0;
}

export function defaultReasoningLevelFor(
  model: string | undefined,
): ReasoningLevel | undefined {
  const levels = reasoningLevelsFor(model);
  if (levels.length === 0) return undefined;
  const preferred = MODEL_DEFAULT_LEVEL[baseModelId(model ?? "")];
  if (preferred && levels.includes(preferred)) return preferred;
  return levels.includes(DEFAULT_LEVEL) ? DEFAULT_LEVEL : levels[0];
}

export function baseModelId(value: string): string {
  return value.split("::", 1)[0] ?? value;
}

export function composeModelSelection(
  model: string,
  level: ReasoningLevel,
): string {
  return `${model}::${level}`;
}

export interface ModelSelection {
  model: string;
  reasoningLevel?: ReasoningLevel;
}

/**
 * Split a stored selection, dropping a level the model does not accept — a
 * stale level would otherwise be rejected by the proxy on the first send.
 */
/**
 * Bring a stored value up to the current shape: a model that takes reasoning
 * gains its default level, and one that does not loses any stale suffix. Keeps
 * saved settings matching a picker entry instead of falling through to the
 * "(Custom)" row.
 */
export function normalizeModelSelection(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  const { model, reasoningLevel } = splitModelSelection(trimmed);
  const level = reasoningLevel ?? defaultReasoningLevelFor(model);
  return level ? composeModelSelection(model, level) : model;
}

export function splitModelSelection(value: string): ModelSelection {
  const trimmed = value.trim();
  const separator = trimmed.indexOf("::");
  if (separator === -1) return { model: trimmed };

  const model = trimmed.slice(0, separator);
  const level = trimmed.slice(separator + 2).toLowerCase();
  const levels = reasoningLevelsFor(model);
  return levels.includes(level as ReasoningLevel)
    ? { model, reasoningLevel: level as ReasoningLevel }
    : { model };
}
