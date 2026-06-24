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
  createProxyProvider,
  isByokConfigured,
  isCatGptGatewayModel,
  isChatGptModel,
  isGeminiGatewayModel,
  isXaiGatewayModel,
  normalizeCodexModel,
  PROXY_DEFAULT_MODEL,
} from "./ai-provider";

/**
 * Create the AI model for the given settings.
 *
 * When BYOK is configured, uses the user's provider + model.
 * Otherwise, uses the claudechrome.com proxy with a default model.
 */
export function createBrowserModel(settings: AppSettings) {
  if (isChatGptModel(settings.aiModel)) {
    // ChatGPT subscription path – Codex Responses API with OAuth
    return aisdk(
      createChatGptProvider()(normalizeCodexModel(settings.aiModel)),
    );
  }

  const gatewayModel = settings.aiModel;
  if (gatewayModel && isCatGptGatewayModel(gatewayModel)) {
    // CatGPT-Gateway path – local OpenAI-compatible server
    return aisdk(createCatGptGatewayProvider()(gatewayModel));
  }

  if (
    settings.aiModel &&
    (isGeminiGatewayModel(settings.aiModel) ||
      isXaiGatewayModel(settings.aiModel))
  ) {
    // CLIProxyAPI path – local OAuth proxy serving Gemini (Google account)
    // and Grok (Grok Build account) as one OpenAI-compatible endpoint
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

  // Proxy path – use claudechrome.com API with cookie auth
  const provider = createProxyProvider();
  const modelId = settings.aiModel || PROXY_DEFAULT_MODEL;
  return aisdk(provider(modelId));
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

/** Browser-specific agent configuration shared by UI and background host. */
export const BROWSER_AGENT_CONFIG = {
  instructions: SYSTEM_PROMPT,
  name: "Eterna Browser Assistant",
  maxTurns: 2000,
} as const;
