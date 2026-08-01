// Internal model info used by the chatbot UI
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  description: string;
  supportsTools: boolean;
  contextLength?: number;
  pricing?: {
    input: string;
    output: string;
  };
  priceLevel: "cheap" | "normal" | "expensive";
}

// Static BYOK model suggestions. The list used to be fetched from a hosted
// catalog; Eterna ships it locally instead — no network, no third-party
// service involved.
const BYOK_MODELS: ModelInfo[] = [
  {
    id: "anthropic/claude-3-haiku",
    name: "Claude 3 Haiku",
    provider: "Anthropic",
    description: "Cost-effective choice for basic tasks",
    supportsTools: true,
    contextLength: 200_000,
    pricing: {
      input: "$0.30/1M tokens",
      output: "$1.50/1M tokens",
    },
    priceLevel: "cheap",
  },
  {
    id: "anthropic/claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",
    provider: "Anthropic",
    description: "AI model for various tasks",
    supportsTools: true,
    contextLength: 200_000,
    pricing: {
      input: "$3.60/1M tokens",
      output: "$18.00/1M tokens",
    },
    priceLevel: "expensive",
  },
];

export async function fetchModels(): Promise<ModelInfo[]> {
  return BYOK_MODELS;
}

type ModelChangeListener = (models: ModelInfo[]) => void;

/**
 * Subscribe to model list updates. The static list never changes, so this is
 * a no-op kept for API compatibility with existing subscribers.
 */
export function onModelListChange(_listener: ModelChangeListener): () => void {
  return () => {};
}

/**
 * Fetch models and convert to the {name, value} format used by the model selector.
 */
export async function fetchModelsForSelector(): Promise<
  Array<{ name: string; value: string }>
> {
  const models = await fetchModels();
  return models.map((m) => ({ name: m.name, value: m.id }));
}

/**
 * Fetch models as ModelInfo[] for ModelChangePrompt compatibility.
 */
export async function fetchModelsForPrompt(): Promise<ModelInfo[]> {
  return fetchModels();
}
