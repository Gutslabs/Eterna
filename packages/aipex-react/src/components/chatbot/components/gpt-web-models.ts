import type { ModelEntry } from "./model-picker";

export const GPT_WEB_MODEL_FAMILIES = [
  "GPT-5.6 Sol",
  "GPT-5.5",
  "GPT-5.4",
  "GPT-5.3",
  "o3",
] as const;

export const GPT_WEB_INTELLIGENCE_LEVELS = [
  "Instant",
  "Medium",
  "High",
] as const;

const DEFAULT_GPT_WEB_FAMILY = GPT_WEB_MODEL_FAMILIES[0];
const DEFAULT_GPT_WEB_INTELLIGENCE = "Instant";

const FAMILY_STATUS: Partial<
  Record<(typeof GPT_WEB_MODEL_FAMILIES)[number], string>
> = {
  "GPT-5.4": "Leaving on July 23",
};

const INTELLIGENCE_STATUS: Partial<
  Record<(typeof GPT_WEB_INTELLIGENCE_LEVELS)[number], string>
> = {
  Instant: "5.5",
};

export function normalizeGptWebModelValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "catgpt-browser") {
    return `catgpt-browser::${DEFAULT_GPT_WEB_FAMILY}|${DEFAULT_GPT_WEB_INTELLIGENCE}`;
  }

  const match = /^catgpt-browser::(instant|medium|high)$/i.exec(trimmed);
  if (!match) return value;

  const intelligence = GPT_WEB_INTELLIGENCE_LEVELS.find(
    (level) => level.toLowerCase() === match[1]?.toLowerCase(),
  );
  return intelligence
    ? `catgpt-browser::${DEFAULT_GPT_WEB_FAMILY}|${intelligence}`
    : value;
}

export function createGptWebModelEntries(): ModelEntry[] {
  return GPT_WEB_MODEL_FAMILIES.flatMap((family) =>
    GPT_WEB_INTELLIGENCE_LEVELS.map((intelligence) => ({
      name: `${family} · ${intelligence}`,
      value: `catgpt-browser::${family}|${intelligence}`,
      group: family,
      groupDescription: FAMILY_STATUS[family] ?? "ChatGPT web",
      optionName: intelligence,
      optionDescription: INTELLIGENCE_STATUS[intelligence],
    })),
  );
}
