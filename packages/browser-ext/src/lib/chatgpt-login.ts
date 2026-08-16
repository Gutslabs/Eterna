// =============================================================================
// Sign in with ChatGPT (Codex OAuth)
// =============================================================================
// An extension can't run the localhost server Codex expects, so instead of
// letting the redirect to http://localhost:1455 load, we intercept that
// navigation and pull the authorization code out of the URL. The PKCE verifier
// and state are persisted so the flow survives a service-worker restart that
// can happen while the user is logging in.

import {
  buildAuthorizeUrl,
  clearStoredAuth,
  createState,
  exchangeCode,
  generatePkce,
  getStoredAuth,
  setStoredAuth,
} from "../services/chatgpt-auth";

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

export function initChatGptLogin() {
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
}
