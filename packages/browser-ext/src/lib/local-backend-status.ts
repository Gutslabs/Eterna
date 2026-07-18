import {
  isClaudeGatewayModel,
  isGeminiGatewayModel,
  isXaiGatewayModel,
} from "./ai-provider";

export interface LocalBackendDescriptor {
  key: "gpt-web" | "claude-web" | "cliproxy";
  label: string;
  healthUrl: string;
}

const CACHE_TTL_MS = 10_000;
const PROBE_TIMEOUT_MS = 1_200;

const cache = new Map<
  string,
  { reachable: boolean; expiresAt: number; pending?: Promise<boolean> }
>();

export function localBackendForModel(
  model: string | undefined,
): LocalBackendDescriptor | null {
  if (model?.startsWith("catgpt-browser")) {
    return {
      key: "gpt-web",
      label: "gpt-web",
      healthUrl: "http://localhost:8000/healthz",
    };
  }
  if (model?.startsWith("claude-browser")) {
    return {
      key: "claude-web",
      label: "claude-web",
      healthUrl: "http://localhost:8001/healthz",
    };
  }
  if (
    isGeminiGatewayModel(model) ||
    isXaiGatewayModel(model) ||
    isClaudeGatewayModel(model)
  ) {
    return {
      key: "cliproxy",
      label: "CLIProxy",
      healthUrl: "http://localhost:8317/v1/models",
    };
  }
  return null;
}

export async function probeLocalBackend(
  model: string | undefined,
  options: { force?: boolean } = {},
): Promise<boolean> {
  const backend = localBackendForModel(model);
  if (!backend) return true;

  const now = Date.now();
  const cached = cache.get(backend.healthUrl);
  if (cached?.pending) return cached.pending;
  if (!options.force && cached) {
    if (cached.expiresAt > now) return cached.reachable;
  }

  const pending = fetch(backend.healthUrl, {
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    cache: "no-store",
  })
    .then(() => true)
    .catch(() => false)
    .then((reachable) => {
      cache.set(backend.healthUrl, {
        reachable,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return reachable;
    });

  cache.set(backend.healthUrl, {
    reachable: cached?.reachable ?? false,
    expiresAt: 0,
    pending,
  });
  return pending;
}

export function clearLocalBackendStatusCache(): void {
  cache.clear();
}
