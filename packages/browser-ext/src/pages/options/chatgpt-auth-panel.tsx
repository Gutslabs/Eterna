import { type AppSettings, STORAGE_KEYS } from "@aipexstudio/aipex-core";
import React from "react";
import { chromeStorageAdapter } from "../../hooks";
import { CHATGPT_DEFAULT_MODEL, CHATGPT_MODELS } from "../../lib/ai-provider";

interface ChatGptStatus {
  signedIn: boolean;
  accountId: string | null;
}

async function selectChatGptProvider(model: string) {
  const current =
    ((await chromeStorageAdapter.load(STORAGE_KEYS.SETTINGS)) as
      | AppSettings
      | undefined) ?? {};
  await chromeStorageAdapter.save(STORAGE_KEYS.SETTINGS, {
    ...current,
    aiProvider: "chatgpt",
    aiModel: model,
  });
}

export function ChatGptAuthPanel() {
  const [status, setStatus] = React.useState<ChatGptStatus>({
    signedIn: false,
    accountId: null,
  });
  const [model, setModel] = React.useState<string>(CHATGPT_DEFAULT_MODEL);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const modelRef = React.useRef(model);
  modelRef.current = model;

  const refreshStatus = React.useCallback(() => {
    chrome.runtime.sendMessage({ request: "chatgpt-status" }, (result) => {
      setStatus(
        (result as ChatGptStatus) ?? { signedIn: false, accountId: null },
      );
    });
  }, []);

  React.useEffect(() => {
    refreshStatus();
    chromeStorageAdapter.load(STORAGE_KEYS.SETTINGS).then((stored) => {
      const settings = stored as AppSettings | undefined;
      if (
        settings?.aiProvider === "chatgpt" &&
        settings.aiModel &&
        (CHATGPT_MODELS as readonly string[]).includes(settings.aiModel)
      ) {
        setModel(settings.aiModel);
      }
    });

    const onMessage = (message: {
      request?: string;
      success?: boolean;
      error?: string;
    }) => {
      if (message?.request !== "chatgpt-login-result") return;
      setBusy(false);
      if (message.success) {
        setError(null);
        void selectChatGptProvider(modelRef.current);
        refreshStatus();
      } else {
        setError(message.error ?? "Login failed");
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [refreshStatus]);

  // Once signed in, route chat through the ChatGPT provider.
  React.useEffect(() => {
    if (!status.signedIn) return;
    chromeStorageAdapter.load(STORAGE_KEYS.SETTINGS).then((stored) => {
      if ((stored as AppSettings | undefined)?.aiProvider !== "chatgpt") {
        void selectChatGptProvider(modelRef.current);
      }
    });
  }, [status.signedIn]);

  const handleSignIn = () => {
    setBusy(true);
    setError(null);
    chrome.runtime.sendMessage({ request: "chatgpt-login" }, (result) => {
      if (!(result as { started?: boolean })?.started) {
        setBusy(false);
        setError(
          (result as { error?: string })?.error ?? "Could not start login",
        );
      }
    });
  };

  const handleSignOut = () => {
    chrome.runtime.sendMessage({ request: "chatgpt-logout" }, () => {
      refreshStatus();
    });
  };

  const handleModelChange = (next: string) => {
    setModel(next);
    if (status.signedIn) void selectChatGptProvider(next);
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            ChatGPT Subscription
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {status.signedIn
              ? "Signed in — model calls use your ChatGPT plan."
              : "Sign in with your ChatGPT account to use your Plus/Pro plan."}
          </p>
        </div>
        {status.signedIn ? (
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Sign out
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSignIn}
            disabled={busy}
            className="rounded-md bg-black px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
          >
            {busy ? "Opening…" : "Sign in with ChatGPT"}
          </button>
        )}
      </div>

      {status.signedIn && (
        <div className="mt-3 flex items-center gap-2">
          <label
            htmlFor="chatgpt-model"
            className="text-xs text-gray-500 dark:text-gray-400"
          >
            Model
          </label>
          <select
            id="chatgpt-model"
            value={model}
            onChange={(event) => handleModelChange(event.target.value)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            {CHATGPT_MODELS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
