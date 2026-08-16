/**
 * Carry a saved model selection forward when the catalog moves under it.
 *
 * Two generations of breakage are handled. The web-session gateways
 * (catgpt-browser, claude-browser) drove the ChatGPT and Claude web UIs through
 * a local Docker server and were replaced by the CLIProxyAPI subscription path;
 * their ids used a "<base>::<Family>|<Level>" encoding. Separately, individual
 * proxy models get retired as the vendors ship new ones.
 *
 * Either way the goal is the same: never leave a user pointing at an id the
 * proxy will reject on their next send.
 */

import { baseModelId } from "@eterna/core";

const CLAUDE_FAMILY_REPLACEMENTS: Record<string, string> = {
  "fable 5": "claude-fable-5",
  "opus 5": "claude-opus-5",
  "opus 4.8": "claude-opus-4-8",
  "sonnet 5": "claude-sonnet-5",
  "sonnet 4.6": "claude-sonnet-5",
  "haiku 4.5": "claude-sonnet-5",
};

/**
 * Ids the picker no longer offers, mapped to the current model of their family
 * — whether they were retired by the vendor or simply dropped from the lineup.
 */
const RETIRED_MODEL_REPLACEMENTS: Record<string, string> = {
  "claude-haiku-4-5-20251001": "claude-sonnet-5",

  "gpt-5.5": "gpt-5.6-sol",
  "gpt-5.4": "gpt-5.6-sol",
  "gpt-5.4-mini": "gpt-5.6-sol",

  "gemini-3-flash": "gemini-3.7-flash-high",
  "gemini-3-flash-agent": "gemini-3.7-flash-high",
  "gemini-3.1-flash-lite": "gemini-3.7-flash-high",
  "gemini-3.1-pro-low": "gemini-3.7-flash-high",
  "gemini-3.5-flash-low": "gemini-3.7-flash-high",
  "gemini-3.5-flash-extra-low": "gemini-3.7-flash-high",
  "gemini-3.6-flash-high": "gemini-3.7-flash-high",
  "gemini-pro-agent": "gemini-3.7-flash-high",

  // xAI dropped the 4.3, 4.20 and grok-3 generations from the account's
  // catalog: the proxy still lists them but every call returns invalid
  // credentials.
  "grok-4.3": "grok-4.6",
  "grok-4.20-0309-reasoning": "grok-4.6",
  "grok-4.20-0309-non-reasoning": "grok-4.6",
  "grok-4.20-multi-agent-0309": "grok-4.6",
  "grok-build-0.1": "grok-4.6",
  "grok-3-mini": "grok-4.6",
  "grok-3-mini-fast": "grok-4.6",
  "grok-4.5": "grok-4.6",
  "grok-composer-2.5-fast": "grok-4.6",
};

const DEFAULT_CLAUDE_REPLACEMENT = "claude-opus-5";
const DEFAULT_CODEX_REPLACEMENT = "gpt-5.6-sol";

function isLegacyValue(lowered: string, base: string): boolean {
  return lowered === base || lowered.startsWith(`${base}::`);
}

export function migrateLegacyModelValue(value: string): string {
  const trimmed = value.trim();
  const lowered = trimmed.toLowerCase();

  if (isLegacyValue(lowered, "catgpt-browser")) {
    return DEFAULT_CODEX_REPLACEMENT;
  }

  if (isLegacyValue(lowered, "claude-browser")) {
    const family = /^claude-browser::([^|]+)/i
      .exec(trimmed)?.[1]
      ?.trim()
      .toLowerCase();
    return (
      (family ? CLAUDE_FAMILY_REPLACEMENTS[family] : undefined) ??
      DEFAULT_CLAUDE_REPLACEMENT
    );
  }

  // A retired id may already carry a reasoning suffix; replace only the model
  // half and let the caller re-apply a level the successor actually accepts.
  const replacement = RETIRED_MODEL_REPLACEMENTS[baseModelId(trimmed)];
  return replacement ?? value;
}
