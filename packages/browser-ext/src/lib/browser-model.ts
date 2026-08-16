/**
 * SW-safe agent assembly helpers.
 *
 * Pure functions shared by the React UI and the background chat host to
 * build the model, resolve the tool set and load the settings snapshot.
 * Must stay free of React imports — the background service worker bundles
 * this module.
 */

import { allBrowserTools, chromeStorageAdapter } from "@eterna/browser-runtime";
import type { AppSettings, FunctionTool } from "@eterna/core";
import {
  type AutomationMode,
  aisdk,
  mergeAppSettings,
  STORAGE_KEYS,
  validateAutomationMode,
} from "@eterna/core";
import {
  createAIProvider,
  createChatGptProvider,
  createClaudeGatewayProvider,
  createCliProxyProvider,
  isByokConfigured,
  isChatGptModel,
  isClaudeGatewayModel,
  isCliProxyModel,
  normalizeCodexModel,
} from "./ai-provider";

export { modelSupportsVision } from "./model-capabilities";

/**
 * Create the AI model for the given settings: the local CLIProxyAPI instance,
 * the ChatGPT subscription, or BYOK. There is no hosted fallback — an
 * unconfigured model is a configuration error surfaced to the user.
 *
 * CLIProxyAPI is checked first because it is the transport the model picker
 * offers; the in-extension Codex path only serves settings that predate it.
 */
export function createBrowserModel(settings: AppSettings) {
  if (settings.aiModel && isClaudeGatewayModel(settings.aiModel)) {
    // Claude goes through the proxy's native Anthropic endpoint — the OpenAI
    // translation buffers streams badly while thinking is enabled.
    return aisdk(createClaudeGatewayProvider()(settings.aiModel));
  }

  if (settings.aiModel && isCliProxyModel(settings.aiModel)) {
    // CLIProxyAPI path – local OAuth proxy serving Gemini (Antigravity), Grok
    // (Grok Build), Claude (Claude Code) and Codex (ChatGPT) as one API
    return aisdk(createCliProxyProvider()(settings.aiModel));
  }

  if (isChatGptModel(settings.aiModel)) {
    // ChatGPT subscription path – Codex Responses API with OAuth
    return aisdk(
      createChatGptProvider()(normalizeCodexModel(settings.aiModel)),
    );
  }

  if (isByokConfigured(settings)) {
    // BYOK path – user provides their own key and model
    const provider = createAIProvider(settings);
    const modelId = settings.aiModel;
    if (!modelId) {
      throw new Error("AI model is not configured");
    }
    return aisdk(provider(modelId));
  }

  throw new Error(
    "No AI provider configured. Pick a model in Settings (a Codex, Claude, " +
      "Gemini or Grok subscription via CLIProxyAPI, or your own API key).",
  );
}

/**
 * Filter tools based on automation mode.
 * In background mode, visual tools (computer, screenshot) are excluded.
 */
export function filterToolsByMode(
  tools: FunctionTool[],
  mode: AutomationMode,
  supportsVision = true,
): FunctionTool[] {
  if (mode === "background" || !supportsVision) {
    return tools.filter((tool) => {
      const toolName = tool.name.toLowerCase();
      return (
        toolName !== "computer" &&
        !toolName.includes("screenshot") &&
        !toolName.includes("take_screenshot") &&
        !toolName.includes("capture_screenshot")
      );
    });
  }
  return tools;
}

/** The full browser tool set filtered for the given automation mode. */
export function resolveBrowserTools(
  mode: AutomationMode,
  supportsVision = true,
): FunctionTool[] {
  return filterToolsByMode(allBrowserTools, mode, supportsVision);
}

/** Settings snapshot from chrome.storage, merged over defaults. */
export async function loadAppSettings(): Promise<AppSettings> {
  const stored = (await chromeStorageAdapter.load(
    STORAGE_KEYS.SETTINGS,
  )) as AppSettings | null;
  return mergeAppSettings(stored ?? {});
}

/** Automation mode from chrome.storage (defaults to "focus"). */
export async function loadAutomationMode(): Promise<AutomationMode> {
  const raw = await chromeStorageAdapter.load(STORAGE_KEYS.AUTOMATION_MODE);
  return validateAutomationMode(raw);
}

/** User-authored persona text from storage; "" when unset. */
async function loadPersonaText(key: string): Promise<string> {
  const value = await chromeStorageAdapter.load(key);
  return typeof value === "string" ? value.trim() : "";
}

/** IDENTITY — who the assistant is (name, address style). */
export async function loadIdentity(): Promise<string> {
  return loadPersonaText(STORAGE_KEYS.IDENTITY);
}

/** SOUL — how the assistant behaves (tone, values). */
export async function loadSoul(): Promise<string> {
  return loadPersonaText(STORAGE_KEYS.SOUL);
}

/**
 * Prompt section for the user-authored persona. Settings-level (changes
 * rarely), so it is assembled into the system prompt at agent build time —
 * unlike page-dependent context, which rides the turn.
 */
export function renderPersonaForPrompt(identity: string, soul: string): string {
  const sections: string[] = [];
  if (identity) {
    sections.push(
      `=== IDENTITY (who you are — user-authored) ===\n${identity}`,
    );
  }
  if (soul) {
    sections.push(`=== SOUL (how you behave — user-authored) ===\n${soul}`);
  }
  return sections.join("\n\n");
}

/**
 * Whether to auto-attach a viewport screenshot to every message so the model
 * always sees the user's current screen. Privacy-first default OFF.
 */
export async function loadAutoScreenshotEnabled(): Promise<boolean> {
  return (
    (await chromeStorageAdapter.load(STORAGE_KEYS.AUTO_ATTACH_SCREENSHOT)) ===
    true
  );
}

/**
 * Browser-specific agent configuration shared by UI and background host.
 * Instructions are NOT static config: chat-host-init assembles them per
 * session via buildSystemPrompt so the prompt matches the resolved bundle.
 */
export const BROWSER_AGENT_CONFIG = {
  name: "Eterna Browser Assistant",
  maxTurns: 2000,
  /**
   * Conversation compaction. Without it, every turn re-sends the whole growing
   * history — and each user message carries a ~12k-char page block — so a long
   * sidebar session balloons the per-request bill and rots context. Triggered by
   * the token watermark once a turn's prompt crosses it (with an item-count
   * fallback for gateways that don't report usage); protectRecentMessages keeps
   * the latest exchanges and their tool pairs intact. The summarizer model is
   * supplied in chat-host-init (same gateway as the chat model).
   */
  compression: {
    summarizeAfterItems: 30,
    keepRecentItems: 16,
    protectRecentMessages: 8,
    tokenWatermark: 120_000,
    maxSummaryLength: 2000,
  },
} as const;
