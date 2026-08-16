/**
 * Automation Mode Helper
 *
 * Reads user-selected automation mode from chrome.storage:
 * - Focus mode: Visual effects, window focus, screenshots allowed
 * - Background mode: Silent operation, no window focus, no visual tools
 */

import {
  type AutomationMode,
  STORAGE_KEYS,
  validateAutomationMode,
} from "@eterna/core";
import { ChromeStorageAdapter } from "../storage/storage-adapter";

const storage = new ChromeStorageAdapter<string>();

// The mode is read on nearly every tool call (snapshots, element lookups,
// screenshots, tab tools) but the user changes it about once a week, so it is
// cached in memory and invalidated by the storage listener below. A single
// fill_form over 10 fields otherwise issues ~21 storage IPCs for one value.
let cachedMode: AutomationMode | null = null;
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEYS.AUTOMATION_MODE]) {
      cachedMode = null;
    }
  });
}

/**
 * Get automation mode from storage
 * Returns 'focus' or 'background' based on user selection
 */
export async function getAutomationMode(): Promise<AutomationMode> {
  if (cachedMode !== null) {
    return cachedMode;
  }
  try {
    const value = await storage.load(STORAGE_KEYS.AUTOMATION_MODE);
    const mode = validateAutomationMode(value);
    cachedMode = mode;
    return mode;
  } catch (error) {
    console.warn("⚠️ [AutomationMode] Failed to read mode from storage:", error);
    // Default to focus mode
    return "focus";
  }
}

/**
 * Check if focus mode is currently enabled
 */
export async function isFocusMode(): Promise<boolean> {
  const mode = await getAutomationMode();
  return mode === "focus";
}

/**
 * Check if background mode is currently enabled
 */
export async function isBackgroundMode(): Promise<boolean> {
  const mode = await getAutomationMode();
  return mode === "background";
}
