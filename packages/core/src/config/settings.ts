import type { KeyValueStorage } from "../storage/index.js";
import type { AIProviderKey } from "./ai-providers.js";
import type { ProviderType } from "./types.js";

export type { ProviderType };

export interface CustomModelConfig {
  id: string;
  name?: string;
  providerType: ProviderType;
  aiHost?: string;
  aiToken: string;
  aiModel: string;
  enabled: boolean;
}

export interface AppSettings {
  aiProvider?: AIProviderKey;
  aiHost?: string;
  aiToken?: string;
  aiModel?: string;
  /**
   * Preferred default model for new sessions (does not affect runtime selection)
   */
  defaultModel?: string;
  language?: string;
  theme?: string;
  byokEnabled?: boolean;
  dataSharingEnabled?: boolean;
  /**
   * Global toggle for BYOK/provider usage
   */
  providerEnabled?: boolean;
  /**
   * Provider type for current BYOK selection
   */
  providerType?: ProviderType;
  /**
   * Multiple BYOK custom model configurations
   */
  customModels?: CustomModelConfig[];
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  aiProvider: "openai",
  language: "en",
  theme: "system",
  providerType: "openai",
  providerEnabled: false,
  defaultModel: undefined,
  customModels: [],
};

export type AppSettingsUpdate =
  | Partial<AppSettings>
  | ((current: AppSettings) => Partial<AppSettings>);

export function mergeAppSettings(
  current: AppSettings | null | undefined,
  updates: Partial<AppSettings> = {},
): AppSettings {
  const definedUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined),
  ) as Partial<AppSettings>;
  return {
    ...DEFAULT_APP_SETTINGS,
    ...(current ?? {}),
    ...definedUpdates,
  };
}

export function changedAppSettings(
  baseline: AppSettings | null | undefined,
  next: AppSettings,
): Partial<AppSettings> {
  const previous = baseline ?? {};
  const patch: Partial<AppSettings> = {};
  for (const key of Object.keys(next) as Array<keyof AppSettings>) {
    if (!Object.is(previous[key], next[key])) {
      (patch as Record<keyof AppSettings, unknown>)[key] = next[key];
    }
  }
  return patch;
}

export async function updateAppSettings(
  storage: KeyValueStorage<unknown>,
  storageKey: string,
  update: AppSettingsUpdate,
): Promise<AppSettings> {
  const apply = (stored: unknown): AppSettings => {
    const current = mergeAppSettings(
      stored && typeof stored === "object" ? (stored as AppSettings) : null,
    );
    const patch = typeof update === "function" ? update(current) : update;
    return mergeAppSettings(current, patch);
  };

  if (storage.update) {
    return (await storage.update(storageKey, apply)) as AppSettings;
  }

  const next = apply(await storage.load(storageKey));
  await storage.save(storageKey, next);
  return next;
}
