/**
 * Service-worker wiring for the background chat host: builds the agent from
 * stored settings (cached per settings snapshot), accepts UI ports, and
 * keeps the SW alive while a run is active (calling an extension API resets
 * the MV3 idle timer).
 *
 * Kept separate from chat-host.ts so the host state machine stays free of
 * the browser-runtime barrel (whose module-level IndexedDB singletons don't
 * exist in test environments).
 */

import { AIPex, ContextManager, SessionStorage } from "@aipexstudio/aipex-core";
import {
  allBrowserProviders,
  IndexedDBStorage,
} from "@aipexstudio/browser-runtime";
import {
  startFreshGatewayThread,
  supportsParallelSubagents,
} from "./ai-provider";
import {
  BROWSER_AGENT_CONFIG,
  createBrowserModel,
  loadAppSettings,
  loadAutomationMode,
  loadParallelAgentEnabled,
  resolveBrowserTools,
} from "./browser-model";
import {
  type ChatHost,
  type ChatHostAgent,
  type ChatPortLike,
  createChatHost,
} from "./chat-host";
import { CHAT_PORT_NAME } from "./chat-port-protocol";
import { ORCHESTRATOR_GUIDANCE } from "./research-agents";
import { createRunSubagentTool } from "./run-subagent";

const KEEPALIVE_INTERVAL_MS = 20_000;

export function initBackgroundChatHost(): ChatHost {
  let cached: { key: string; agent: ChatHostAgent } | null = null;

  const createAgent = async (): Promise<ChatHostAgent> => {
    const [settings, mode, parallelEnabled] = await Promise.all([
      loadAppSettings(),
      loadAutomationMode(),
      loadParallelAgentEnabled(),
    ]);
    const key = JSON.stringify({ settings, mode, parallelEnabled });
    if (cached && cached.key === key) {
      return cached.agent;
    }

    // The run_subagent tool is added only when the user switched on the
    // parallel-research agent AND the model can issue parallel requests
    // (gemini/grok/codex). Off by default and unavailable on the web gateways
    // (single shared thread), so subagent fan-out never happens unasked.
    const parallel =
      parallelEnabled && supportsParallelSubagents(settings.aiModel);
    const orchestratorTools = parallel
      ? [...resolveBrowserTools(mode), createRunSubagentTool()]
      : resolveBrowserTools(mode);
    const instructions = parallel
      ? `${BROWSER_AGENT_CONFIG.instructions}\n\n${ORCHESTRATOR_GUIDANCE}`
      : BROWSER_AGENT_CONFIG.instructions;

    const agent = AIPex.create({
      name: BROWSER_AGENT_CONFIG.name,
      instructions,
      model: createBrowserModel(settings),
      tools: orchestratorTools,
      storage: new SessionStorage(
        new IndexedDBStorage({
          dbName: "aipex-sessions",
          storeName: "sessions",
        }),
      ),
      contextManager: new ContextManager({
        providers: allBrowserProviders,
        autoInitialize: true,
      }),
      maxTurns: BROWSER_AGENT_CONFIG.maxTurns,
    });
    cached = { key, agent: agent as unknown as ChatHostAgent };
    return cached.agent;
  };

  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  const onActiveChange = (active: boolean): void => {
    if (active && keepaliveTimer === null) {
      keepaliveTimer = setInterval(() => {
        void chrome.runtime.getPlatformInfo();
      }, KEEPALIVE_INTERVAL_MS);
    } else if (!active && keepaliveTimer !== null) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
  };

  const host = createChatHost({
    createAgent,
    freshGatewayThread: startFreshGatewayThread,
    onActiveChange,
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === CHAT_PORT_NAME) {
      host.handlePort(port as unknown as ChatPortLike);
    }
  });

  return host;
}
