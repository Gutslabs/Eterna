import { CLI_PROXY_API_KEY, isCliProxyModel } from "./ai-provider";

export interface LocalBackendDescriptor {
  key: "cliproxy";
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
  if (isCliProxyModel(model)) {
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
    // Authenticated so the probe doesn't spray 401s into the console; any
    // HTTP response still counts as reachable below.
    headers: { Authorization: `Bearer ${CLI_PROXY_API_KEY}` },
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
