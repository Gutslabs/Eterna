/**
 * SW-safe agent assembly helpers.
 *
 * Pure functions shared by the React UI and the background chat host to
 * build the model, resolve the tool set and load the settings snapshot.
 * Must stay free of React imports — the background service worker bundles
 * this module.
 */

import type { AppSettings, FunctionTool } from "@aipexstudio/aipex-core";
import {
  type AutomationMode,
  aisdk,
  DEFAULT_APP_SETTINGS,
  STORAGE_KEYS,
  validateAutomationMode,
} from "@aipexstudio/aipex-core";
import { SYSTEM_PROMPT } from "@aipexstudio/aipex-react/components/chatbot/constants";
import {
  allBrowserTools,
  chromeStorageAdapter,
} from "@aipexstudio/browser-runtime";
import {
  createAIProvider,
  createCatGptGatewayProvider,
  createChatGptProvider,
  createGeminiGatewayProvider,
  isByokConfigured,
  isCatGptGatewayModel,
  isChatGptModel,
  isClaudeGatewayModel,
  isGeminiGatewayModel,
  isXaiGatewayModel,
  normalizeCodexModel,
} from "./ai-provider";

/**
 * Create the AI model for the given settings: ChatGPT subscription, local
 * gateways, or BYOK. There is no hosted fallback — an unconfigured model is
 * a configuration error surfaced to the user.
 */
export function createBrowserModel(
  settings: AppSettings,
  gatewayRouteId?: string,
) {
  if (isChatGptModel(settings.aiModel)) {
    // ChatGPT subscription path – Codex Responses API with OAuth
    return aisdk(
      createChatGptProvider()(normalizeCodexModel(settings.aiModel)),
    );
  }

  const gatewayModel = settings.aiModel;
  if (gatewayModel && isCatGptGatewayModel(gatewayModel)) {
    // CatGPT-Gateway path – local OpenAI-compatible server
    return aisdk(createCatGptGatewayProvider(gatewayRouteId)(gatewayModel));
  }

  if (
    settings.aiModel &&
    (isGeminiGatewayModel(settings.aiModel) ||
      isXaiGatewayModel(settings.aiModel) ||
      isClaudeGatewayModel(settings.aiModel))
  ) {
    // CLIProxyAPI path – local OAuth proxy serving Gemini (Antigravity),
    // Grok (Grok Build) and Claude (Claude Code) as one OpenAI-compatible API
    return aisdk(createGeminiGatewayProvider()(settings.aiModel));
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
    "No AI provider configured. Pick a model in Settings (ChatGPT sign-in, " +
      "a local gateway, or your own API key).",
  );
}

/**
 * Filter tools based on automation mode.
 * In background mode, visual tools (computer, screenshot) are excluded.
 */
export function filterToolsByMode(
  tools: FunctionTool[],
  mode: AutomationMode,
): FunctionTool[] {
  if (mode === "background") {
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
export function resolveBrowserTools(mode: AutomationMode): FunctionTool[] {
  return filterToolsByMode(allBrowserTools, mode);
}

/** Settings snapshot from chrome.storage, merged over defaults. */
export async function loadAppSettings(): Promise<AppSettings> {
  const stored = (await chromeStorageAdapter.load(
    STORAGE_KEYS.SETTINGS,
  )) as AppSettings | null;
  return { ...DEFAULT_APP_SETTINGS, ...(stored ?? {}) };
}

/** Automation mode from chrome.storage (defaults to "focus"). */
export async function loadAutomationMode(): Promise<AutomationMode> {
  const raw = await chromeStorageAdapter.load(STORAGE_KEYS.AUTOMATION_MODE);
  return validateAutomationMode(raw);
}

/**
 * Whether the user has switched on the parallel-research agent. Default OFF —
 * subagent fan-out only happens when explicitly enabled in the composer.
 */
export async function loadParallelAgentEnabled(): Promise<boolean> {
  return (
    (await chromeStorageAdapter.load(STORAGE_KEYS.PARALLEL_AGENT)) === true
  );
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

/** Browser-specific agent configuration shared by UI and background host. */
export const BROWSER_AGENT_CONFIG = {
  instructions: SYSTEM_PROMPT,
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
