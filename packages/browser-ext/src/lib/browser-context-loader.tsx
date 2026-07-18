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

export { CURRENT_PAGE_CONTEXT_ID } from "./context-ids";

import { CURRENT_PAGE_CONTEXT_ID } from "./context-ids";

const SELECTION_CONTEXT_PREFIX = "aipex-selection";
const PENDING_SELECTION_KEY = "aipex-pending-selection";
const PENDING_CONTEXT_KEY = "aipex-pending-context";
// Clean Markdown carries far more signal per char than the old raw-text dump,
// so a larger budget is still token-reasonable.
const PAGE_TEXT_LIMIT = 12000;

interface PageMeta {
  title?: string;
  site?: string;
  author?: string;
  published?: string;
  description?: string;
  wordCount?: number;
  extractor?: string;
  structured?: Record<string, string>;
}

interface PageExtraction {
  text: string;
  meta?: PageMeta;
  mode: string;
  truncated: boolean;
  /** What the user is currently looking at (viewport region), from the content script. */
  visible?: { topHeading?: string; scrollPct?: number };
}

/**
 * Ask the content script for the active tab's content. It runs Defuddle in the
 * page (main-content-only Markdown + metadata) and falls back to the readable
 * innerText on apps/feeds. Reading at call time keeps it fresh on SPAs like X.
 * This matters most for the gateway, which relays to ChatGPT's web UI and
 * can't run our page-reading tools.
 */
async function requestPageExtraction(tabId: number): Promise<PageExtraction> {
  try {
    const response = (await chrome.tabs.sendMessage(
      tabId,
      { request: "get-page-text" },
      { frameId: 0 },
    )) as
      | {
          html?: string;
          readable?: string;
          url?: string;
          visible?: { topHeading?: string; scrollPct?: number };
        }
      | undefined;
    // Defuddle runs here (extension context), not in the content script —
    // content scripts can't load module chunks on CSP-strict sites. Lazy so
    // the 320KB bundle stays off the eager path.
    const { extractFromHtml } = await import("./page-extract");
    const extracted = await extractFromHtml(
      response?.html ?? "",
      response?.url ?? "",
      response?.readable ?? "",
    );
    // Only collapse excess blank lines — never spaces/tabs, which carry
    // Markdown structure (code indentation, nested lists).
    const body = extracted.text.replace(/\n{3,}/g, "\n\n").trim();
    const truncated = body.length > PAGE_TEXT_LIMIT;
    return {
      text: truncated ? body.slice(0, PAGE_TEXT_LIMIT) : body,
      meta: extracted.meta,
      mode: extracted.mode,
      truncated,
      visible: response?.visible,
    };
  } catch {
    return { text: "", mode: "error", truncated: false };
  }
}

/** Budgeted readable content of the active tab (used by the welcome card). */
export async function getPageText(tabId: number): Promise<string> {
  return (await requestPageExtraction(tabId)).text;
}

/** Decode the few HTML entities that leak into page titles (e.g. `&amp;`). */
function decodeTitle(title: string): string {
  return title
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'");
}

/** Compose the model-facing page block: a compact meta line + the content. */
function formatPageValue(url: string, ex: PageExtraction): string {
  const m = ex.meta ?? {};
  const sd = m.structured ?? {};
  // Defuddle often misses author/published/site — backfill from structured data.
  const author = m.author || sd.author;
  const published = m.published || sd.published;
  const site = m.site || sd.site;
  const metaLine = [
    site,
    author ? `by ${author}` : null,
    published,
    typeof m.wordCount === "number" ? `~${m.wordCount} words` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // Authoritative fields Defuddle drops (price/rating/type) — each ≤120 chars.
  const dataLine =
    [
      sd.type ? `type: ${sd.type}` : null,
      sd.price ? `price: ${sd.price}` : null,
      sd.rating ? `rating: ${sd.rating}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || null;
  // Skip the meta description when the body already contains it — otherwise a
  // short page (e.g. a tweet) repeats the same text as title, quote AND body.
  const description = m.description?.trim();
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const bodyHasDescription =
    description && norm(ex.text).includes(norm(description));
  // Tell the model how much it's missing so it can decide whether read_page is
  // worth a round-trip, instead of calling it blindly just to probe the size.
  const shownWords = ex.text.trim() ? ex.text.trim().split(/\s+/).length : 0;
  const truncatedNote =
    typeof m.wordCount === "number" && m.wordCount > shownWords
      ? `\n…[truncated — showing ~${shownWords} of ~${m.wordCount} words; call read_page for the rest]`
      : `\n…[truncated — showing ~${shownWords} words; call read_page for the full content]`;
  // Reconcile the whole-page text with the viewport screenshot: this tells the
  // model which section the user is actually looking at.
  const v = ex.visible;
  const viewingLine = v?.topHeading
    ? `Currently viewing: ${v.topHeading}${
        typeof v.scrollPct === "number" ? ` (~${v.scrollPct}% down)` : ""
      }`
    : typeof v?.scrollPct === "number" && v.scrollPct > 0
      ? `Currently viewing: ~${v.scrollPct}% down the page`
      : null;
  return [
    `URL: ${url}`,
    viewingLine,
    metaLine || null,
    dataLine,
    description && !bodyHasDescription ? `> ${description}` : null,
    "",
    ex.text,
    ex.truncated ? truncatedNote : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/**
 * Build the current page's context item (no icon — callers that render a
 * chip attach their own). Returns null on restricted pages. Also used at
 * send time to guarantee the page rides along when the chip is hidden on an
 * empty conversation (the welcome page-card represents it instead).
 */
export async function readActivePageContext(): Promise<ContextItem | null> {
  try {
    // currentWindow keeps multi-window setups honest: {active:true} alone
    // returns one active tab PER window and could pick another window's page.
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs.find((t) => /^https?:\/\//.test(t.url ?? "")) ?? tabs[0];
    const url = tab?.url ?? "";
    if (!/^https?:\/\//.test(url)) {
      return null;
    }
    if (tab?.id) {
      prefetchYoutubeTranscript(tab.id, url);
    }
    const domain = new URL(url).hostname.replace(/^www\./, "");
    const extraction = tab?.id
      ? await requestPageExtraction(tab.id)
      : ({ text: "", mode: "error", truncated: false } as PageExtraction);
    const favicon =
      tab?.favIconUrl && /^(https:|data:)/.test(tab.favIconUrl)
        ? tab.favIconUrl
        : undefined;
    return {
      id: CURRENT_PAGE_CONTEXT_ID,
      type: "page",
      // Stays attached across sends; only the user's X removes it.
      persistent: true,
      label: tab?.title?.trim() ? decodeTitle(tab.title.trim()) : domain,
      value: extraction.text ? formatPageValue(url, extraction) : url,
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
  const refreshGenerationRef = useRef(0);

  const ensurePageContext = useCallback(async (refreshText = false) => {
    const generation = ++refreshGenerationRef.current;
    try {
      // Empty conversation → the welcome card stands in for the page chip.
      if (!hasConversationRef.current) {
        removeContextRef.current(CURRENT_PAGE_CONTEXT_ID);
        return;
      }

      const item = await readActivePageContext();
      if (
        generation !== refreshGenerationRef.current ||
        !hasConversationRef.current
      ) {
        return;
      }
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
      refreshGenerationRef.current += 1;
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
