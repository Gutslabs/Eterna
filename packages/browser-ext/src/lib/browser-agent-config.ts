/**
 * Browser-specific agent configuration helpers
 * Provides default configuration for browser extension use cases
 */

import type { AppSettings, FunctionTool } from "@aipexstudio/aipex-core";
import {
  type AutomationMode,
  aisdk,
  SessionStorage,
  STORAGE_KEYS,
  validateAutomationMode,
} from "@aipexstudio/aipex-core";
import { SYSTEM_PROMPT } from "@aipexstudio/aipex-react/components/chatbot/constants";
import {
  allBrowserProviders,
  allBrowserTools,
  IndexedDBStorage,
} from "@aipexstudio/browser-runtime";
import { useStorage } from "@aipexstudio/browser-runtime/hooks";
import { useCallback, useMemo } from "react";
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
 * Create browser-specific storage instance
 */
export function useBrowserStorage() {
  return useMemo(
    () =>
      new SessionStorage(
        new IndexedDBStorage({
          dbName: "aipex-sessions",
          storeName: "sessions",
        }),
      ),
    [],
  );
}

/**
 * Create browser-specific model factory.
 *
 * When BYOK is configured, uses the user's provider + model.
 * Otherwise, uses the claudechrome.com proxy with a default model.
 */
export function useBrowserModelFactory() {
  return useCallback((settings: AppSettings) => {
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
  }, []);
}

/**
 * Get browser-specific context providers
 */
export function useBrowserContextProviders() {
  return useMemo(() => allBrowserProviders, []);
}

/**
 * Filter tools based on automation mode
 * In background mode, filter out computer and screenshot-related tools
 */
function filterToolsByMode(
  tools: FunctionTool[],
  mode: AutomationMode,
): FunctionTool[] {
  // In background mode, filter out computer and screenshot-related tools
  if (mode === "background") {
    return tools.filter((tool) => {
      const toolName = tool.name.toLowerCase();
      // Filter out computer tool and all screenshot-related tools
      return (
        toolName !== "computer" &&
        !toolName.includes("screenshot") &&
        !toolName.includes("take_screenshot") &&
        !toolName.includes("capture_screenshot")
      );
    });
  }
  // In focus mode, include all tools
  return tools;
}

/**
 * Get browser-specific tools filtered by automation mode
 * In background mode, visual tools (computer, screenshot) are excluded
 */
export function useBrowserTools(): FunctionTool[] {
  const [automationModeRaw] = useStorage<string>(
    STORAGE_KEYS.AUTOMATION_MODE,
    "focus",
  );

  const automationMode: AutomationMode = useMemo(
    () => validateAutomationMode(automationModeRaw),
    [automationModeRaw],
  );

  return useMemo(
    () => filterToolsByMode(allBrowserTools, automationMode),
    [automationMode],
  );
}

/**
 * Browser-specific agent configuration
 */
export const BROWSER_AGENT_CONFIG = {
  instructions: SYSTEM_PROMPT,
  name: "Eterna Browser Assistant",
  maxTurns: 2000,
} as const;
