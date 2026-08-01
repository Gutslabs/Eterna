import type { ModelEntry } from "./model-picker";

export const GPT_WEB_MODEL_FAMILIES = ["GPT-5.6 Sol"] as const;

export const GPT_WEB_INTELLIGENCE_LEVELS = [
  "Instant",
  "Medium",
  "High",
] as const;

const DEFAULT_GPT_WEB_FAMILY = GPT_WEB_MODEL_FAMILIES[0];
const DEFAULT_GPT_WEB_INTELLIGENCE = "Instant";

// Retired families a user may still have saved resolve to the current model
// instead of stranding them on a gateway id the picker no longer offers.
const FAMILY_ALIASES: Record<string, (typeof GPT_WEB_MODEL_FAMILIES)[number]> =
  {
    "gpt-5.6 sol": "GPT-5.6 Sol",
    "gpt-5.5": "GPT-5.6 Sol",
    "gpt-5.4": "GPT-5.6 Sol",
    "gpt-5.3": "GPT-5.6 Sol",
    o3: "GPT-5.6 Sol",
  };

const INTELLIGENCE_ALIASES: Record<
  string,
  (typeof GPT_WEB_INTELLIGENCE_LEVELS)[number]
> = {
  instant: "Instant",
  medium: "Medium",
  high: "High",
};

function gptWebModelValue(
  family: (typeof GPT_WEB_MODEL_FAMILIES)[number],
  intelligence: (typeof GPT_WEB_INTELLIGENCE_LEVELS)[number],
): string {
  return `catgpt-browser::${family}|${intelligence}`;
}

export function normalizeGptWebModelValue(value: string): string {
  const trimmed = value.trim();
  const lowered = trimmed.toLowerCase();
  if (lowered !== "catgpt-browser" && !lowered.startsWith("catgpt-browser::")) {
    return value;
  }
  if (lowered === "catgpt-browser") {
    return gptWebModelValue(
      DEFAULT_GPT_WEB_FAMILY,
      DEFAULT_GPT_WEB_INTELLIGENCE,
    );
  }

  const match = /^catgpt-browser::([^|]+)(?:\|(.+))?$/i.exec(trimmed);
  if (!match) {
    return gptWebModelValue(
      DEFAULT_GPT_WEB_FAMILY,
      DEFAULT_GPT_WEB_INTELLIGENCE,
    );
  }

  const familySlot = match[1]?.trim().toLowerCase() ?? "";
  const intelligenceSlot = match[2]?.trim().toLowerCase() ?? "";

  // "catgpt-browser::High" — the pre-family encoding kept the level here.
  const levelOnly = !match[2] ? INTELLIGENCE_ALIASES[familySlot] : undefined;
  if (levelOnly) {
    return gptWebModelValue(DEFAULT_GPT_WEB_FAMILY, levelOnly);
  }

  return gptWebModelValue(
    FAMILY_ALIASES[familySlot] ?? DEFAULT_GPT_WEB_FAMILY,
    INTELLIGENCE_ALIASES[intelligenceSlot] ?? DEFAULT_GPT_WEB_INTELLIGENCE,
  );
}

export function createGptWebModelEntries(): ModelEntry[] {
  return GPT_WEB_MODEL_FAMILIES.flatMap((family) =>
    GPT_WEB_INTELLIGENCE_LEVELS.map((intelligence) => ({
      name: `${family} · ${intelligence}`,
      value: gptWebModelValue(family, intelligence),
      group: family,
      groupDescription: "ChatGPT web",
      optionName: intelligence,
      optionDescription:
        intelligence === DEFAULT_GPT_WEB_INTELLIGENCE ? "Default" : undefined,
    })),
  );
}
