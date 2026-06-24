/**
 * Browser Extension App Root
 * Simple wrapper using browser-specific hooks
 */

import type { AIPex, AppSettings } from "@aipexstudio/aipex-core";
import ChatBot from "@aipexstudio/aipex-react/components/chatbot";
import { ErrorBoundary } from "@aipexstudio/aipex-react/components/error/ErrorBoundary";
import type { InterventionMode } from "@aipexstudio/aipex-react/components/intervention";
import { useChatConfig } from "@aipexstudio/aipex-react/hooks";
import { I18nProvider } from "@aipexstudio/aipex-react/i18n/context";
import type { Language } from "@aipexstudio/aipex-react/i18n/types";
import { ThemeProvider } from "@aipexstudio/aipex-react/theme/context";
import type { Theme } from "@aipexstudio/aipex-react/theme/types";
import type { AuthCheckResult } from "@aipexstudio/aipex-react/types";
import { ChromeStorageAdapter } from "@aipexstudio/browser-runtime";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactDOM from "react-dom/client";
import { AuthProvider, useAuth } from "../../auth";
import { chromeStorageAdapter } from "../../hooks";
import {
  isByokConfigured,
  isCatGptGatewayModel,
  isChatGptModel,
  isGeminiGatewayModel,
  isXaiGatewayModel,
} from "../../lib/ai-provider";
import { BrowserChatHeader } from "../../lib/browser-chat-header";
import { BrowserChatInputArea } from "../../lib/browser-chat-input-area";
import { BrowserContextLoader } from "../../lib/browser-context-loader";
import { BrowserMessageActions } from "../../lib/browser-message-actions";
import { BrowserMessageList } from "../../lib/browser-message-list";
import { BrowserWelcomeScreen } from "../../lib/browser-welcome-screen";
import { ChatImagesListener } from "../../lib/chat-images-listener";
import { ChatInputToolbar } from "../../lib/chat-input-toolbar";
import { InputModeProvider } from "../../lib/input-mode-context";
import { InterventionModeProvider } from "../../lib/intervention-mode-context";
import { InterventionUI } from "../../lib/intervention-ui";
import { ParallelAgentToggle } from "../../lib/parallel-agent-toggle";
import { PromptLibrary } from "../../lib/prompt-library";
import { getRemoteBrowserAgent } from "../../lib/remote-agent";
import { SelectionAutoSend } from "../../lib/selection-autosend";
import { suppressStaleContextErrors } from "../../lib/suppress-stale-errors";

const i18nStorageAdapter = new ChromeStorageAdapter<Language>();
const themeStorageAdapter = new ChromeStorageAdapter<Theme>();

// ---------------------------------------------------------------------------
// Replay setup listener
// ---------------------------------------------------------------------------

/** Replay step shape coming from the external website */
interface ReplayStepData {
  id?: number;
  event: { type: string; [key: string]: unknown };
  url?: string | null;
  aiTitle?: string | null;
  aiSummary?: string | null;
}

/**
 * Listens for `NAVIGATE_AND_SETUP_REPLAY` messages forwarded by the
 * background service worker after an external `REPLAY_USER_MANUAL` request.
 *
 * The replay steps are persisted to `chrome.storage.local` under
 * `aipex-pending-replay` so they can be consumed by the use-case system
 * when it is available.
 */
function useReplaySetup() {
  useEffect(() => {
    const handler = (message: Record<string, unknown>) => {
      if (message?.request !== "NAVIGATE_AND_SETUP_REPLAY") return;

      const data = message.data as
        | {
            manualId?: number;
            startFromStep?: number;
            steps?: ReplayStepData[];
          }
        | undefined;

      if (!data || !Array.isArray(data.steps) || data.steps.length === 0) {
        console.warn("[ReplaySetup] Invalid or empty replay data received");
        return;
      }

      // Persist replay data for future use-case system consumption
      chrome.storage.local
        .set({
          "aipex-pending-replay": {
            manualId: data.manualId,
            startFromStep: data.startFromStep ?? 0,
            steps: data.steps,
            receivedAt: Date.now(),
          },
        })
        .catch(() => {
          /* storage may be unavailable */
        });

      console.log(
        "[ReplaySetup] Replay data stored:",
        data.steps.length,
        "steps for manual",
        data.manualId,
      );
    };

    chrome.runtime.onMessage.addListener(handler);
    return () => {
      chrome.runtime.onMessage.removeListener(handler);
    };
  }, []);
}

// ---------------------------------------------------------------------------
// Pending prompt
// ---------------------------------------------------------------------------

/**
 * Reads and consumes a pending prompt saved by the openWithPrompt external
 * message handler in the background service worker.  Prompts older than 5 s
 * are treated as expired and silently discarded.
 */
function usePendingPrompt() {
  const [pendingInput, setPendingInput] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    const check = async () => {
      try {
        const result = await chrome.storage.local.get([
          "aipex-pending-prompt",
          "aipex-pending-prompt-timestamp",
        ]);

        const prompt = result["aipex-pending-prompt"];
        const timestamp = result["aipex-pending-prompt-timestamp"];

        if (prompt && typeof prompt === "string") {
          const now = Date.now();
          // Only use prompts that are less than 5 seconds old
          if (typeof timestamp === "number" && now - timestamp < 5000) {
            setPendingInput(prompt);
          }
        }

        // Always clear storage regardless of expiry
        if (prompt) {
          chrome.storage.local.remove([
            "aipex-pending-prompt",
            "aipex-pending-prompt-timestamp",
          ]);
        }
      } catch {
        // Silently ignore – storage may not be available yet
      }
    };

    check();
  }, []);

  return pendingInput;
}

/**
 * Pre-flight auth check for non-BYOK users.
 *
 * Mirrors old aipex logic: if BYOK is not configured and the user is not
 * logged in (no auth cookies for claudechrome.com), the user needs to
 * authenticate before sending a message.
 */
async function checkAuth(
  settings: ReturnType<typeof useChatConfig>["settings"],
): Promise<AuthCheckResult> {
  // ChatGPT subscription (OAuth) and the local CatGPT-Gateway handle their own
  // auth, so AIPex doesn't need a login before sending.
  if (
    isChatGptModel(settings.aiModel) ||
    isCatGptGatewayModel(settings.aiModel) ||
    isGeminiGatewayModel(settings.aiModel) ||
    isXaiGatewayModel(settings.aiModel)
  ) {
    const offline = await offlineBackendGuide(settings.aiModel);
    if (offline) {
      return { needsAuth: false, hasCustomConfig: true, blockMessage: offline };
    }
    return { needsAuth: false, hasCustomConfig: true };
  }

  // If user has BYOK configured, no auth check needed
  if (isByokConfigured(settings)) {
    return { needsAuth: false, hasCustomConfig: true };
  }

  // Non-BYOK path: check if user is logged in
  try {
    const savedUser = await chrome.storage.local.get("user");
    if (savedUser?.user) {
      return { needsAuth: false, hasCustomConfig: false };
    }
  } catch {
    // Storage access failed – fall through to needsAuth
  }

  return { needsAuth: true, hasCustomConfig: false };
}

/** Quick reachability probe for a local backend (any HTTP response = up). */
async function isBackendReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2500) });
    return true;
  } catch {
    return false;
  }
}

function gatewayOfflineGuide(label: string, container: string): string {
  return [
    `### ⚠️ ${label} kapalı`,
    "",
    `**${label}** için yerel gateway (Docker) çalışmıyor.`,
    "",
    "1. **Docker Desktop**'ı aç.",
    "2. Terminalde container'ı başlat:",
    "",
    "```bash",
    `docker start ${container}`,
    "```",
    "",
    "Hazır olunca (~1 dk) tekrar dene.",
  ].join("\n");
}

const GEMINI_OFFLINE_GUIDE = [
  "### ⚠️ Gemini proxy kapalı",
  "",
  "Gemini için **CLIProxyAPI** (`localhost:8317`) çalışmıyor. Terminalde başlat:",
  "",
  "```bash",
  "brew services start cliproxyapi",
  "```",
  "",
  "Birkaç saniye sonra tekrar dene. İlk kez giriş gerekiyorsa `cliproxyapi -login`.",
].join("\n");

const GROK_OFFLINE_GUIDE = [
  "### ⚠️ Grok proxy kapalı",
  "",
  "Grok için **CLIProxyAPI** (`localhost:8317`) çalışmıyor. Terminalde başlat:",
  "",
  "```bash",
  "brew services start cliproxyapi",
  "```",
  "",
  "Birkaç saniye sonra tekrar dene. İlk kez giriş gerekiyorsa `cliproxyapi -xai-login`.",
].join("\n");

/**
 * If the model needs a local backend (Docker gateway or the Gemini proxy) and
 * it isn't reachable, return a markdown guide to start it; otherwise null.
 */
async function offlineBackendGuide(
  model: string | undefined,
): Promise<string | null> {
  if (model?.startsWith("catgpt-browser")) {
    return (await isBackendReachable("http://localhost:8000/healthz"))
      ? null
      : gatewayOfflineGuide("gpt-web (ChatGPT)", "catgpt");
  }
  if (model?.startsWith("claude-browser")) {
    return (await isBackendReachable("http://localhost:8001/healthz"))
      ? null
      : gatewayOfflineGuide("claude-web (Claude)", "catgpt-claude");
  }
  if (isGeminiGatewayModel(model)) {
    return (await isBackendReachable("http://localhost:8317/v1/models"))
      ? null
      : GEMINI_OFFLINE_GUIDE;
  }
  if (isXaiGatewayModel(model)) {
    return (await isBackendReachable("http://localhost:8317/v1/models"))
      ? null
      : GROK_OFFLINE_GUIDE;
  }
  return null;
}

const NOT_CONFIGURED_ERROR_MESSAGE = "API token or model not configured";

/**
 * The agent itself runs in the background service worker (chat-host); the
 * UI only validates that the configuration is complete enough to send.
 */
function validateAgentConfig(settings: AppSettings): Error | undefined {
  const isByok = Boolean(settings.byokEnabled && settings.aiToken?.trim());
  if (isByok && !settings.aiModel?.trim()) {
    return new Error(NOT_CONFIGURED_ERROR_MESSAGE);
  }
  return undefined;
}

function ChatApp() {
  const { settings, isLoading } = useChatConfig({
    storageAdapter: chromeStorageAdapter,
    autoLoad: true,
  });

  // Port-backed stand-in for the AIPex agent — the run loop lives in the
  // background service worker so a turn survives host-page refresh.
  // A fresh wrapper identity per model keeps useChat's "agent changed →
  // reset session" semantics from the local-agent days.
  const aiModel = settings.aiModel;
  const agent = useMemo(() => {
    if (isLoading) return undefined;
    void aiModel;
    const client = getRemoteBrowserAgent();
    return {
      chat: client.chat.bind(client),
      rollbackLastAssistantTurn: client.rollbackLastAssistantTurn.bind(client),
      getConversationManager: client.getConversationManager.bind(client),
    } as unknown as AIPex;
  }, [isLoading, aiModel]);
  const error = useMemo(
    () => (isLoading ? undefined : validateAgentConfig(settings)),
    [isLoading, settings],
  );

  const { login } = useAuth();
  const pendingInput = usePendingPrompt();
  useReplaySetup();

  // Keep a ref to settings so the auth check always sees latest values
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const handleCheckAuth = useCallback(() => checkAuth(settingsRef.current), []);

  const [interventionMode, setInterventionMode] =
    useState<InterventionMode>("passive");

  // Sidepanel lifecycle: port connection + cleanup on hide/close
  useEffect(() => {
    // Long-lived port so the background can detect sidepanel disconnect
    const port = chrome.runtime.connect({ name: "sidepanel" });

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Stop any active recording
        chrome.runtime.sendMessage({ request: "stop-recording" }).catch(() => {
          /* background may be busy */
        });
        // Stop element capture on the active tab
        chrome.runtime
          .sendMessage({
            request: "relay-to-active-tab",
            message: { request: "stop-capture" },
          })
          .catch(() => {
            /* tab may be closed */
          });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      port.disconnect();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <InputModeProvider>
      <InterventionModeProvider
        mode={interventionMode}
        setMode={setInterventionMode}
      >
        <ChatBot
          agent={agent}
          configError={error}
          initialSettings={settings}
          storageAdapter={chromeStorageAdapter}
          initialInput={pendingInput}
          handlers={{
            checkAuthBeforeSend: handleCheckAuth,
          }}
          components={{
            Header: BrowserChatHeader,
            MessageList: BrowserMessageList,
            InputArea: BrowserChatInputArea,
            WelcomeScreen: BrowserWelcomeScreen,
          }}
          slots={{
            afterMessages: () => (
              <>
                <InterventionUI
                  mode={interventionMode}
                  onModeChange={setInterventionMode}
                />
                <ChatImagesListener />
                <SelectionAutoSend />
              </>
            ),
            messageActions: (props) => <BrowserMessageActions {...props} />,
            inputToolbar: (props) => <ChatInputToolbar {...props} />,
            composerTools: () => <ParallelAgentToggle />,
            inputHeader: () => <PromptLibrary />,
            promptExtras: () => <BrowserContextLoader />,
            onLogin: login,
          }}
        />
      </InterventionModeProvider>
    </InputModeProvider>
  );
}

export function renderChatApp() {
  suppressStaleContextErrors();
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    return;
  }

  const App = () => (
    <ErrorBoundary>
      <I18nProvider storageAdapter={i18nStorageAdapter}>
        <ThemeProvider storageAdapter={themeStorageAdapter}>
          <AuthProvider>
            <ChatApp />
          </AuthProvider>
        </ThemeProvider>
      </I18nProvider>
    </ErrorBoundary>
  );

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
