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
  captureViewportForAmbient,
  conversationStorage,
  IndexedDBStorage,
  loadMemories,
  renderMemoriesForPrompt,
} from "@aipexstudio/browser-runtime";
import {
  isCatGptGatewayModel,
  startFreshGatewayThread,
  supportsParallelSubagents,
} from "./ai-provider";
import {
  BROWSER_AGENT_CONFIG,
  createBrowserModel,
  loadAppSettings,
  loadAutomationMode,
  loadAutoScreenshotEnabled,
  loadParallelAgentEnabled,
  resolveBrowserTools,
} from "./browser-model";
import {
  type ChatHost,
  type ChatHostAgent,
  type ChatHostAgentContext,
  type ChatPortLike,
  createChatHost,
} from "./chat-host";
import { CHAT_PORT_NAME } from "./chat-port-protocol";
import { createSerializedDetachedRunPersistence } from "./detached-run-persistence";
import { ORCHESTRATOR_GUIDANCE } from "./research-agents";
import { createRunSubagentTool } from "./run-subagent";

const KEEPALIVE_INTERVAL_MS = 20_000;

export function initBackgroundChatHost(): ChatHost {
  const cachedAgents = new Map<string, { key: string; agent: ChatHostAgent }>();

  const createAgent = async (
    context?: ChatHostAgentContext,
  ): Promise<ChatHostAgent> => {
    const [settings, mode, parallelEnabled, memories] = await Promise.all([
      loadAppSettings(),
      loadAutomationMode(),
      loadParallelAgentEnabled(),
      loadMemories(),
    ]);
    const key = JSON.stringify({ settings, mode, parallelEnabled, memories });
    const gatewayRouteId = isCatGptGatewayModel(settings.aiModel)
      ? context?.routeId
      : undefined;
    const cacheSlot = gatewayRouteId ?? "shared";
    const cached = cachedAgents.get(cacheSlot);
    if (cached?.key === key) {
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
    const baseInstructions = parallel
      ? `${BROWSER_AGENT_CONFIG.instructions}\n\n${ORCHESTRATOR_GUIDANCE}`
      : BROWSER_AGENT_CONFIG.instructions;
    const memoryBlock = renderMemoriesForPrompt(memories);
    const instructions = memoryBlock
      ? `${baseInstructions}\n\n${memoryBlock}`
      : baseInstructions;

    const agent = AIPex.create({
      name: BROWSER_AGENT_CONFIG.name,
      instructions,
      model: createBrowserModel(settings, gatewayRouteId),
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
      // Summaries go through the same gateway as the chat model.
      compression: {
        model: createBrowserModel(settings),
        ...BROWSER_AGENT_CONFIG.compression,
      },
    });
    const cachedAgent = {
      key,
      agent: agent as unknown as ChatHostAgent,
    };
    cachedAgents.delete(cacheSlot);
    cachedAgents.set(cacheSlot, cachedAgent);
    if (cachedAgents.size > 100) {
      const oldestSlot = cachedAgents.keys().next().value;
      if (oldestSlot !== undefined) {
        cachedAgents.delete(oldestSlot);
      }
    }
    return cachedAgent.agent;
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
  const persistCompletedRun =
    createSerializedDetachedRunPersistence(conversationStorage);

  const host = createChatHost({
    createAgent,
    // Capture the viewport only after the user explicitly enables screen sharing.
    captureViewport: async () =>
      (await loadAutoScreenshotEnabled())
        ? await captureViewportForAmbient()
        : null,
    freshGatewayThread: startFreshGatewayThread,
    onActiveChange,
    onRunComplete: persistCompletedRun,
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === CHAT_PORT_NAME) {
      host.handlePort(port as unknown as ChatPortLike);
    }
  });

  return host;
}
