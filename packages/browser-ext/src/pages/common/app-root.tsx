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
import { chromeStorageAdapter } from "../../hooks";
import {
  isByokConfigured,
  isCatGptGatewayModel,
  isChatGptModel,
  isClaudeGatewayModel,
  isGeminiGatewayModel,
  isXaiGatewayModel,
} from "../../lib/ai-provider";
import { AutoScreenshotToggle } from "../../lib/auto-screenshot-toggle";
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
import { LocalBackendIndicator } from "../../lib/local-backend-indicator";
import { probeLocalBackend } from "../../lib/local-backend-status";
import {
  bindOpenEternaShortcut,
  closeEternaPanel,
} from "../../lib/open-eterna-shortcut";
import { ParallelAgentToggle } from "../../lib/parallel-agent-toggle";
import { PromptLibrary } from "../../lib/prompt-library";
import { getRemoteBrowserAgent } from "../../lib/remote-agent";
import { SelectionAutoSend } from "../../lib/selection-autosend";
import { suppressStaleContextErrors } from "../../lib/suppress-stale-errors";

const i18nStorageAdapter = new ChromeStorageAdapter<Language>();
const themeStorageAdapter = new ChromeStorageAdapter<Theme>();

/**
 * Pre-flight configuration check. Every supported path (ChatGPT OAuth, local
 * gateways, BYOK) authenticates on its own; when none is configured the chat
 * blocks with guidance instead of redirecting anywhere.
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
    isXaiGatewayModel(settings.aiModel) ||
    isClaudeGatewayModel(settings.aiModel)
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

  return {
    needsAuth: false,
    hasCustomConfig: false,
    blockMessage:
      "No AI provider configured. Open Settings and sign in with ChatGPT, " +
      "start a local gateway, or add your own API key.",
  };
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
  "Birkaç saniye sonra tekrar dene. İlk kez giriş gerekiyorsa `cliproxyapi -antigravity-login`.",
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

const CLAUDE_OFFLINE_GUIDE = [
  "### ⚠️ Claude proxy kapalı",
  "",
  "Claude için **CLIProxyAPI** (`localhost:8317`) çalışmıyor. Terminalde başlat:",
  "",
  "```bash",
  "brew services start cliproxyapi",
  "```",
  "",
  "Birkaç saniye sonra tekrar dene. İlk kez giriş gerekiyorsa `cliproxyapi -claude-login`.",
].join("\n");

/**
 * If the model needs a local backend (Docker gateway or the Gemini proxy) and
 * it isn't reachable, return a markdown guide to start it; otherwise null.
 */
async function offlineBackendGuide(
  model: string | undefined,
): Promise<string | null> {
  const reachable = await probeLocalBackend(model);
  if (reachable) return null;

  if (model?.startsWith("catgpt-browser")) {
    return gatewayOfflineGuide("gpt-web (ChatGPT)", "catgpt");
  }
  if (model?.startsWith("claude-browser")) {
    return gatewayOfflineGuide("claude-web (Claude)", "catgpt-claude");
  }
  if (isGeminiGatewayModel(model)) {
    return GEMINI_OFFLINE_GUIDE;
  }
  if (isXaiGatewayModel(model)) {
    return GROK_OFFLINE_GUIDE;
  }
  if (isClaudeGatewayModel(model)) {
    return CLAUDE_OFFLINE_GUIDE;
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

  // Keep a ref to settings so the auth check always sees latest values
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const handleCheckAuth = useCallback(() => checkAuth(settingsRef.current), []);

  const [interventionMode, setInterventionMode] =
    useState<InterventionMode>("passive");

  // Cmd+E inside the chat surface closes it — the second half of the toggle,
  // for when focus sits in the panel rather than the page.
  useEffect(
    () => bindOpenEternaShortcut(window, () => closeEternaPanel(window)),
    [],
  );

  // Sidepanel lifecycle: port connection + cleanup on hide/close
  useEffect(() => {
    // Long-lived port so the background can detect sidepanel disconnect
    const port = chrome.runtime.connect({ name: "sidepanel" });

    // Report which window this surface lives in so the background's Cmd+E
    // toggle can find it, and close ourselves when that toggle asks us to.
    chrome.windows
      .getCurrent()
      .then((win) => {
        if (win.id !== undefined) {
          port.postMessage({ request: "sidepanel-window", windowId: win.id });
        }
      })
      .catch(() => {
        /* windows API unavailable in this context */
      });
    port.onMessage.addListener((message: { request?: string }) => {
      if (message?.request === "close-sidepanel") closeEternaPanel(window);
    });

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
            composerTools: () => (
              <>
                <LocalBackendIndicator />
                <ParallelAgentToggle />
                <AutoScreenshotToggle />
              </>
            ),
            inputHeader: () => <PromptLibrary />,
            promptExtras: () => <BrowserContextLoader />,
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
          <ChatApp />
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
