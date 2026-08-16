/**
 * Custom hook for syncing context with browser tab events
 * Monitors tab changes and updates available contexts accordingly
 */

import {
  BookmarksProvider,
  CurrentPageProvider,
  TabsProvider,
} from "@eterna/browser-runtime";
import type { Context } from "@eterna/core";
import type { ContextItem } from "@eterna/react/components/ai-elements/prompt-input";
import { useCallback, useEffect, useRef } from "react";

const currentPageProvider = new CurrentPageProvider();
const tabsProvider = new TabsProvider();
const bookmarksProvider = new BookmarksProvider();

/**
 * Get all available contexts from providers
 * Converts core Context to UI ContextItem
 */
async function getAllAvailableContexts(): Promise<ContextItem[]> {
  const results = await Promise.allSettled([
    currentPageProvider.getContexts(),
    tabsProvider.getContexts(),
    bookmarksProvider.getContexts(),
  ]);

  const contexts: Context[] = [];
  let currentPageTabId: number | null = null;
  let currentPageUrl: string | null = null;

  // Current page - add first and record its tab ID and URL
  if (results[0].status === "fulfilled" && results[0].value.length > 0) {
    const currentPage = results[0].value[0]!;
    contexts.push(currentPage);

    // Extract tab ID from metadata
    currentPageTabId = currentPage.metadata?.tabId as number | null;
    currentPageUrl = currentPage.metadata?.url as string | null;
  }

  // Tabs - exclude the current page tab
  if (results[1].status === "fulfilled") {
    const allTabs = results[1].value;
    const filteredTabs = allTabs.filter((tab) => {
      const tabId = tab.metadata?.tabId as number | undefined;
      if (currentPageTabId !== null && tabId === currentPageTabId) {
        return false;
      }
      return true;
    });
    contexts.push(...filteredTabs);
  }

  // Bookmarks - exclude if URL matches current page
  if (results[2].status === "fulfilled") {
    const allBookmarks = results[2].value;
    const filteredBookmarks = allBookmarks.filter((bookmark) => {
      if (currentPageUrl && bookmark.metadata?.url === currentPageUrl) {
        return false;
      }
      return true;
    });
    contexts.push(...filteredBookmarks);
  }

  // Convert core Context to UI ContextItem
  return contexts.map((ctx) => ({
    id: ctx.id,
    type: ctx.type as ContextItem["type"],
    label: ctx.label,
    value: typeof ctx.value === "string" ? ctx.value : "",
    metadata: ctx.metadata,
  }));
}

interface UseTabsSyncOptions {
  /**
   * Callback to update available contexts
   */
  onContextsUpdate: (contexts: ContextItem[]) => void;

  /**
   * Callback to remove a specific context by ID
   */
  onContextRemove: (contextId: string) => void;

  /**
   * Get currently selected context items
   */
  getSelectedContexts: () => ContextItem[];

  /**
   * Debounce delay in milliseconds (default: 300ms)
   */
  debounceDelay?: number;
}

/**
 * Hook to sync available contexts with browser tab events
 * - Refreshes available contexts when tabs are created, removed, or updated
 * - Automatically removes context tags for closed tabs
 *
 * Callers pass inline callbacks whose identity changes on every streaming
 * commit, so everything reads the latest options through a ref: the four
 * chrome.tabs listeners register exactly once per mount instead of being torn
 * down and re-added per render — which also kept cancelling the debounce
 * timer, so context rebuilds could never fire while a response streamed.
 */
export function useTabsSync(options: UseTabsSyncOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isInitializedRef = useRef(false);

  const rebuildContexts = useCallback((immediate = false) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const run = async (): Promise<void> => {
      try {
        const contexts = await getAllAvailableContexts();
        optionsRef.current.onContextsUpdate(contexts);
      } catch (error) {
        console.error("[useTabsSync] Failed to rebuild contexts:", error);
      }
    };

    // Execute immediately if requested (for initial load)
    if (immediate) {
      void run();
      return;
    }

    debounceTimerRef.current = setTimeout(
      run,
      optionsRef.current.debounceDelay ?? 300,
    );
  }, []);

  useEffect(() => {
    // Load initial contexts immediately (no debounce)
    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      rebuildContexts(true);
    }

    const handleTabActivated = (_activeInfo: {
      tabId: number;
      windowId: number;
    }) => {
      // Rebuild contexts to update "Current Page" context
      rebuildContexts();
    };

    const handleTabCreated = (_tab: chrome.tabs.Tab) => {
      rebuildContexts();
    };

    const handleTabRemoved = (tabId: number) => {
      const selectedContexts = optionsRef.current.getSelectedContexts();
      const tabContextId = `tab-${tabId}`;
      if (selectedContexts.some((ctx) => ctx.id === tabContextId)) {
        optionsRef.current.onContextRemove(tabContextId);
      }
      rebuildContexts();
    };

    const handleTabUpdated = (
      _tabId: number,
      changeInfo: { title?: string; url?: string; status?: string },
      _tab: chrome.tabs.Tab,
    ) => {
      // Only rebuild if meaningful changes occurred
      if (
        changeInfo.title ||
        changeInfo.url ||
        changeInfo.status === "complete"
      ) {
        rebuildContexts();
      }
    };

    chrome.tabs.onActivated.addListener(handleTabActivated);
    chrome.tabs.onCreated.addListener(handleTabCreated);
    chrome.tabs.onRemoved.addListener(handleTabRemoved);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      chrome.tabs.onActivated.removeListener(handleTabActivated);
      chrome.tabs.onCreated.removeListener(handleTabCreated);
      chrome.tabs.onRemoved.removeListener(handleTabRemoved);
      chrome.tabs.onUpdated.removeListener(handleTabUpdated);
    };
  }, [rebuildContexts]);
}
