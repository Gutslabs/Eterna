/**
 * BrowserChatHeader
 * Custom header with conversation persistence and history dropdown
 */

import {
  useChatContext,
  useConfigContext,
} from "@aipexstudio/aipex-react/components/chatbot";
import { Button } from "@aipexstudio/aipex-react/components/ui/button";
import { useTranslation } from "@aipexstudio/aipex-react/i18n/context";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import type { HeaderProps } from "@aipexstudio/aipex-react/types";
import { conversationStorage } from "@aipexstudio/browser-runtime";
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
  const { messages, setMessages, interrupt, reset, attachExternalTurn } =
    useChatContext();
  const { settings } = useConfigContext();

  const [currentConversationId, setCurrentConversationId] = useState<
    string | undefined
  >();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
  // Serialized form of the last persisted message list. Restoring a
  // conversation seeds this so merely viewing it never writes (a no-op
  // update would bump updatedAt and jump the chat to the top of history).
  const lastSavedSnapshotRef = useRef<string | null>(null);

  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    const save = async () => {
      // Only save if we have non-system messages
      const nonSystemMessages = messages.filter((msg) => msg.role !== "system");
      if (nonSystemMessages.length === 0) return;

      const payload = toStorageFormat(messages);
      const snapshot = JSON.stringify(payload);
      if (snapshot === lastSavedSnapshotRef.current) return;

      try {
        if (currentConversationId) {
          // Update existing conversation
          await conversationStorage.updateConversation(
            currentConversationId,
            payload,
          );
          lastSavedSnapshotRef.current = snapshot;
          getRemoteBrowserAgent().bindConversation(currentConversationId);
        } else if (nonSystemMessages.length >= 2) {
          // Create new conversation only when we have at least user message + assistant response
          const conversationId = await conversationStorage.saveConversation(
            payload,
            { domain: firstUserDomain(messages) },
          );
          if (conversationId) {
            setCurrentConversationId(conversationId);
            lastSavedSnapshotRef.current = snapshot;
            // Let the background run host know which stored conversation
            // this run belongs to, so a reloaded sidebar can re-join it.
            getRemoteBrowserAgent().bindConversation(conversationId);
            console.log(
              "💾 New conversation created and saved:",
              conversationId,
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
  }, [messages, currentConversationId]);

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
      try {
        const attachment = await getRemoteBrowserAgent().attachActiveRun();
        if (!attachment) return;
        // A run the user already watched finish needs no resurrection; only
        // still-active runs or ones that completed while detached do.
        if (
          (attachment.done && !attachment.completedDetached) ||
          attachment.truncated
        ) {
          await attachment.events.return?.(undefined);
          return;
        }

        let userText: string | undefined = attachment.userText;
        if (attachment.conversationId) {
          const conversation = await conversationStorage.getConversation(
            attachment.conversationId,
          );
          if (conversation) {
            setCurrentConversationId(attachment.conversationId);
            const restored = fromStorageFormat(conversation.messages);
            // Drop the partially-saved assistant tail — the replay rebuilds
            // the whole turn from its event log.
            let end = restored.length;
            while (end > 0 && restored[end - 1]?.role === "assistant") {
              end -= 1;
            }
            setMessages(restored.slice(0, end));
            userText = undefined;
          }
        }

        await attachExternalTurn(attachment.events, { userText });
      } catch {
        // Background host unreachable — start as a normal fresh sidebar.
      }
    })();
  }, [attachExternalTurn, setMessages]);

  const handleOpenOptions = useCallback(() => {
    if (onSettingsClick) {
      onSettingsClick();
      return;
    }
    // Settings live inside the sidebar (full-screen overlay over the chat)
    // instead of jumping out to the separate options tab.
    setSettingsOpen(true);
  }, [onSettingsClick]);

  const handleConversationSelect = async (conversationId: string) => {
    try {
      const conversation =
        await conversationStorage.getConversation(conversationId);
      if (!conversation) {
        console.warn("⚠️ Conversation not found:", conversationId);
        return;
      }

      // Interrupt any ongoing operation
      if (interrupt) {
        await interrupt();
      }

      // Drop the previous conversation's agent session AND gateway web
      // thread. Without this the next message was sent into the OLD
      // conversation's session/thread while its answer rendered under the
      // restored one (cross-conversation context leakage). The gateway
      // thread state lives host-side now, so reset it over RPC.
      reset();
      void getRemoteBrowserAgent()
        .freshGatewayThread(settings.aiModel)
        .catch(() => {});

      // Set the current conversation ID first
      setCurrentConversationId(conversationId);

      // Restore messages to UI state (convert from storage format). Seed the
      // saved-snapshot guard so viewing alone never rewrites the conversation
      // (which would bump it to the top of the history list).
      const restored = fromStorageFormat(conversation.messages);
      lastSavedSnapshotRef.current = JSON.stringify(toStorageFormat(restored));
      setMessages(restored);

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
    // Clear current conversation ID so next save creates new conversation
    setCurrentConversationId(undefined);

    // For gateway models, open a fresh web-UI thread right away (visible in
    // noVNC) instead of waiting for the next message to do it.
    void getRemoteBrowserAgent()
      .freshGatewayThread(settings.aiModel)
      .catch(() => {});

    // Call the passed onNewChat (resets messages and clears input)
    onNewChat?.();
  }, [onNewChat, settings.aiModel]);

  // When rendered inside the in-page sidebar iframe, expose a close affordance
  // that asks the host content script to slide the panel away.
  const isEmbedded =
    typeof window !== "undefined" && window.self !== window.top;

  const handleCloseSidebar = useCallback(() => {
    window.parent.postMessage({ type: "aipex-close-sidebar" }, "*");
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
