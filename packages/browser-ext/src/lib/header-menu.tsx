/**
 * HeaderMenu
 *
 * The single "…" overflow menu in the chat header. It folds what used to be a
 * separate history dropdown and a settings button into one menu: the most
 * recent conversations sit at the top (history one click away), "All history"
 * expands the list to every saved conversation, and Settings opens the options
 * page. Each row reveals a delete action on hover. ⌘/Ctrl+H opens the menu
 * straight to the full history.
 */

import { Button } from "@aipexstudio/aipex-react/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@aipexstudio/aipex-react/components/ui/dropdown-menu";
import { useTranslation } from "@aipexstudio/aipex-react/i18n/context";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import {
  type ConversationData,
  conversationStorage,
} from "@aipexstudio/browser-runtime";
import {
  ClockIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface HeaderMenuProps {
  currentConversationId?: string;
  onConversationSelect: (conversationId: string) => void;
  onNewConversation: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}

const RECENT_COUNT = 3;

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function HeaderMenu({
  currentConversationId,
  onConversationSelect,
  onNewConversation,
  onOpenSettings,
  onOpenHistory,
}: HeaderMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationData[]>([]);

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await conversationStorage.getAllConversations());
    } catch {
      setConversations([]);
    }
  }, []);

  // Refresh the recent list each time the menu opens.
  useEffect(() => {
    if (open) void loadConversations();
  }, [open, loadConversations]);

  // ⌘/Ctrl+H opens the full history page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (IS_MAC ? event.metaKey : event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "h"
      ) {
        event.preventDefault();
        setOpen(false);
        onOpenHistory();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onOpenHistory]);

  const formatDate = useCallback(
    (timestamp: number) => {
      const minutes = Math.floor((Date.now() - timestamp) / 60000);
      if (minutes < 1) return t("conversationHistory.timeFormat.justNow");
      if (minutes < 60)
        return t("conversationHistory.timeFormat.minutesAgo", {
          count: minutes,
        });
      const hours = Math.floor(minutes / 60);
      if (hours < 24)
        return hours === 1
          ? t("conversationHistory.timeFormat.hourAgo")
          : t("conversationHistory.timeFormat.hoursAgo", { count: hours });
      const days = Math.floor(hours / 24);
      if (days === 1) return t("conversationHistory.timeFormat.yesterday");
      if (days < 7)
        return t("conversationHistory.timeFormat.daysAgo", { count: days });
      return new Date(timestamp).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    },
    [t],
  );

  const handleDelete = useCallback(
    async (event: React.MouseEvent, conversationId: string) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await conversationStorage.deleteConversation(conversationId);
        await loadConversations();
        if (conversationId === currentConversationId) onNewConversation();
      } catch {
        // Ignore delete failures (e.g. storage hiccup).
      }
    },
    [loadConversations, currentConversationId, onNewConversation],
  );

  const visible = conversations.slice(0, RECENT_COUNT);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={t("conversationHistory.title")}
          className="size-8"
        >
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" side="bottom" className="w-72">
        {conversations.length === 0 ? (
          <div className="px-2 py-6 text-center text-muted-foreground">
            <MessageSquareIcon className="mx-auto mb-2 size-7 opacity-50" />
            <p className="text-sm">{t("conversationHistory.noHistory")}</p>
          </div>
        ) : (
          <>
            <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("conversationHistory.recentConversations")}
            </DropdownMenuLabel>
            {visible.map((conversation) => (
              <DropdownMenuItem
                key={conversation.id}
                onClick={() => onConversationSelect(conversation.id)}
                className={cn(
                  "group flex items-center justify-between gap-2",
                  currentConversationId === conversation.id && "bg-accent/50",
                )}
              >
                <span className="truncate">{conversation.title}</span>
                <span className="flex shrink-0 items-center justify-end">
                  <span className="text-muted-foreground text-xs group-hover:hidden">
                    {formatDate(conversation.updatedAt)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t("conversationHistory.title")}
                    onClick={(e) => handleDelete(e, conversation.id)}
                    className="hidden size-6 text-muted-foreground hover:text-destructive group-hover:flex"
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              onClick={onOpenHistory}
              className="justify-between gap-2"
            >
              <span className="flex items-center gap-2">
                <ClockIcon className="size-4" />
                {t("conversationHistory.allHistory")}
              </span>
              <span className="text-muted-foreground text-xs tracking-widest">
                {IS_MAC ? "⌘H" : "Ctrl H"}
              </span>
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenSettings} className="gap-2">
          <SettingsIcon className="size-4" />
          {t("common.settings")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
