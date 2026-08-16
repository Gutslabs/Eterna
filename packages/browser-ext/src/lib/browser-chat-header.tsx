/**
 * BrowserChatHeader
 * Custom header with conversation persistence and history dropdown
 */

import { conversationStorage } from "@eterna/browser-runtime";
import { useChatContext } from "@eterna/react/components/chatbot";
import { Button } from "@eterna/react/components/ui/button";
import { useTranslation } from "@eterna/react/i18n/context";
import { cn } from "@eterna/react/lib/utils";
import type { HeaderProps, UIMessage } from "@eterna/react/types";
import { ExternalLinkIcon, SquarePenIcon, XIcon } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { HeaderMenu } from "./header-menu";
import { ConversationHistoryPage } from "./history-page";
import { fromStorageFormat, toStorageFormat } from "./message-adapter";
import { getRemoteBrowserAgent } from "./remote-agent";
import { prepareRunReplay } from "./run-replay";

// The settings surface (provider forms, skill manager, file explorer) is heavy
// and rarely opened — load it only when the user actually opens Settings.
const SettingsOverlay = lazy(() => import("./settings-overlay"));

/**
 * Domain of the page the conversation started on, read from the first user
 * message's attached page context. Stored alongside the conversation so the
 * history list can show "title · domain". Defensively typed since the message
 * part union is broad.
 */
function firstUserDomain(messages: readonly unknown[]): string | undefined {
  for (const message of messages) {
    const m = message as { role?: string; parts?: unknown[] };
    if (m.role !== "user" || !Array.isArray(m.parts)) continue;
    for (const part of m.parts) {
      const p = part as { type?: string; metadata?: { domain?: unknown } };
      if (p.type === "context" && typeof p.metadata?.domain === "string") {
        return p.metadata.domain;
      }
    }
  }
  return undefined;
}

function lastUserMessageId(messages: readonly UIMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "user") return message.id;
  }
  return undefined;
}

/** Quiet-period debounce before persisting the conversation. */
const SAVE_DEBOUNCE_MS = 1000;
/** Hard cap between saves while messages keep changing (active streaming). */
const SAVE_MAX_INTERVAL_MS = 2000;

export function BrowserChatHeader({
  title = "Eterna",
  onSettingsClick,
  onNewChat,
  className,
  children,
  ...props
}: HeaderProps) {
  const { t } = useTranslation();
  const {
    messages,
    setMessages,
    reset,
    attachExternalTurn,
    activeRunId,
    getActiveRunId,
    getMessagesSnapshot,
    detachActiveRun,
  } = useChatContext();

  const [currentConversationId, setCurrentConversationId] = useState<
    string | undefined
  >();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const currentConversationIdRef = useRef(currentConversationId);
  currentConversationIdRef.current = currentConversationId;

  const handleOpenHistory = useCallback(() => setHistoryOpen(true), []);
  const handleCloseHistory = useCallback(() => setHistoryOpen(false), []);
  const handleCloseSettings = useCallback(() => setSettingsOpen(false), []);

  // Persistence: debounced save/update on messages change.
  // The debounce alone is not enough: while a response streams, messages
  // change every few ms, a pure debounce never fires, and a mid-stream page
  // refresh lost the whole turn. So the wait is capped — at most
  // SAVE_MAX_INTERVAL_MS may pass between saves while changes keep coming —
  // and a pagehide flush narrows the remaining window on refresh/navigation.
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const lastSaveAtRef = useRef(0);
  const saveNowRef = useRef<(() => void) | undefined>(undefined);
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const navigationEpochRef = useRef(0);
  const visibleRunIdRef = useRef<string | null>(null);
  const runConversationIdsRef = useRef(new Map<string, string>());
  if (activeRunId) {
    visibleRunIdRef.current = activeRunId;
  }
  // Serialized form of the last persisted message list. Restoring a
  // conversation seeds this so merely viewing it never writes (a no-op
  // update would bump updatedAt and jump the chat to the top of history).
  const lastSavedSnapshotRef = useRef<string | null>(null);

  const enqueuePersistence = useCallback(
    (task: () => Promise<string | undefined>): Promise<string | undefined> => {
      const operation = persistenceQueueRef.current.then(task, task);
      persistenceQueueRef.current = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
    [],
  );

  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    const save = async () => {
      // Only save if we have non-system messages
      const nonSystemMessages = messages.filter((msg) => msg.role !== "system");
      if (nonSystemMessages.length === 0) return;

      const payload = toStorageFormat(messages);
      // The stringify dirty-check exists so merely restoring/viewing a
      // conversation never writes. While a run is streaming the content has
      // always changed, so comparing multi-MB snapshots every 2s is pure
      // waste — skip the check and invalidate the snapshot instead.
      let snapshot: string | null = null;
      if (!activeRunId) {
        snapshot = JSON.stringify(payload);
        if (snapshot === lastSavedSnapshotRef.current) return;
      }
      const epoch = navigationEpochRef.current;
      const runId = activeRunId ?? visibleRunIdRef.current;

      try {
        const persistedConversationId = await enqueuePersistence(async () => {
          let persistedConversationId: string | undefined;
          if (currentConversationId) {
            await conversationStorage.updateConversation(
              currentConversationId,
              payload,
            );
            persistedConversationId = currentConversationId;
          } else if (nonSystemMessages.length >= 2) {
            persistedConversationId =
              (await conversationStorage.saveConversation(payload, {
                domain: firstUserDomain(messages),
              })) || undefined;
          }
          if (persistedConversationId && runId) {
            runConversationIdsRef.current.set(runId, persistedConversationId);
          }
          return persistedConversationId;
        });
        if (!persistedConversationId) return;

        getRemoteBrowserAgent().bindConversation(
          persistedConversationId,
          runId,
          false,
          lastUserMessageId(messages),
        );
        if (navigationEpochRef.current === epoch) {
          // Streaming saves store null here; the first post-turn save
          // recomputes and re-seeds the snapshot.
          lastSavedSnapshotRef.current = snapshot;
          if (!currentConversationId) {
            setCurrentConversationId(persistedConversationId);
            console.log(
              "💾 New conversation created and saved:",
              persistedConversationId,
            );
          }
        }
      } catch (error) {
        console.error("❌ Failed to save conversation:", error);
      }
    };

    const runSave = () => {
      lastSaveAtRef.current = Date.now();
      void save();
    };
    saveNowRef.current = runSave;

    const sinceLastSave = Date.now() - lastSaveAtRef.current;
    const delay =
      sinceLastSave >= SAVE_MAX_INTERVAL_MS
        ? 0
        : Math.min(SAVE_DEBOUNCE_MS, SAVE_MAX_INTERVAL_MS - sinceLastSave);
    saveTimeoutRef.current = setTimeout(runSave, delay);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [activeRunId, currentConversationId, enqueuePersistence, messages]);

  // Best-effort flush when the sidebar is torn down (host page refresh or
  // navigation) so an in-flight turn keeps its already-streamed text.
  useEffect(() => {
    const flush = () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveNowRef.current?.();
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  // Re-join a turn that kept running in the background service worker while
  // this sidebar was torn down (host page refresh/navigation). Replays the
  // whole turn's events, then continues live.
  const resumeAttemptedRef = useRef(false);
  useEffect(() => {
    if (resumeAttemptedRef.current) return;
    resumeAttemptedRef.current = true;

    void (async () => {
      const resumeEpoch = navigationEpochRef.current;
      try {
        const attachment = await getRemoteBrowserAgent().attachActiveRun();
        if (!attachment) return;
        if (
          navigationEpochRef.current !== resumeEpoch ||
          getActiveRunId() !== null
        ) {
          attachment.detach();
          return;
        }
        // A run the user already watched finish needs no resurrection; only
        // still-active runs or ones that completed while detached do.
        if (
          (attachment.done && !attachment.completedDetached) ||
          attachment.truncated
        ) {
          attachment.detach();
          return;
        }

        let userText: string | undefined = attachment.userText;
        let userMessageId = attachment.userMessageId ?? undefined;
        if (attachment.conversationId) {
          const conversation = await conversationStorage.getConversation(
            attachment.conversationId,
          );
          if (
            navigationEpochRef.current !== resumeEpoch ||
            getActiveRunId() !== null
          ) {
            attachment.detach();
            return;
          }
          if (conversation) {
            setCurrentConversationId(attachment.conversationId);
            const restored = fromStorageFormat(conversation.messages);
            const replay = prepareRunReplay(restored, attachment);
            setMessages(replay.messages);
            userText = replay.userText;
            userMessageId = replay.userMessageId;
          }
        }

        await attachExternalTurn(attachment.events, {
          userText,
          userMessageId,
        });
      } catch {
        // Background host unreachable — start as a normal fresh sidebar.
      }
    })();
  }, [attachExternalTurn, getActiveRunId, setMessages]);

  const handleOpenOptions = useCallback(() => {
    if (onSettingsClick) {
      onSettingsClick();
      return;
    }
    // Settings live inside the sidebar (full-screen overlay over the chat)
    // instead of jumping out to the separate options tab.
    setSettingsOpen(true);
  }, [onSettingsClick]);

  const persistDetachedSnapshot = useCallback(
    async (
      snapshotMessages: UIMessage[],
      conversationId: string | undefined,
      runId?: string,
    ): Promise<void> => {
      const nonSystemMessages = snapshotMessages.filter(
        (message) => message.role !== "system",
      );
      const payload = toStorageFormat(snapshotMessages);
      const persistedConversationId = await enqueuePersistence(async () => {
        const knownConversationId =
          conversationId ??
          (runId ? runConversationIdsRef.current.get(runId) : undefined);
        let persistedConversationId: string | undefined;
        if (knownConversationId) {
          if (nonSystemMessages.length > 0) {
            await conversationStorage.updateConversation(
              knownConversationId,
              payload,
            );
          }
          persistedConversationId = knownConversationId;
        } else if (nonSystemMessages.length > 0) {
          persistedConversationId =
            (await conversationStorage.saveConversation(payload, {
              domain: firstUserDomain(snapshotMessages),
            })) || undefined;
        }
        if (persistedConversationId && runId) {
          runConversationIdsRef.current.set(runId, persistedConversationId);
        }
        return persistedConversationId;
      });

      if (persistedConversationId && runId) {
        getRemoteBrowserAgent().bindConversation(
          persistedConversationId,
          runId,
          true,
          lastUserMessageId(snapshotMessages),
        );
      }
    },
    [enqueuePersistence],
  );

  const detachCurrentRun = useCallback((): boolean => {
    const runId = getActiveRunId();
    if (!runId) {
      return false;
    }
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = undefined;
    }

    const conversationId = currentConversationIdRef.current;
    const snapshotMessages = getMessagesSnapshot();
    detachActiveRun({
      conversationId,
      persistencePending: true,
      userMessageId: lastUserMessageId(snapshotMessages),
    });
    void persistDetachedSnapshot(snapshotMessages, conversationId, runId).catch(
      (error) => {
        console.error("❌ Failed to persist detached conversation:", error);
        const knownConversationId =
          conversationId ?? runConversationIdsRef.current.get(runId);
        if (knownConversationId) {
          getRemoteBrowserAgent().bindConversation(
            knownConversationId,
            runId,
            true,
            lastUserMessageId(snapshotMessages),
          );
        }
      },
    );
    return true;
  }, [
    detachActiveRun,
    getActiveRunId,
    getMessagesSnapshot,
    persistDetachedSnapshot,
  ]);

  const handleConversationSelect = async (conversationId: string) => {
    const navigationEpoch = ++navigationEpochRef.current;
    try {
      const conversation =
        await conversationStorage.getConversation(conversationId);
      if (navigationEpochRef.current !== navigationEpoch) {
        return;
      }
      if (!conversation) {
        console.warn("⚠️ Conversation not found:", conversationId);
        return;
      }

      const preservedRun = detachCurrentRun();
      if (!preservedRun) {
        void persistDetachedSnapshot(
          getMessagesSnapshot(),
          currentConversationIdRef.current,
          visibleRunIdRef.current ?? undefined,
        ).catch(() => {});
      }
      visibleRunIdRef.current = null;
      reset({ preserveActiveRun: preservedRun });

      // Set the current conversation ID first
      setCurrentConversationId(conversationId);

      // Restore messages to UI state (convert from storage format). Seed the
      // saved-snapshot guard so viewing alone never rewrites the conversation
      // (which would bump it to the top of the history list).
      const restored = fromStorageFormat(conversation.messages);
      lastSavedSnapshotRef.current = JSON.stringify(toStorageFormat(restored));
      setMessages(restored);

      const attachment =
        await getRemoteBrowserAgent().attachActiveRun(conversationId);
      if (navigationEpochRef.current !== navigationEpoch) {
        attachment?.detach();
        return;
      }

      const shouldReplay =
        attachment &&
        !attachment.truncated &&
        (!attachment.done || attachment.completedDetached);
      if (shouldReplay) {
        const replay = prepareRunReplay(restored, attachment);
        setMessages(replay.messages);
        await attachExternalTurn(attachment.events, {
          userText: replay.userText,
          userMessageId: replay.userMessageId,
        });
      } else {
        attachment?.detach();
      }

      console.log(
        "✅ Conversation restored:",
        conversationId,
        conversation.title,
      );
    } catch (error) {
      console.error("❌ Failed to restore conversation:", error);
    }
  };

  const handleNewChat = useCallback(() => {
    const preservedRun = detachCurrentRun();
    if (!preservedRun) {
      void persistDetachedSnapshot(
        getMessagesSnapshot(),
        currentConversationIdRef.current,
        visibleRunIdRef.current ?? undefined,
      ).catch(() => {});
    }
    navigationEpochRef.current += 1;
    visibleRunIdRef.current = null;

    // Clear current conversation ID so next save creates new conversation
    setCurrentConversationId(undefined);
    lastSavedSnapshotRef.current = null;

    // Call the passed onNewChat (resets messages and clears input)
    onNewChat?.({ preserveActiveRun: preservedRun });
  }, [
    detachCurrentRun,
    getMessagesSnapshot,
    onNewChat,
    persistDetachedSnapshot,
  ]);

  // When rendered inside the in-page sidebar iframe, expose a close affordance
  // that asks the host content script to slide the panel away.
  const isEmbedded =
    typeof window !== "undefined" && window.self !== window.top;

  const handleCloseSidebar = useCallback(() => {
    window.parent.postMessage({ type: "eterna-close-sidebar" }, "*");
  }, []);

  // Pop the chat out of the narrow sidebar into a full browser tab (the chat
  // UI is the same sidepanel.html, just full-width). Conversation history is
  // shared (IndexedDB + the background run host), so it carries over.
  const handleOpenInTab = useCallback(() => {
    void chrome.tabs.create({
      url: chrome.runtime.getURL("src/sidepanel.html"),
    });
    handleCloseSidebar();
  }, [handleCloseSidebar]);

  return (
    <>
      <div
        className={cn("flex items-center justify-between px-3 py-2", className)}
        {...props}
      >
        {/* Left side - New chat: compose icon only, no "+" and no label. */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleNewChat}
          title={t("common.newChat")}
          className="size-8"
        >
          <SquarePenIcon className="size-4" />
        </Button>

        {/* Right side - one overflow menu (history + settings) and close */}
        <div className="flex items-center gap-0.5">
          <HeaderMenu
            currentConversationId={currentConversationId}
            onConversationSelect={handleConversationSelect}
            onNewConversation={handleNewChat}
            onOpenSettings={handleOpenOptions}
            onOpenHistory={handleOpenHistory}
          />

          {isEmbedded && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleOpenInTab}
                title="Sekmede aç"
                className="size-8"
              >
                <ExternalLinkIcon className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCloseSidebar}
                title={t("common.close")}
                className="size-8"
              >
                <XIcon className="size-4" />
              </Button>
            </>
          )}
        </div>

        {children}
      </div>

      <ConversationHistoryPage
        open={historyOpen}
        onClose={handleCloseHistory}
        currentConversationId={currentConversationId}
        onSelect={handleConversationSelect}
      />

      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsOverlay onClose={handleCloseSettings} />
        </Suspense>
      )}
    </>
  );
}
