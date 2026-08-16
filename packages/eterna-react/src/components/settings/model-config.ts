import {
  AI_PROVIDERS,
  type AIProviderKey,
  type AppSettings,
  type CustomModelConfig,
  detectProviderFromHost,
  type ProviderType,
} from "@eterna/core";

export const PROVIDER_TYPE_TO_KEY: Record<ProviderType, AIProviderKey> = {
  openai: "openai",
  google: "google",
  claude: "anthropic",
};

export const PROVIDER_KEY_TO_TYPE: Partial<
  Record<AIProviderKey, ProviderType>
> = {
  openai: "openai",
  google: "google",
  anthropic: "claude",
};

export const buildDefaultProviderModels = (): CustomModelConfig[] =>
  (
    Object.entries(AI_PROVIDERS) as [
      AIProviderKey,
      (typeof AI_PROVIDERS)[AIProviderKey],
    ][]
  ).map(([key, provider]) => ({
    id: `builtin-${key}`,
    name: provider.name,
    providerType: provider.providerType,
    aiHost: "host" in provider ? (provider.host ?? "") : "",
    aiToken: "",
    aiModel: provider.models[0] ?? "",
    enabled: false,
  }));

export const mergeWithDefaultProviders = (
  models: CustomModelConfig[],
): CustomModelConfig[] => {
  const existingIds = new Set(models.map((model) => model.id));
  const merged = [...models];
  for (const model of buildDefaultProviderModels()) {
    if (!existingIds.has(model.id)) {
      merged.push(model);
    }
  }
  return merged;
};

export const resolveProviderKey = (
  model: Pick<CustomModelConfig, "aiHost" | "providerType"> &
    Partial<Pick<CustomModelConfig, "id">>,
): AIProviderKey => {
  if (model.id?.startsWith("builtin-")) {
    const key = model.id.slice("builtin-".length) as AIProviderKey;
    if (AI_PROVIDERS[key]) return key;
  }
  const detected = model.aiHost ? detectProviderFromHost(model.aiHost) : null;
  if (detected && AI_PROVIDERS[detected]) {
    return detected;
  }
  return PROVIDER_TYPE_TO_KEY[model.providerType] ?? "openai";
};

export const DEFAULT_MODEL_AUTO_VALUE = "__use-first-available__";

export const generateId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `custom-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const createEmptyCustomModel = (
  providerType: ProviderType = "openai",
): CustomModelConfig => {
  const providerKey = PROVIDER_TYPE_TO_KEY[providerType];
  const providerMeta = AI_PROVIDERS[providerKey];
  return {
    id: generateId(),
    name: "",
    providerType,
    aiHost:
      providerMeta && "host" in providerMeta ? (providerMeta.host ?? "") : "",
    aiToken: "",
    aiModel: providerMeta?.models?.[0] ?? "",
    enabled: false,
  };
};

export interface ResolvedModelConfig {
  activeModel: CustomModelConfig | undefined;
  aiHost: string;
  aiToken: string;
  aiModel: string;
  providerType: ProviderType;
  providerKey: AIProviderKey;
}

export const resolveActiveModel = (
  settings: AppSettings,
  customModels: CustomModelConfig[],
  selectedModelId: string | null,
): ResolvedModelConfig => {
  const enabledModels = settings.byokEnabled
    ? customModels.filter((model) => model.enabled)
    : [];
  const selected = selectedModelId
    ? customModels.find((model) => model.id === selectedModelId)
    : undefined;
  const activeModel =
    settings.byokEnabled && selected?.enabled
      ? selected
      : settings.byokEnabled
        ? enabledModels[0]
        : undefined;

  const providerType =
    activeModel?.providerType ?? settings.providerType ?? "openai";
  const providerKey: AIProviderKey =
    activeModel !== undefined
      ? resolveProviderKey({
          aiHost: activeModel.aiHost ?? "",
          providerType: providerType as ProviderType,
        })
      : (settings.aiProvider ?? "openai");
  const providerMeta = AI_PROVIDERS[providerKey];

  const aiHost =
    activeModel?.aiHost ??
    (providerMeta && "host" in providerMeta ? (providerMeta.host ?? "") : "") ??
    settings.aiHost ??
    "";
  const aiToken = activeModel?.aiToken ?? settings.aiToken ?? "";
  const aiModel = activeModel?.aiModel ?? settings.aiModel ?? "";

  return {
    activeModel,
    aiHost,
    aiToken,
    aiModel,
    providerType: providerType as ProviderType,
    providerKey,
  };
};

export const ERROR_MESSAGES = {
  enableOneModel: {
    zh: "请先启用至少一个模型",
    en: "Please enable at least one model",
  },
  fillRequired: {
    zh: "请填写所有必填字段",
    en: "Please fill in all required fields",
  },
} as const;

export const createErrorMessage = (
  key: keyof typeof ERROR_MESSAGES,
  language: string,
): string => {
  return ERROR_MESSAGES[key][language as "zh" | "en"] ?? ERROR_MESSAGES[key].en;
};
