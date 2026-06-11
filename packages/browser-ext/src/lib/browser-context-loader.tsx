/**
 * BrowserContextLoader
 * Rendered inside PromptInput (via the promptExtras slot) to populate
 * available contexts (tabs, bookmarks, current page) and available skills.
 *
 * This component renders nothing visible; it only syncs data from
 * browser-runtime providers into the PromptInput context hooks.
 */

import {
  type ContextItem,
  type SkillItem,
  usePromptInputContexts,
  usePromptInputSkills,
} from "@aipexstudio/aipex-react/components/ai-elements/prompt-input";
import { useChatContext } from "@aipexstudio/aipex-react/components/chatbot";
import type { SkillMetadata } from "@aipexstudio/browser-runtime";
import { prefetchYoutubeTranscript } from "@aipexstudio/browser-runtime/tools/youtube-transcript-chunks";
import { useCallback, useEffect, useRef } from "react";
import { useTabsSync } from "../hooks/use-tabs-sync";

export const CURRENT_PAGE_CONTEXT_ID = "aipex-current-page";
const SELECTION_CONTEXT_PREFIX = "aipex-selection";
const PENDING_SELECTION_KEY = "aipex-pending-selection";
const PENDING_CONTEXT_KEY = "aipex-pending-context";
const PAGE_TEXT_LIMIT = 6000;

/**
 * Read the active tab's readable text from its live DOM (via the content
 * script) so the AI can actually "see" the page. This matters most for the
 * gateway, which relays to ChatGPT's web UI and can't run our page-reading
 * tools. Reading at call time also keeps it fresh on SPAs like X.
 */
export async function getPageText(tabId: number): Promise<string> {
  try {
    const response = (await chrome.tabs.sendMessage(
      tabId,
      { request: "get-page-text" },
      { frameId: 0 },
    )) as { text?: string } | undefined;
    const text = typeof response?.text === "string" ? response.text : "";
    return text
      .replace(/[\t ]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, PAGE_TEXT_LIMIT);
  } catch {
    return "";
  }
}

/**
 * Build the current page's context item (no icon — callers that render a
 * chip attach their own). Returns null on restricted pages. Also used at
 * send time to guarantee the page rides along when the chip is hidden on an
 * empty conversation (the welcome page-card represents it instead).
 */
export async function readActivePageContext(): Promise<ContextItem | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true });
    const tab = tabs.find((t) => /^https?:\/\//.test(t.url ?? "")) ?? tabs[0];
    const url = tab?.url ?? "";
    if (!/^https?:\/\//.test(url)) {
      return null;
    }
    if (tab?.id) {
      prefetchYoutubeTranscript(tab.id, url);
    }
    const domain = new URL(url).hostname.replace(/^www\./, "");
    const pageText = tab?.id ? await getPageText(tab.id) : "";
    const favicon =
      tab?.favIconUrl && /^(https:|data:)/.test(tab.favIconUrl)
        ? tab.favIconUrl
        : undefined;
    return {
      id: CURRENT_PAGE_CONTEXT_ID,
      type: "page",
      // Stays attached across sends; only the user's X removes it.
      persistent: true,
      label: tab?.title?.trim() || domain,
      value: pageText ? `URL: ${url}\n\n${pageText}` : url,
      metadata: {
        url,
        domain,
        tabId: tab?.id,
        favIconUrl: favicon,
      },
    };
  } catch {
    return null;
  }
}

export function BrowserContextLoader() {
  const contexts = usePromptInputContexts();
  const skills = usePromptInputSkills();
  const { messages } = useChatContext();
  // On an empty conversation the welcome page-card represents the page, so
  // the composer chip stays hidden; it appears once the conversation starts
  // (the page context itself is guaranteed at send time regardless).
  const hasConversation = messages.some((m) => m.role !== "system");
  const hasConversationRef = useRef(hasConversation);

  // Sync contexts from tab/bookmark/page providers
  useTabsSync({
    onContextsUpdate: (availableContexts) => {
      contexts.setAvailableContexts(availableContexts);
    },
    onContextRemove: (contextId) => {
      contexts.remove(contextId);
    },
    getSelectedContexts: () => {
      return contexts.items;
    },
    debounceDelay: 300,
  });

  // Auto-attach the current page as a selected context chip (like Dia's
  // built-in sidebar). The chip is persistent: it survives a send (see
  // clearContexts) so every message keeps the page as context and shows its
  // card, until the user removes it (X) or navigates to a different page.
  const addContextRef = useRef(contexts.add);
  addContextRef.current = contexts.add;
  const removeContextRef = useRef(contexts.remove);
  removeContextRef.current = contexts.remove;
  const itemsRef = useRef(contexts.items);
  itemsRef.current = contexts.items;
  const lastPageUrlRef = useRef<string | null>(null);
  // URL the user explicitly closed the page chip on (clicked X) — respected
  // until they navigate away.
  const userClosedUrlRef = useRef<string | null>(null);
  const prevHasPageRef = useRef(false);

  const ensurePageContext = useCallback(async (refreshText = false) => {
    try {
      // Empty conversation → the welcome card stands in for the page chip.
      if (!hasConversationRef.current) {
        removeContextRef.current(CURRENT_PAGE_CONTEXT_ID);
        return;
      }

      const item = await readActivePageContext();
      if (!item) {
        removeContextRef.current(CURRENT_PAGE_CONTEXT_ID);
        lastPageUrlRef.current = null;
        return;
      }
      const url = item.metadata?.url as string;
      // Navigating to a new page clears any previous manual close.
      if (url !== lastPageUrlRef.current) {
        lastPageUrlRef.current = url;
        userClosedUrlRef.current = null;
      }
      // Respect a manual close (X) until the user navigates away.
      if (userClosedUrlRef.current === url) return;
      // Already attached and no refresh requested → nothing to do.
      const present = itemsRef.current.some(
        (i) => i.id === CURRENT_PAGE_CONTEXT_ID,
      );
      if (present && !refreshText) return;

      // Only keep secure favicons. An http:// favicon (e.g. a localhost page
      // like the gateway's noVNC tab) would spam mixed-content warnings when
      // rendered as <img> on the extension's https-context page.
      const favicon =
        typeof item.metadata?.favIconUrl === "string"
          ? item.metadata.favIconUrl
          : undefined;
      const withIcon: ContextItem = {
        ...item,
        icon: favicon ? (
          <img
            src={favicon}
            alt=""
            className="size-4 rounded-sm object-contain"
          />
        ) : undefined,
      };
      removeContextRef.current(CURRENT_PAGE_CONTEXT_ID);
      addContextRef.current(withIcon);
    } catch {
      // Tab query may fail on restricted pages; ignore.
    }
  }, []);

  // Attach the chip the moment the conversation starts (first user message),
  // and drop it again when the chat resets to the welcome screen.
  useEffect(() => {
    hasConversationRef.current = hasConversation;
    void ensurePageContext(true);
  }, [hasConversation, ensurePageContext]);

  // Attach on mount and whenever the active tab changes / navigates / refocuses.
  useEffect(() => {
    void ensurePageContext(true);
    let rereadTimer = 0;
    const onActivated = () => void ensurePageContext(true);
    const onUpdated = (
      _tabId: number,
      info: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (tab.active && (info.status === "complete" || Boolean(info.url))) {
        void ensurePageContext(true);
        // SPA content (e.g. X) often renders after the URL changes — re-read
        // shortly after so the chip captures the loaded text, not an empty
        // shell. One pending re-read is enough: navigations fire several
        // onUpdated events in a row, so coalesce instead of stacking timers.
        window.clearTimeout(rereadTimer);
        rereadTimer = window.setTimeout(
          () => void ensurePageContext(true),
          1500,
        );
      }
    };
    // When the user focuses the panel (about to ask), refresh the page text so
    // it reflects whatever is currently on screen.
    const onFocus = () => void ensurePageContext(true);

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(rereadTimer);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      window.removeEventListener("focus", onFocus);
    };
  }, [ensurePageContext]);

  // The page chip is persistent (it survives a send), so it only leaves the
  // composer when the user removes it with X. Treat that as a deliberate close
  // and don't re-attach until they navigate to another page. (A page refresh
  // replaces the chip in one batched update, so it never reads as absent here.)
  useEffect(() => {
    const hasPage = contexts.items.some(
      (i) => i.id === CURRENT_PAGE_CONTEXT_ID,
    );
    if (prevHasPageRef.current && !hasPage) {
      userClosedUrlRef.current = lastPageUrlRef.current;
    }
    prevHasPageRef.current = hasPage;
  }, [contexts.items]);

  // Pick up text the user selected on the page (via the in-page "Ask AIPex"
  // button) and attach it as a context chip so it's sent to the AI.
  useEffect(() => {
    const consumePendingSelection = async () => {
      try {
        const result = await chrome.storage.local.get(PENDING_SELECTION_KEY);
        const pending = result[PENDING_SELECTION_KEY] as
          | { text?: string; url?: string; title?: string }
          | undefined;
        if (!pending?.text?.trim()) return;
        await chrome.storage.local.remove(PENDING_SELECTION_KEY);

        let domain: string | undefined;
        try {
          domain = pending.url
            ? new URL(pending.url).hostname.replace(/^www\./, "")
            : undefined;
        } catch {
          domain = undefined;
        }

        // Skip if the same text is already attached (e.g. copying twice).
        if (itemsRef.current.some((item) => item.value === pending.text)) {
          return;
        }

        addContextRef.current({
          id: `${SELECTION_CONTEXT_PREFIX}-${Date.now()}`,
          type: "custom",
          label: pending.text.trim(),
          value: pending.text,
          metadata: { kind: "selection", url: pending.url, domain },
        });
      } catch {
        // storage may be unavailable; ignore.
      }
    };

    void consumePendingSelection();
    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[PENDING_SELECTION_KEY]?.newValue) {
        void consumePendingSelection();
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  // Pick up a prompt queued by the prompt library (it renders above the input,
  // outside this provider, so it hands off via storage) and attach it as a chip.
  useEffect(() => {
    const consumePendingContext = async () => {
      try {
        const result = await chrome.storage.local.get(PENDING_CONTEXT_KEY);
        const pending = result[PENDING_CONTEXT_KEY] as
          | {
              label?: string;
              value?: string;
              metadata?: Record<string, unknown>;
            }
          | undefined;
        if (!pending?.value) return;
        await chrome.storage.local.remove(PENDING_CONTEXT_KEY);
        // Skip if the same prompt is already attached.
        if (itemsRef.current.some((item) => item.value === pending.value)) {
          return;
        }
        addContextRef.current({
          id: `prompt-${Date.now()}`,
          type: "custom",
          label: pending.label ?? "Prompt",
          value: pending.value,
          metadata: pending.metadata,
        });
      } catch {
        // storage may be unavailable; ignore.
      }
    };

    void consumePendingContext();
    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[PENDING_CONTEXT_KEY]?.newValue) {
        void consumePendingContext();
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  // Load skills and subscribe to skill changes. The skill runtime drags in the
  // QuickJS VM, ZenFS, and the inlined built-in SKILL.md sources (~450KB), none
  // of which first paint needs — so import it lazily and wire up only after it
  // resolves. The effect can unmount before that, so guard with `cancelled`.
  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];

    const setup = async () => {
      const { skillManager, skillStorage } = await import(
        "@aipexstudio/browser-runtime/skill"
      );
      if (cancelled) return;

      const loadSkills = async () => {
        try {
          const allSkills: SkillMetadata[] = await skillStorage.listSkills();
          const enabledSkills = allSkills.filter(
            (skill: SkillMetadata) => skill.enabled,
          );
          const skillItems: SkillItem[] = enabledSkills.map(
            (skill: SkillMetadata) => ({
              id: skill.id,
              name: skill.name,
              description: skill.description,
            }),
          );
          skills.setAvailableSkills(skillItems);
        } catch (error) {
          console.error("[BrowserContextLoader] Failed to load skills:", error);
        }
      };

      void loadSkills();

      const events = [
        "skill_loaded",
        "skill_unloaded",
        "skill_enabled",
        "skill_disabled",
      ] as const;
      for (const event of events) {
        unsubscribers.push(
          skillManager.subscribe(event, () => void loadSkills()),
        );
      }
    };

    void setup();

    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills]);

  return null;
}
