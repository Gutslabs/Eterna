/**
 * ConversationHistoryPage
 *
 * Full-screen history view that covers the chat when the user picks "All
 * history" from the header menu. Pinned conversations sit at the top; the rest
 * are grouped by recency (today / yesterday / this week / this month / older).
 * Typing in the search box flattens the groups, highlights the match and shows
 * a result count; an opt-in "search in content" pass also scans message bodies.
 * Each row reveals pin + delete on hover (the timestamp fades out). ⌘/Ctrl+K
 * focuses the search; Esc clears it, then closes the page.
 */

import { Button } from "@aipexstudio/aipex-react/components/ui/button";
import { useTranslation } from "@aipexstudio/aipex-react/i18n/context";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import {
  type ConversationData,
  conversationStorage,
} from "@aipexstudio/browser-runtime";
import {
  ArrowLeftIcon,
  MessageSquareIcon,
  SearchIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

interface ConversationHistoryPageProps {
  open: boolean;
  onClose: () => void;
  currentConversationId?: string;
  onSelect: (conversationId: string) => void;
}

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const DAY_MS = 86_400_000;

type GroupKey = "today" | "yesterday" | "thisWeek" | "thisMonth" | "older";

function bucketByDate(updatedAt: number): GroupKey {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  if (updatedAt >= startOfToday) return "today";
  if (updatedAt >= startOfToday - DAY_MS) return "yesterday";
  if (updatedAt >= startOfToday - 6 * DAY_MS) return "thisWeek";
  if (updatedAt >= startOfToday - 29 * DAY_MS) return "thisMonth";
  return "older";
}

function conversationBody(conversation: ConversationData): string {
  return conversation.messages
    .flatMap((message) =>
      message.parts.map((part) =>
        part.type === "text" && "text" in part ? part.text : "",
      ),
    )
    .join(" ");
}

function highlight(text: string, query: string): ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  while (cursor < text.length) {
    const idx = lower.indexOf(q, cursor);
    if (idx === -1) {
      nodes.push(text.slice(cursor));
      break;
    }
    if (idx > cursor) nodes.push(text.slice(cursor, idx));
    nodes.push(
      <mark
        key={key++}
        className="rounded-[3px] bg-amber-400/30 text-foreground"
      >
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    cursor = idx + q.length;
  }
  return nodes;
}

export function ConversationHistoryPage({
  open,
  onClose,
  currentConversationId,
  onSelect,
}: ConversationHistoryPageProps) {
  const { t } = useTranslation();
  const [conversations, setConversations] = useState<ConversationData[]>([]);
  const [query, setQuery] = useState("");
  const [contentSearch, setContentSearch] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setConversations(await conversationStorage.getAllConversations());
    } catch {
      setConversations([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setContentSearch(false);
    void load();
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (query) {
          setQuery("");
          setContentSearch(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, query, onClose]);

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

  const handlePin = useCallback(
    async (event: React.MouseEvent, conversation: ConversationData) => {
      event.preventDefault();
      event.stopPropagation();
      await conversationStorage.setPinned(
        conversation.id,
        !conversation.pinned,
      );
      await load();
    },
    [load],
  );

  const handleDelete = useCallback(
    async (event: React.MouseEvent, id: string) => {
      event.preventDefault();
      event.stopPropagation();
      await conversationStorage.deleteConversation(id);
      await load();
    },
    [load],
  );

  if (!open) return null;

  const trimmed = query.trim();
  const q = trimmed.toLowerCase();
  const filtered = q
    ? conversations.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          Boolean(c.domain?.toLowerCase().includes(q)) ||
          (contentSearch && conversationBody(c).toLowerCase().includes(q)),
      )
    : [];

  const pinned = conversations.filter((c) => c.pinned);
  const unpinned = conversations.filter((c) => !c.pinned);
  const groupDefs: Array<{ key: GroupKey; label: string }> = [
    { key: "today", label: t("conversationHistory.groups.today") },
    { key: "yesterday", label: t("conversationHistory.groups.yesterday") },
    { key: "thisWeek", label: t("conversationHistory.groups.thisWeek") },
    { key: "thisMonth", label: t("conversationHistory.groups.thisMonth") },
    { key: "older", label: t("conversationHistory.groups.older") },
  ];

  const renderRow = (conversation: ConversationData) => (
    <div key={conversation.id} className="group relative">
      <button
        type="button"
        onClick={() => {
          onSelect(conversation.id);
          onClose();
        }}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent",
          currentConversationId === conversation.id && "bg-accent/50",
        )}
      >
        {conversation.pinned && (
          <StarIcon
            className="size-3.5 shrink-0 text-muted-foreground"
            fill="currentColor"
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">
            {highlight(conversation.title, trimmed)}
          </span>
          {conversation.domain && (
            <span className="block truncate text-muted-foreground text-xs">
              {conversation.domain}
            </span>
          )}
        </span>
        <span className="shrink-0 text-muted-foreground text-xs transition-opacity group-hover:opacity-0">
          {formatDate(conversation.updatedAt)}
        </span>
      </button>

      {/* Hover actions overlay the timestamp so the row doesn't reflow. */}
      <span className="absolute top-1/2 right-1.5 hidden -translate-y-1/2 items-center group-hover:flex">
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => handlePin(e, conversation)}
          className={cn(
            "size-6",
            conversation.pinned
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <StarIcon
            className="size-3.5"
            fill={conversation.pinned ? "currentColor" : "none"}
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => handleDelete(e, conversation.id)}
          className="size-6 text-muted-foreground hover:text-destructive"
        >
          <Trash2Icon className="size-3.5" />
        </Button>
      </span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background text-foreground">
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onClose}
          title={t("common.close")}
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="flex flex-1 items-center gap-2">
          <span className="font-medium text-sm">
            {t("conversationHistory.title")}
          </span>
          {conversations.length > 0 && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
              {conversations.length}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onClose}
          title={t("common.close")}
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      <div className="px-3 pt-2 pb-1">
        <div className="relative">
          <SearchIcon className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("conversationHistory.search.placeholder")}
            className="w-full rounded-lg bg-muted/50 py-2 pr-10 pl-9 text-sm outline-none placeholder:text-muted-foreground focus:bg-muted"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setContentSearch(false);
                inputRef.current?.focus();
              }}
              className="-translate-y-1/2 absolute top-1/2 right-2.5 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          ) : (
            <span className="-translate-y-1/2 absolute top-1/2 right-3 text-muted-foreground text-xs">
              {IS_MAC ? "⌘K" : "Ctrl K"}
            </span>
          )}
        </div>
        {q && (
          <div className="px-1 pt-2 text-muted-foreground text-xs">
            {t("conversationHistory.search.results", {
              count: filtered.length,
            })}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <MessageSquareIcon className="size-8 opacity-50" />
            <p className="text-sm">{t("conversationHistory.noHistory")}</p>
          </div>
        ) : q ? (
          <>
            {filtered.map(renderRow)}
            {filtered.length === 0 && (
              <p className="px-2 py-6 text-center text-muted-foreground text-sm">
                {t("conversationHistory.search.noResults")}
              </p>
            )}
            {!contentSearch && (
              <button
                type="button"
                onClick={() => setContentSearch(true)}
                className="mt-3 w-full rounded-xl border border-dashed p-3 text-center text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground"
              >
                <span className="block">
                  {t("conversationHistory.search.inContentHint")}
                </span>
                <span className="mt-1 block font-medium text-foreground">
                  {t("conversationHistory.search.inContent")}
                </span>
              </button>
            )}
          </>
        ) : (
          <>
            {pinned.length > 0 && (
              <div>
                <div className="px-2 pt-3 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                  {t("conversationHistory.groups.pinned")}
                </div>
                {pinned.map(renderRow)}
              </div>
            )}
            {groupDefs.map(({ key, label }) => {
              const items = unpinned.filter(
                (c) => bucketByDate(c.updatedAt) === key,
              );
              if (items.length === 0) return null;
              return (
                <div key={key}>
                  <div className="px-2 pt-3 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                    {label}
                  </div>
                  {items.map(renderRow)}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
