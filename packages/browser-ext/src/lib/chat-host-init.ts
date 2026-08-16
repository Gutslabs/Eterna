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

import {
  allBrowserProviders,
  captureConversationToSupermemory,
  captureViewportForAmbient,
  chromeStorageAdapter,
  conversationStorage,
  fetchSupermemoryProfileCached,
  IndexedDBStorage,
  importLocalMemoriesOnce,
  loadMemories,
  renderMemoriesForPrompt,
  renderProfileForPrompt,
  renderSkillIndexForPrompt,
  resolveSkillTurnContexts,
} from "@eterna/browser-runtime";
import { ContextManager, Eterna, SessionStorage } from "@eterna/core";
import { buildSystemPrompt } from "@eterna/react/components/chatbot/constants";
import {
  BROWSER_AGENT_CONFIG,
  createBrowserModel,
  loadAppSettings,
  loadAutomationMode,
  loadAutoScreenshotEnabled,
  loadIdentity,
  loadSoul,
  modelSupportsVision,
  renderPersonaForPrompt,
  resolveBrowserTools,
} from "./browser-model";
import {
  type ChatHost,
  type ChatHostAgent,
  type ChatHostAgentContext,
  type ChatPortLike,
  createChatHost,
} from "./chat-host";
import type { RunSnapshot, WireAgentEvent } from "./chat-port-protocol";
import { CHAT_PORT_NAME } from "./chat-port-protocol";
import { createSerializedDetachedRunPersistence } from "./detached-run-persistence";
import {
  createScheduledAutomationManager,
  isScheduledAutomationRequest,
} from "./scheduled-automations";

const KEEPALIVE_INTERVAL_MS = 20_000;

// Auto-capture: user messages carry the auto-attached page block first and the
// typed ask last, so keep the tail; cap the answer to keep extraction cheap.
const CAPTURE_USER_TAIL_CHARS = 2000;
const CAPTURE_ASSISTANT_CHARS = 4000;

/**
 * Feed a finished turn to the Supermemory extraction pipeline so the profile
 * learns from every conversation without an explicit `remember`. Best-effort:
 * unconfigured/offline servers make this a no-op.
 */
function captureTurnForMemory(run: RunSnapshot): void {
  const user = run.userText.trim();
  const assistant = run.events
    .filter(
      (event): event is Extract<WireAgentEvent, { type: "content_delta" }> =>
        event.type === "content_delta",
    )
    .map((event) => event.delta)
    .join("")
    .trim();
  if (!user || !assistant) {
    return;
  }
  const userTail =
    user.length > CAPTURE_USER_TAIL_CHARS
      ? `…${user.slice(-CAPTURE_USER_TAIL_CHARS)}`
      : user;
  void captureConversationToSupermemory(
    run.sessionId ?? run.conversationId ?? run.runId,
    [
      { role: "user", content: userTail },
      {
        role: "assistant",
        content: assistant.slice(0, CAPTURE_ASSISTANT_CHARS),
      },
    ],
  );
}

interface StoredAgentInputs {
  settings: Awaited<ReturnType<typeof loadAppSettings>>;
  storedMode: Awaited<ReturnType<typeof loadAutomationMode>>;
  memories: Awaited<ReturnType<typeof loadMemories>>;
  identity: string;
  soul: string;
  autoScreenshot: boolean;
}

export function initBackgroundChatHost(): ChatHost {
  let cachedAgent: { key: string; agent: ChatHostAgent } | null = null;

  // All six inputs live in chrome.storage.local and change orders of
  // magnitude less often than turns run, so they are snapshotted in memory
  // and invalidated by the storage listener below — instead of six storage
  // IPC round-trips at the start of every turn.
  let storedInputsPromise: Promise<StoredAgentInputs> | null = null;
  const loadStoredInputs = (): Promise<StoredAgentInputs> => {
    storedInputsPromise ??= Promise.all([
      loadAppSettings(),
      loadAutomationMode(),
      loadMemories(),
      loadIdentity(),
      loadSoul(),
      loadAutoScreenshotEnabled(),
    ]).then(
      ([settings, storedMode, memories, identity, soul, autoScreenshot]) => ({
        settings,
        storedMode,
        memories,
        identity,
        soul,
        autoScreenshot,
      }),
      (error) => {
        storedInputsPromise = null;
        throw error;
      },
    );
    return storedInputsPromise;
  };
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "local") {
      storedInputsPromise = null;
    }
  });

  const createAgent = async (
    context?: ChatHostAgentContext,
  ): Promise<ChatHostAgent> => {
    const [
      { settings, storedMode, memories, identity, soul },
      profile,
      skillIndex,
    ] = await Promise.all([
      loadStoredInputs(),
      // Cached (60s) so agent rebuilds don't hit the server — or its
      // timeout when it's down — on every turn. Null when unconfigured.
      fetchSupermemoryProfileCached(),
      // One line per enabled skill; the SKILL.md bodies load on demand.
      renderSkillIndexForPrompt(),
    ]);
    const mode = context?.automationMode ?? storedMode;
    const profileBlock = renderProfileForPrompt(profile);
    const key = JSON.stringify({
      settings,
      mode,
      memories,
      identity,
      soul,
      profileBlock,
      skillIndex,
    });
    if (cachedAgent?.key === key) {
      return cachedAgent.agent;
    }

    const supportsVision = modelSupportsVision(settings.aiModel);
    const browserTools = resolveBrowserTools(mode, supportsVision);
    // The prompt must match the resolved bundle: screenshot tools are
    // stripped in background mode or for text-only models, so the vision
    // section is gated by the exact same condition.
    const base = buildSystemPrompt({
      vision: supportsVision && mode !== "background",
    });
    const instructions = [
      base,
      skillIndex,
      renderPersonaForPrompt(identity, soul),
      renderMemoriesForPrompt(memories),
      profileBlock,
    ]
      .filter(Boolean)
      .join("\n\n");

    const agent = Eterna.create({
      name: BROWSER_AGENT_CONFIG.name,
      instructions,
      model: createBrowserModel(settings),
      tools: browserTools,
      storage: new SessionStorage(
        new IndexedDBStorage({
          dbName: "eterna-sessions",
          storeName: "sessions",
        }),
      ),
      contextManager: new ContextManager({
        providers: allBrowserProviders,
        autoInitialize: true,
      }),
      maxTurns: BROWSER_AGENT_CONFIG.maxTurns,
      supportsVision,
      // Summaries go through the same gateway as the chat model.
      compression: {
        model: createBrowserModel(settings),
        ...BROWSER_AGENT_CONFIG.compression,
      },
    });
    cachedAgent = {
      key,
      agent: agent as unknown as ChatHostAgent,
    };
    return cachedAgent.agent;
  };

  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let activeSources = 0;
  const onActiveChange = (active: boolean): void => {
    activeSources = Math.max(0, activeSources + (active ? 1 : -1));
    if (activeSources > 0 && keepaliveTimer === null) {
      keepaliveTimer = setInterval(() => {
        void chrome.runtime.getPlatformInfo();
      }, KEEPALIVE_INTERVAL_MS);
    } else if (activeSources === 0 && keepaliveTimer !== null) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
  };
  const persistCompletedRun =
    createSerializedDetachedRunPersistence(conversationStorage);

  const host = createChatHost({
    createAgent,
    // Capture the viewport only after the user explicitly enables screen sharing.
    captureViewport: async () => {
      const { settings, autoScreenshot } = await loadStoredInputs();
      return autoScreenshot && modelSupportsVision(settings.aiModel)
        ? await captureViewportForAmbient()
        : null;
    },
    onActiveChange,
    onRunComplete: persistCompletedRun,
    onTurnComplete: captureTurnForMemory,
    // Deterministic skill routing: matching asks get the skill's SKILL.md
    // attached to the turn, instead of hoping the model calls load_skill.
    resolveTurnContexts: resolveSkillTurnContexts,
  });

  // Warm the profile with the pre-Supermemory local facts, once.
  void importLocalMemoriesOnce();

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === CHAT_PORT_NAME) {
      host.handlePort(port as unknown as ChatPortLike);
    }
  });

  const scheduledAutomations = createScheduledAutomationManager({
    storage: chromeStorageAdapter,
    alarms: {
      create: (name, info) => chrome.alarms.create(name, info),
      clear: (name) => chrome.alarms.clear(name),
    },
    runPrompt: async (automation) => {
      onActiveChange(true);
      try {
        const agent = await createAgent({
          clientId: `scheduled-automation:${automation.id}`,
          sessionId: automation.sessionId,
          automationMode: "background",
        });
        let sessionId = automation.sessionId;
        let runError: Error | undefined;
        for await (const event of agent.chat(automation.prompt, {
          sessionId,
        })) {
          if (
            event.type === "session_created" ||
            event.type === "session_resumed"
          ) {
            sessionId = event.sessionId;
          } else if (event.type === "error") {
            runError = event.error;
          }
        }
        if (runError) throw runError;
        return { sessionId };
      } finally {
        onActiveChange(false);
      }
    },
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    void scheduledAutomations.handleAlarm(alarm.name);
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isScheduledAutomationRequest(message)) return false;
    void scheduledAutomations.handleRequest(message).then(
      (data) => sendResponse({ success: true, data }),
      (error) =>
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    return true;
  });
  void scheduledAutomations.initialize();

  return host;
}
