/**
 * Background Service Worker
 * Handles extension lifecycle events and keyboard commands
 */

import { initBackgroundChatHost } from "./lib/chat-host-init";
import { supportsNativeSidePanel } from "./lib/native-side-panel";
import { writePendingAutosend } from "./lib/pending-autosend";
import { launchEternaInTerminal } from "./lib/terminal-launcher";
import {
  buildAuthorizeUrl,
  clearStoredAuth,
  createState,
  exchangeCode,
  generatePkce,
  getStoredAuth,
  setStoredAuth,
} from "./services/chatgpt-auth";

const SIDE_PANEL_PATH = "src/sidepanel.html";

// Agent run loop lives here in the SW so an in-flight turn survives
// host-page refresh/navigation; the sidebar attaches over a port.
initBackgroundChatHost();

// Absolute last resort (no chrome.sidePanel AND the in-page overlay can't run —
// e.g. a restricted chrome:// page): open the chat in a NORMAL browser tab.
//
// It deliberately never opens a `type:"popup"` window: macOS draws popup windows
// with their own rounded border/frame + shadow, and THAT window chrome was the
// stray "border" around the panel (Echo, which only ever uses the docked native
// panel, has none). The native side panel and the in-page overlay are both
// borderless — a plain tab keeps this path borderless too.
async function openPanelTab() {
  const url = chrome.runtime.getURL(SIDE_PANEL_PATH);
  const [existing] = await chrome.tabs.query({ url });
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url });
}

// Inject the content script into a tab that doesn't have it yet (e.g. it was
// open before the extension loaded / updated). Returns false on restricted
// pages (chrome://, the web store) where scripting isn't allowed.
async function ensureContentScript(tabId: number): Promise<boolean> {
  const file = chrome.runtime.getManifest().content_scripts?.[0]?.js?.[0];
  if (!file) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [file],
    });
    return true;
  } catch {
    return false;
  }
}

// After injecting the content script, its bootstrap registers a message
// listener as it loads. Retry the open command briefly until it lands so the
// freshly-injected panel slides in — scoped to this one tab, no global flag.
async function openSidebarAfterInject(tabId: number): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      await chrome.tabs.sendMessage(tabId, { request: "open-eterna-sidebar" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }
}

// Prefer the in-page docked sidebar (works on every Chromium browser and has no
// window chrome). If the active tab has no content script yet, inject it and
// open the in-page panel — only truly restricted pages fall back to a window.
async function controlInPageSidebar(
  command: "open" | "toggle",
  tab?: chrome.tabs.Tab,
) {
  let targetTab = tab;
  if (targetTab?.id === undefined) {
    const [active] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    targetTab = active;
  }

  const tabId = targetTab?.id;
  if (tabId !== undefined) {
    try {
      await chrome.tabs.sendMessage(tabId, {
        request: `${command}-eterna-sidebar`,
      });
      return;
    } catch {
      // No content script yet (the tab was open before the extension loaded,
      // or is still initializing). Inject it and open the in-page panel rather
      // than popping a separate window.
      if (await ensureContentScript(tabId)) {
        await openSidebarAfterInject(tabId);
        return;
      }
    }
  }

  // Restricted page where content scripts can't run — open the chat in a
  // normal tab (borderless), never a popup window.
  await openPanelTab();
}

async function openOrToggleSidebar(tab?: chrome.tabs.Tab) {
  await controlInPageSidebar("toggle", tab);
}

async function openInPageSidebar(tab?: chrome.tabs.Tab) {
  await controlInPageSidebar("open", tab);
}

// Open Eterna from a user gesture (toolbar icon, keyboard shortcut). Prefer
// the browser-native side panel: it docks at the true window edge and spans
// the full height to the very top of the window — which an in-page overlay,
// bounded by the web viewport (always below the browser toolbar), cannot
// reach. If the native panel refuses to open (some Chromium forks drop the
// user-gesture attribution on relayed calls), fall back to the in-page
// sidebar — a differently docked panel beats nothing happening at all.
async function openSidebar(tab?: chrome.tabs.Tab) {
  if (supportsNativeSidePanel(chrome.sidePanel)) {
    try {
      if (tab?.id !== undefined) {
        await chrome.sidePanel.open({ tabId: tab.id });
      } else {
        const window = await chrome.windows.getCurrent();
        if (window.id !== undefined) {
          await chrome.sidePanel.open({ windowId: window.id });
        }
      }
      return;
    } catch (error) {
      console.error(
        "[Eterna] Native side panel open failed, using the in-page sidebar:",
        error,
      );
    }
  }
  await openInPageSidebar(tab);
}

// Live chat surfaces (native panel, overlay iframe, fallback tab) keyed by
// the window they belong to. Each surface connects the "sidepanel" port and
// reports its window, which is what lets Cmd+E toggle: a second press finds
// the open surface here and asks it to close itself — the only reliable close,
// since chrome.sidePanel has no close() and no gesture is needed for it.
const sidepanelPortsByWindow = new Map<number, Set<chrome.runtime.Port>>();

function registerSidepanelPort(port: chrome.runtime.Port, windowId: number) {
  let ports = sidepanelPortsByWindow.get(windowId);
  if (!ports) {
    ports = new Set();
    sidepanelPortsByWindow.set(windowId, ports);
  }
  ports.add(port);
}

function unregisterSidepanelPort(port: chrome.runtime.Port, windowId: number) {
  const ports = sidepanelPortsByWindow.get(windowId);
  if (!ports) return;
  ports.delete(port);
  if (ports.size === 0) sidepanelPortsByWindow.delete(windowId);
}

// Cmd+E semantics: close the chat surface open in this window, else open one.
async function toggleSidebar(tab?: chrome.tabs.Tab) {
  let windowId = tab?.windowId;
  if (windowId === undefined) {
    try {
      windowId = (await chrome.windows.getCurrent()).id;
    } catch {
      /* fall through to open */
    }
  }
  const ports =
    windowId === undefined ? undefined : sidepanelPortsByWindow.get(windowId);
  if (ports?.size) {
    for (const port of ports) {
      try {
        port.postMessage({ request: "close-sidepanel" });
      } catch {
        /* port already gone */
      }
    }
    return;
  }
  await openSidebar(tab);
}

// After an install/update, re-inject the content script into already-open tabs
// so the in-page sidebar works there right away. Chrome only auto-injects on
// navigation, so existing tabs would otherwise have no script and fall back to
// a popup window on the first click.
async function injectIntoOpenTabs() {
  const file = chrome.runtime.getManifest().content_scripts?.[0]?.js?.[0];
  if (!file) return;
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(
    tabs.map((tab) =>
      tab.id === undefined
        ? Promise.resolve()
        : chrome.scripting
            .executeScript({
              target: { tabId: tab.id, allFrames: true },
              files: [file],
            })
            .catch(() => {}),
    ),
  );
}

// Mirror Maple's working setup: on Chromium the toolbar icon opens the
// browser-native side panel directly (setPanelBehavior with no browser-action
// popup), which docks at the true window edge and spans full height to the very
// top of the window — something an in-page overlay (bounded by the web
// viewport, always below the browser toolbar) can never do. The onClicked
// listener then does NOTHING on Chromium; it only drives the in-page overlay on
// browsers that don't expose chrome.sidePanel.
const NATIVE_SIDE_PANEL_FLAG = "eterna-native-sidepanel";

async function configureSidePanel() {
  const sidePanel = chrome.sidePanel;
  const supported = supportsNativeSidePanel(sidePanel);
  // Tell the content-script overlay whether a native panel will handle the
  // sidebar, so it disables itself and never stacks on top of the native panel.
  try {
    await chrome.storage.local.set({ [NATIVE_SIDE_PANEL_FLAG]: supported });
  } catch {
    /* storage may be unavailable */
  }
  if (!supported) return;
  try {
    // No browser-action popup, so the icon click opens the side panel.
    await chrome.action.setPopup({ popup: "" });
  } catch (error) {
    console.warn("[Eterna] setPopup failed:", error);
  }
  try {
    await sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("[Eterna] setPanelBehavior failed:", error);
  }
}

void configureSidePanel();
chrome.runtime.onStartup.addListener(() => {
  void configureSidePanel();
});

chrome.action.onClicked.addListener((tab) => {
  // On Chromium the native side panel is opened by setPanelBehavior above (and
  // onClicked won't even fire there). This only runs on browsers without
  // chrome.sidePanel, where the in-page overlay is the sidebar.
  if (supportsNativeSidePanel(chrome.sidePanel)) return;
  openOrToggleSidebar(tab).catch((error) => {
    console.error("[Eterna] Failed to open:", error);
  });
});

// =============================================================================
// Sign in with ChatGPT (Codex OAuth)
// =============================================================================
// An extension can't run the localhost server Codex expects, so instead of
// letting the redirect to http://localhost:1455 load, we intercept that
// navigation and pull the authorization code out of the URL. The PKCE verifier
// and state are persisted so the flow survives a service-worker restart that
// can happen while the user is logging in.

const CHATGPT_CALLBACK_PREFIX = "http://localhost:1455/auth/callback";
const CHATGPT_PENDING_KEY = "chatgpt_oauth_pending";

interface PendingChatGptLogin {
  verifier: string;
  state: string;
  tabId?: number;
}

async function getPendingLogin(): Promise<PendingChatGptLogin | null> {
  const result = await chrome.storage.local.get(CHATGPT_PENDING_KEY);
  return (
    (result[CHATGPT_PENDING_KEY] as PendingChatGptLogin | undefined) ?? null
  );
}

function broadcastLoginResult(success: boolean, error?: string) {
  chrome.runtime
    .sendMessage({ request: "chatgpt-login-result", success, error })
    .catch(() => {
      // No receiver (UI closed) is fine.
    });
}

async function startChatGptLogin(): Promise<{
  started: boolean;
  error?: string;
}> {
  try {
    const { verifier, challenge } = await generatePkce();
    const state = createState();
    const authUrl = buildAuthorizeUrl(challenge, state);
    const tab = await chrome.tabs.create({ url: authUrl });
    await chrome.storage.local.set({
      [CHATGPT_PENDING_KEY]: { verifier, state, tabId: tab.id },
    });
    return { started: true };
  } catch (error) {
    return {
      started: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function completeChatGptLogin(callbackUrl: string, tabId: number) {
  const pending = await getPendingLogin();
  if (!pending) return;
  await chrome.storage.local.remove(CHATGPT_PENDING_KEY);

  try {
    const params = new URL(callbackUrl).searchParams;
    const error = params.get("error");
    const code = params.get("code");
    if (error || !code) {
      broadcastLoginResult(false, error ?? "No authorization code returned");
    } else if (params.get("state") !== pending.state) {
      broadcastLoginResult(false, "State mismatch");
    } else {
      const auth = await exchangeCode(code, pending.verifier);
      if (auth) {
        await setStoredAuth(auth);
        broadcastLoginResult(true);
      } else {
        broadcastLoginResult(false, "Token exchange failed");
      }
    }
  } catch (err) {
    broadcastLoginResult(
      false,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    chrome.tabs.remove(tabId).catch(() => {});
  }
}

chrome.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    void completeChatGptLogin(details.url, details.tabId);
  },
  { url: [{ urlPrefix: CHATGPT_CALLBACK_PREFIX }] },
);

chrome.tabs.onRemoved.addListener((closedTabId) => {
  getPendingLogin().then((pending) => {
    if (pending && pending.tabId === closedTabId) {
      chrome.storage.local.remove(CHATGPT_PENDING_KEY);
      broadcastLoginResult(false, "Login was cancelled");
    }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.request === "chatgpt-login") {
    startChatGptLogin().then(sendResponse);
    return true;
  }
  if (message?.request === "chatgpt-logout") {
    clearStoredAuth().then(() => sendResponse({ success: true }));
    return true;
  }
  if (message?.request === "chatgpt-status") {
    getStoredAuth().then((auth) =>
      sendResponse({
        signedIn: auth !== null,
        accountId: auth?.accountId ?? null,
      }),
    );
    return true;
  }
  return false;
});

// Cmd+E is deliberately NOT bound at the browser level. A browser-level
// "_execute_action" binding consumes the chord before any page or panel sees
// it, and some Chromium forks (Dia) only ever OPEN from it — a second press
// can never close the panel. The toggle lives in the in-page catcher plus the
// panel's own catcher instead, so warn if a leftover binding would shadow it.
async function auditActionShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const action = commands.find((c) => c.name === "_execute_action");
    if (action?.shortcut) {
      console.warn(
        `[Eterna] "${action.shortcut}" is bound to the toolbar action at the`,
        "browser level. It can only open the panel, never close it, and it",
        "shadows the in-page Cmd+E toggle — clear it in the extension",
        "shortcut settings.",
      );
    }
  } catch {
    /* commands API unavailable on this browser */
  }
}

void auditActionShortcut();

// =============================================================================
// Context menus
// =============================================================================
const MENU_ASK_SELECTION = "eterna-ask-selection";
const MENU_OPEN_PANEL = "eterna-open-panel";

function registerContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ASK_SELECTION,
      title: 'Ask Eterna about "%s"',
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MENU_OPEN_PANEL,
      title: "Open Eterna",
      contexts: ["page"],
    });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ASK_SELECTION) {
    const text = info.selectionText?.trim();
    if (!text) return;
    // Same hand-off as the in-page "Ask Eterna" selection bar: stash the text,
    // open this tab's panel, and SelectionAutoSend submits it.
    writePendingAutosend(text).catch(() => {});
    void controlInPageSidebar("open", tab);
    return;
  }
  if (info.menuItemId === MENU_OPEN_PANEL) {
    void controlInPageSidebar("open", tab);
  }
});

// Handle extension installation or update
chrome.runtime.onInstalled.addListener((details) => {
  // Re-assert the native side-panel behavior (and the in-page-overlay flag) on
  // install/update, alongside the top-level + onStartup calls.
  void configureSidePanel();

  // Context menus persist per install; re-register on install/update so the
  // set always matches this version.
  registerContextMenus();

  // Make the in-page sidebar available in tabs that were already open, so they
  // don't fall back to a popup window on the first click after a reload/update.
  void injectIntoOpenTabs();

  if (details.reason === "install") {
    console.log("Eterna extension installed");
  } else if (details.reason === "update") {
    console.log(
      "Eterna extension updated to version",
      chrome.runtime.getManifest().version,
    );
  }
});

// =============================================================================
// Sidepanel port lifecycle
// =============================================================================
// Track whether a recording is active so we can clean up on disconnect
let isRecording = false;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "sidepanel") {
    let portWindowId: number | undefined;
    port.onMessage.addListener((message: unknown) => {
      const msg = message as { request?: string; windowId?: unknown };
      if (
        msg?.request === "sidepanel-window" &&
        typeof msg.windowId === "number"
      ) {
        if (portWindowId !== undefined) {
          unregisterSidepanelPort(port, portWindowId);
        }
        portWindowId = msg.windowId;
        registerSidepanelPort(port, portWindowId);
      }
    });
    port.onDisconnect.addListener(() => {
      if (portWindowId !== undefined) {
        unregisterSidepanelPort(port, portWindowId);
      }
      // When sidepanel closes, stop capture on all tabs if recording was active
      if (isRecording) {
        isRecording = false;
        chrome.tabs.query({}).then((tabs) => {
          for (const tab of tabs) {
            if (tab.id) {
              chrome.tabs
                .sendMessage(tab.id, { request: "stop-capture" })
                .catch(() => {
                  /* tab may not have content script */
                });
            }
          }
        });
      }
    });
  }
});

// =============================================================================
// Internal message router
// =============================================================================
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.request === "launch-eterna-terminal") {
    launchEternaInTerminal().then(sendResponse);
    return true;
  }

  // Echo capture events to all extension contexts
  if (message.request === "capture-click-event") {
    try {
      // Immediately acknowledge sender (content script)
      sendResponse({ success: true });
      // Re-broadcast so sidepanel listeners reliably receive it. (No storage
      // write: nothing reads aipex_last_capture_event, and a per-click
      // storage.local.set on the recording hot path was pure disk churn.)
      chrome.runtime
        .sendMessage({ request: "capture-click-event", data: message.data })
        .catch(() => {
          // Ignore broadcast errors (OK if no receivers)
        });
    } catch (err) {
      console.error("❌ Failed to echo capture event:", err);
      sendResponse({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  // Relay a message to the active tab's content script
  if (message.request === "relay-to-active-tab") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId && message.message) {
        chrome.tabs
          .sendMessage(tabId, message.message)
          .then(() => sendResponse({ success: true }))
          .catch((err) => {
            sendResponse({
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
      } else {
        sendResponse({ success: false, error: "No active tab" });
      }
    });
    return true;
  }

  // Recording lifecycle markers
  if (message.request === "start-recording") {
    isRecording = true;
    sendResponse({ success: true });
    return true;
  }
  if (message.request === "stop-recording") {
    isRecording = false;
    sendResponse({ success: true });
    return true;
  }

  // Open sidepanel on demand (e.g. from content script)
  if (message.request === "open-in-page-sidebar") {
    openInPageSidebar(_sender.tab)
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  }

  if (
    message.request === "toggle-sidepanel" ||
    message.request === "open-sidepanel"
  ) {
    toggleSidebar(_sender.tab)
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  }

  // Collect screenshots from sidepanel and trigger downloads
  if (message.request === "get-current-chat-images-for-download") {
    (async () => {
      try {
        const { folderPrefix, imageNames, filenamingStrategy, displayResults } =
          message as {
            folderPrefix?: string;
            imageNames?: string[];
            filenamingStrategy?: string;
            displayResults?: boolean;
          };

        // Try to get images from sidepanel
        try {
          const sidepanelResponse = await chrome.runtime.sendMessage({
            request: "provide-current-chat-images",
            folderPrefix,
            imageNames,
            filenamingStrategy,
            displayResults,
          });

          if (
            sidepanelResponse?.images &&
            sidepanelResponse.images.length > 0
          ) {
            const result = await downloadChatImagesInBackground(
              sidepanelResponse.images,
              folderPrefix,
              imageNames,
            );
            sendResponse({
              success: result.success,
              downloadedCount: result.downloadedCount,
              downloadIds: result.downloadIds,
              folderPath: folderPrefix,
              filesList: result.filesList,
              error: result.errors?.join(", "),
            });
          } else {
            sendResponse({
              success: false,
              error: "No images found in current chat",
            });
          }
        } catch {
          // Fallback: try active tab content script
          try {
            const [activeTab] = await chrome.tabs.query({
              active: true,
              currentWindow: true,
            });
            if (activeTab?.id) {
              const tabResponse = await chrome.tabs.sendMessage(activeTab.id, {
                request: "provide-current-chat-images",
                folderPrefix,
                imageNames,
                filenamingStrategy,
                displayResults,
              });
              if (tabResponse?.images && tabResponse.images.length > 0) {
                const result = await downloadChatImagesInBackground(
                  tabResponse.images,
                  folderPrefix,
                  imageNames,
                );
                sendResponse({
                  success: result.success,
                  downloadedCount: result.downloadedCount,
                  downloadIds: result.downloadIds,
                  folderPath: folderPrefix,
                  filesList: result.filesList,
                  error: result.errors?.join(", "),
                });
              } else {
                sendResponse({
                  success: false,
                  error: "No images found in current chat",
                });
              }
            } else {
              sendResponse({
                success: false,
                error: "Unable to access current chat",
              });
            }
          } catch (_tabError) {
            sendResponse({
              success: false,
              error: "Unable to access current chat images",
            });
          }
        }
      } catch (error) {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return true;
  }

  return false;
});

// =============================================================================
// Download helpers for chat image export
// =============================================================================

/**
 * Validate a path segment to prevent directory traversal and unsafe characters.
 */
function validatePathSegment(
  segment: string | undefined,
  fieldName: string,
): string | null {
  if (segment === undefined || segment === "") return null;

  const traversalPatterns = [
    "..",
    "%2e%2e",
    "%2E%2E",
    "..%2f",
    "..%5c",
    "%2f..",
    "%5c..",
  ];
  for (const pattern of traversalPatterns) {
    if (segment.toLowerCase().includes(pattern.toLowerCase())) {
      return `${fieldName} contains forbidden traversal pattern: ${pattern}`;
    }
  }
  if (segment.includes("\\"))
    return `${fieldName} must not contain backslashes`;
  if (segment.startsWith("/") || segment.endsWith("/"))
    return `${fieldName} must not have leading or trailing slashes`;
  if (segment.includes("//"))
    return `${fieldName} contains empty path segments`;

  return null;
}

async function downloadChatImagesInBackground(
  messages: Array<{
    id: string;
    parts?: Array<{
      type: string;
      imageData?: string;
      imageTitle?: string;
    }>;
  }>,
  folderPrefix?: string,
  imageNames?: string[],
): Promise<{
  success: boolean;
  downloadedCount?: number;
  downloadIds?: number[];
  errors?: string[];
  filesList?: string[];
}> {
  try {
    if (!chrome.downloads) {
      return {
        success: false,
        errors: ["Downloads permission not available."],
      };
    }

    const folderPrefixError = validatePathSegment(folderPrefix, "folderPrefix");
    if (folderPrefixError)
      return { success: false, errors: [folderPrefixError] };

    if (imageNames) {
      for (let i = 0; i < imageNames.length; i++) {
        const nameError = validatePathSegment(
          imageNames[i],
          `imageNames[${i}]`,
        );
        if (nameError) return { success: false, errors: [nameError] };
      }
    }

    const downloadIds: number[] = [];
    const errors: string[] = [];
    const filesList: string[] = [];
    let downloadedCount = 0;
    let imageIndex = 0;

    for (const message of messages) {
      if (!message.parts) continue;
      for (const part of message.parts) {
        if (part.type === "image" && part.imageData) {
          try {
            // Validate image data format
            if (!part.imageData.startsWith("data:image/")) {
              errors.push("Invalid image data format");
              imageIndex++;
              continue;
            }

            let filename: string;
            const imageName = imageNames?.[imageIndex];
            if (imageName) {
              filename = imageName
                .replace(/[^a-zA-Z0-9\u4e00-\u9fa5\s-]/g, "")
                .trim();
            } else {
              const timestamp = new Date()
                .toISOString()
                .replace(/[:.]/g, "-")
                .slice(0, -5);
              const titleSlug = part.imageTitle
                ? part.imageTitle
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "")
                : "image";
              filename = `${titleSlug}-${timestamp}`;
            }

            const fullFilename = folderPrefix
              ? `${folderPrefix}/${filename}`
              : filename;

            const mimeMatch = part.imageData.match(/data:image\/([^;]+)/);
            const extension =
              mimeMatch?.[1] === "jpeg" ? "jpg" : (mimeMatch?.[1] ?? "png");
            const imageFilename = fullFilename.includes(".")
              ? fullFilename
              : `${fullFilename}.${extension}`;

            const downloadId = await chrome.downloads.download({
              url: part.imageData,
              filename: imageFilename,
              saveAs: true,
            });

            downloadIds.push(downloadId);
            filesList.push(imageFilename);
            downloadedCount++;
            imageIndex++;
          } catch (error) {
            errors.push(
              `Error downloading image: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    }

    return {
      success: downloadedCount > 0 || errors.length === 0,
      downloadedCount,
      downloadIds,
      filesList,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    return {
      success: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

// Global function callable from QuickJS skill runtime
(
  globalThis as Record<string, unknown>
).downloadCurrentChatImagesFromBackground = async (
  folderPrefix: string,
  imageNames?: string[],
  filenamingStrategy: string = "descriptive",
  displayResults: boolean = true,
) => {
  try {
    const sidepanelResponse = await chrome.runtime.sendMessage({
      request: "provide-current-chat-images",
      folderPrefix,
      imageNames,
      filenamingStrategy,
      displayResults,
    });

    if (sidepanelResponse?.images && sidepanelResponse.images.length > 0) {
      const result = await downloadChatImagesInBackground(
        sidepanelResponse.images,
        folderPrefix,
        imageNames,
      );
      return {
        success: result.success,
        downloadedCount: result.downloadedCount,
        downloadIds: result.downloadIds,
        folderPath: folderPrefix,
        filesList: result.filesList ?? [],
        error: result.errors?.join(", "),
      };
    }

    return { success: false, error: "No images found in current chat" };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

// =============================================================================
// WebSocket MCP Bridge
//
// Loaded lazily: wsMcpServer pulls in the full browser tool runtime (~1MB),
// which would otherwise be parsed on every service worker cold start. Only
// bridge users (a saved URL or an explicit connect request) pay that cost.
// =============================================================================

const WS_MCP_URL_KEY = "ws-mcp-url";
const WS_MCP_KEEPALIVE_ALARM = "ws-mcp-keepalive";

type WsMcpServer =
  typeof import("@aipexstudio/browser-runtime/ws-bridge")["wsMcpServer"];

let wsMcpServerPromise: Promise<WsMcpServer> | null = null;

function getWsMcpServer(): Promise<WsMcpServer> {
  if (!wsMcpServerPromise) {
    wsMcpServerPromise = import("@aipexstudio/browser-runtime/ws-bridge").then(
      ({ wsMcpServer }) => {
        wsMcpServer.onStatusChange((state) => {
          updateMcpBadge(state.status === "connected");
        });
        return wsMcpServer;
      },
    );
    wsMcpServerPromise.catch(() => {
      wsMcpServerPromise = null;
    });
  }
  return wsMcpServerPromise;
}

// Handle MCP bridge messages
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.request === "ws-bridge-connect") {
    const url = message.url as string;
    getWsMcpServer()
      .then((server) => server.connect(url))
      .then(() => {
        updateMcpBadge(true);
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  }

  if (message.request === "ws-bridge-disconnect") {
    if (!wsMcpServerPromise) {
      updateMcpBadge(false);
      sendResponse({ success: true });
      return true;
    }
    getWsMcpServer()
      .then((server) => server.disconnect())
      .then(() => {
        updateMcpBadge(false);
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  }

  if (message.request === "ws-bridge-status") {
    if (!wsMcpServerPromise) {
      sendResponse({ status: "disconnected" });
      return true;
    }
    getWsMcpServer()
      .then((server) => sendResponse(server.getStatus()))
      .catch(() => sendResponse({ status: "disconnected" }));
    return true;
  }

  return false;
});

// Update badge to show MCP connection status
function updateMcpBadge(connected: boolean) {
  if (connected) {
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

// Handle keepalive alarms for the WebSocket connection
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== WS_MCP_KEEPALIVE_ALARM) return;
  getWsMcpServer()
    .then((server) => server.handleAlarm(alarm))
    .catch(() => {});
});

// Auto-connect to saved URL on startup (also re-establishes the connection —
// and the status listener — after a service worker restart).
chrome.storage.local
  .get(WS_MCP_URL_KEY)
  .then((result) => {
    const url = result[WS_MCP_URL_KEY];
    if (typeof url === "string" && url) {
      console.log("[WsMcpServer] Auto-connecting to saved URL:", url);
      getWsMcpServer()
        .then((server) => server.connect(url))
        .catch(() => {
          // connect() handles its own retry logic
        });
    }
  })
  .catch(() => {
    // Ignore storage errors on startup
  });

console.log("Eterna background service worker started");
