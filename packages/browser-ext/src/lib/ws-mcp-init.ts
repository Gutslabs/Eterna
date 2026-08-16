// =============================================================================
// WebSocket MCP Bridge
//
// Loaded lazily: wsMcpServer pulls in the full browser tool runtime (~1MB),
// which would otherwise be parsed on every service worker cold start. Only
// bridge users (a saved URL or an explicit connect request) pay that cost.
// =============================================================================

// STATIC import — MV3 forbids dynamic import() in the service worker; the
// previous lazy-load made the MCP bridge fail at runtime.
import { wsMcpServer as wsMcpServerImpl } from "@eterna/browser-runtime/ws-bridge";

const WS_MCP_URL_KEY = "ws-mcp-url";
const WS_MCP_KEEPALIVE_ALARM = "ws-mcp-keepalive";

type WsMcpServer = typeof wsMcpServerImpl;

let wsMcpServerInstance: WsMcpServer | null = null;

function getWsMcpServer(): Promise<WsMcpServer> {
  if (!wsMcpServerInstance) {
    wsMcpServerImpl.onStatusChange((state) => {
      updateMcpBadge(state.status === "connected");
    });
    wsMcpServerInstance = wsMcpServerImpl;
  }
  return Promise.resolve(wsMcpServerInstance);
}

// Update badge to show MCP connection status
function updateMcpBadge(connected: boolean) {
  if (connected) {
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

export function initWsMcpBridge() {
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
      if (!wsMcpServerInstance) {
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
      if (!wsMcpServerInstance) {
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
}
