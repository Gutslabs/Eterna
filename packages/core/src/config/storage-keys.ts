const PREFIX = "aipex_";

export const STORAGE_KEYS = {
  THEME: `${PREFIX}theme`,
  LANGUAGE: `${PREFIX}language`,
  SETTINGS: `${PREFIX}settings`,
  HOST_ACCESS_CONFIG: `${PREFIX}host_access_config`,
  AUTOMATION_MODE: `${PREFIX}automation_mode`,
  /** User toggle: fan research out to parallel background subagents. */
  PARALLEL_AGENT: `${PREFIX}parallel_agent`,
  /** User toggle (default ON): auto-attach a viewport screenshot every message. */
  AUTO_ATTACH_SCREENSHOT: `${PREFIX}auto_attach_screenshot`,
  /** Long-term user memory: durable facts saved via the remember tool. */
  MEMORY: `${PREFIX}memory`,
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/**
 * Automation mode type - controls visual effects and window focus behavior
 * - 'focus': Visual effects enabled, window focus allowed (immersive)
 * - 'background': Silent operation, no window focus changes
 */
export type AutomationMode = "focus" | "background";

/**
 * Validate and normalize automation mode value from storage
 * Returns a valid mode or the default ('focus') if invalid
 */
export function validateAutomationMode(value: unknown): AutomationMode {
  const VALID_MODES: AutomationMode[] = ["focus", "background"];
  if (
    typeof value === "string" &&
    VALID_MODES.includes(value as AutomationMode)
  ) {
    return value as AutomationMode;
  }
  // Default to focus mode
  return "focus";
}
