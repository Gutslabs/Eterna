/**
 * Browser-specific agent configuration helpers
 * Provides default configuration for browser extension use cases
 */

import type { AppSettings, FunctionTool } from "@aipexstudio/aipex-core";
import {
  type AutomationMode,
  SessionStorage,
  STORAGE_KEYS,
  validateAutomationMode,
} from "@aipexstudio/aipex-core";
import {
  allBrowserProviders,
  IndexedDBStorage,
} from "@aipexstudio/browser-runtime";
import { useStorage } from "@aipexstudio/browser-runtime/hooks";
import { useCallback, useMemo } from "react";
import { createBrowserModel, resolveBrowserTools } from "./browser-model";

export { BROWSER_AGENT_CONFIG } from "./browser-model";

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
 * Delegates to the SW-safe createBrowserModel (see browser-model.ts), which
 * is also what the background chat host uses.
 */
export function useBrowserModelFactory() {
  return useCallback(
    (settings: AppSettings) => createBrowserModel(settings),
    [],
  );
}

/**
 * Get browser-specific context providers
 */
export function useBrowserContextProviders() {
  return useMemo(() => allBrowserProviders, []);
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

  return useMemo(() => resolveBrowserTools(automationMode), [automationMode]);
}
