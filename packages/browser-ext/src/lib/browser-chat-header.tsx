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
import { PlusIcon, XIcon } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { startFreshGatewayThread } from "./ai-provider";
import { HeaderMenu } from "./header-menu";
import { ConversationHistoryPage } from "./history-page";
import { fromStorageFormat, toStorageFormat } from "./message-adapter";

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

export function BrowserChatHeader({
  title = "Eterna",
  onSettingsClick,
  onNewChat,
  className,
  children,
  ...props
}: HeaderProps) {
  const { t } = useTranslation();
  const { messages, setMessages, interrupt } = useChatContext();
  const { settings } = useConfigContext();

  const [currentConversationId, setCurrentConversationId] = useState<
    string | undefined
  >();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleOpenHistory = useCallback(() => setHistoryOpen(true), []);
  const handleCloseHistory = useCallback(() => setHistoryOpen(false), []);
  const handleCloseSettings = useCallback(() => setSettingsOpen(false), []);

  // Persistence: debounced save/update on messages change
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  useEffect(() => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce save for 1 second
    saveTimeoutRef.current = setTimeout(async () => {
      // Only save if we have non-system messages
      const nonSystemMessages = messages.filter((msg) => msg.role !== "system");
      if (nonSystemMessages.length === 0) return;

      try {
        if (currentConversationId) {
          // Update existing conversation
          await conversationStorage.updateConversation(
            currentConversationId,
            toStorageFormat(messages),
          );
        } else if (nonSystemMessages.length >= 2) {
          // Create new conversation only when we have at least user message + assistant response
          const conversationId = await conversationStorage.saveConversation(
            toStorageFormat(messages),
            { domain: firstUserDomain(messages) },
          );
          if (conversationId) {
            setCurrentConversationId(conversationId);
            console.log(
              "💾 New conversation created and saved:",
              conversationId,
            );
          }
        }
      } catch (error) {
        console.error("❌ Failed to save conversation:", error);
      }
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [messages, currentConversationId]);

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

      // Set the current conversation ID first
      setCurrentConversationId(conversationId);

      // Restore messages to UI state (convert from storage format)
      setMessages(fromStorageFormat(conversation.messages));

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
    startFreshGatewayThread(settings.aiModel);

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

  return (
    <>
      <div
        className={cn("flex items-center justify-between px-3 py-2", className)}
        {...props}
      >
        {/* Left side - New chat */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleNewChat}
          title={t("common.newChat")}
          className="gap-1.5 px-2"
        >
          <PlusIcon className="size-4" />
          {t("common.newChat")}
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
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCloseSidebar}
              title={t("common.close")}
              className="size-8"
            >
              <XIcon className="size-4" />
            </Button>
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
