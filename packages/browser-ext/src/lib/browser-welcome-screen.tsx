/**
 * BrowserWelcomeScreen — page-aware welcome (Sidebar Welcome v2, Variant A).
 *
 * Opening the sidebar on any tab shows a scan-status line ("page read ·
 * 1.2s"), a "what I see" card for the current page and page-specific
 * suggestion rows, instead of the generic suggestion list. The page brief is
 * heuristic (no LLM call): kind detection + countable meta from the page
 * text. Falls back to the default welcome on restricted pages.
 */

import { useChatContext } from "@aipexstudio/aipex-react/components/chatbot";
import { DefaultWelcomeScreen } from "@aipexstudio/aipex-react/components/chatbot/components";
import { useTranslation } from "@aipexstudio/aipex-react/i18n/context";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import type { WelcomeScreenProps } from "@aipexstudio/aipex-react/types";
import { ChevronRightIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getPageText, readActivePageContext } from "./browser-context-loader";
import {
  buildPageBrief,
  cleanPageTitle,
  countWords,
  type PageBrief,
} from "./page-brief";
import { withYoutubeTranscriptChunk } from "./youtube-transcript-feed";

const ACCENT_OK = "#7fae8e";

interface ScannedPage {
  url: string;
  title: string;
  favIconUrl?: string;
  brief: PageBrief;
  scanMs: number;
}

type ScanState =
  | { status: "scanning" }
  | { status: "done"; page: ScannedPage }
  | { status: "unavailable" };

const SPA_REREAD_DELAY_MS = 1500;
const LOW_CONTENT_WORDS = 20;
const MAX_LOW_CONTENT_RETRIES = 2;

/**
 * Scans the active page and KEEPS it fresh while the welcome screen is open:
 * re-scans on tab switches, SPA navigations (tabs.onUpdated url changes) and
 * panel refocus, with a coalesced delayed re-read because SPAs like X render
 * content well after the URL changes (the first pass often catches an almost
 * empty DOM).
 */
function useScannedPage(): ScanState {
  const [state, setState] = useState<ScanState>({ status: "scanning" });

  useEffect(() => {
    let cancelled = false;
    let scanSeq = 0;
    let rereadTimer = 0;
    let lastUrl: string | null = null;
    let lowContentRetries = 0;

    const scheduleReread = () => {
      window.clearTimeout(rereadTimer);
      rereadTimer = window.setTimeout(
        () => void scan(false),
        SPA_REREAD_DELAY_MS,
      );
    };

    const scan = async (showSpinner: boolean) => {
      const seq = ++scanSeq;
      const startedAt = Date.now();
      try {
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const tab =
          tabs.find((t) => /^https?:\/\//.test(t.url ?? "")) ?? tabs[0];
        const url = tab?.url ?? "";
        if (cancelled || seq !== scanSeq) return;
        if (!tab?.id || !/^https?:\/\//.test(url)) {
          setState({ status: "unavailable" });
          return;
        }
        const urlChanged = url !== lastUrl;
        if (urlChanged) {
          lastUrl = url;
          lowContentRetries = 0;
        }
        if (showSpinner && urlChanged) {
          setState({ status: "scanning" });
        }

        const text = await getPageText(tab.id);
        if (cancelled || seq !== scanSeq) return;
        setState({
          status: "done",
          page: {
            url,
            title: cleanPageTitle(tab.title, url),
            favIconUrl:
              tab.favIconUrl && /^(https:|data:)/.test(tab.favIconUrl)
                ? tab.favIconUrl
                : undefined,
            brief: buildPageBrief(url, text),
            scanMs: Math.max(100, Date.now() - startedAt),
          },
        });
        // SPA shells often respond before rendering content — read again
        // shortly so the card reflects the real page, not the empty frame.
        if (
          countWords(text) < LOW_CONTENT_WORDS &&
          lowContentRetries < MAX_LOW_CONTENT_RETRIES
        ) {
          lowContentRetries += 1;
          scheduleReread();
        }
      } catch {
        if (!cancelled && seq === scanSeq) {
          setState({ status: "unavailable" });
        }
      }
    };

    void scan(true);

    const onActivated = () => void scan(true);
    const onUpdated = (
      _tabId: number,
      info: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (!tab.active) return;
      if (info.url) {
        // Real (or SPA) navigation: rescan now and again once content lands.
        void scan(true);
        scheduleReread();
      } else if (info.status === "complete") {
        void scan(false);
        scheduleReread();
      }
    };
    const onFocus = () => void scan(false);

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearTimeout(rereadTimer);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return state;
}

function ScanStatusLine({
  label,
  scanMs,
  scanning,
}: {
  label: string;
  scanMs?: number;
  scanning: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={
          scanning
            ? {
                background: "var(--foreground)",
                animation: "aipex-rail-pulse 1.6s ease-out infinite",
              }
            : { background: ACCENT_OK }
        }
      />
      <span className="truncate text-[11px] text-muted-foreground">
        {label}
      </span>
      {scanMs !== undefined && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
          {(scanMs / 1000).toFixed(1)}s
        </span>
      )}
      <style>{`@keyframes aipex-rail-pulse {
        0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--foreground) 30%, transparent); }
        70% { box-shadow: 0 0 0 6px transparent; }
        100% { box-shadow: 0 0 0 0 transparent; }
      }`}</style>
    </div>
  );
}

function PageBriefCard({ page }: { page: ScannedPage }) {
  const { t } = useTranslation();
  const { brief } = page;

  const subtitle = `${t(`pageBrief.kind.${brief.kindKey}`)} · ${t(
    "pageBrief.scanned",
    { count: brief.wordCount },
  )}`;
  const body = t(`pageBrief.body.${brief.bodyKey}`, {
    minutes: brief.readingMinutes,
  });

  return (
    <div className="rounded-[13px] border border-border bg-card px-3.5 py-3">
      <div className="mb-2.5 flex items-center gap-2.5">
        <div className="flex size-[26px] shrink-0 items-center justify-center overflow-hidden rounded-[7px] border border-border bg-muted">
          {page.favIconUrl ? (
            <img src={page.favIconUrl} alt="" className="size-4" />
          ) : (
            <span className="font-semibold text-[11px] text-foreground">
              {page.title.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate font-semibold text-[13px] text-foreground">
            {page.title}
          </div>
          <div className="truncate text-[11px] text-muted-foreground/80">
            {subtitle}
          </div>
        </div>
      </div>
      <p className="m-0 text-[12.5px] text-muted-foreground leading-[1.55]">
        {body}
      </p>
    </div>
  );
}

function SuggestionRows({
  page,
  onSuggestionClick,
}: {
  page: ScannedPage;
  onSuggestionClick: (text: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="px-0.5 font-mono text-[10px] text-muted-foreground/60 uppercase tracking-[0.08em]">
        {t("pageBrief.forThisPage")}
      </div>
      {page.brief.suggestions.map((suggestion) => {
        const text = t(`pageBrief.sugg.${suggestion.key}`);
        return (
          <button
            key={suggestion.key}
            type="button"
            onClick={() => onSuggestionClick(text)}
            className="flex w-full items-center gap-2.5 rounded-[10px] border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
          >
            <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground uppercase">
              {t(`pageBrief.tag.${suggestion.tag}`)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/90">
              {text}
            </span>
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
          </button>
        );
      })}
    </div>
  );
}

export function BrowserWelcomeScreen({
  onSuggestionClick,
  onUxAuditClick,
  suggestions,
  className,
  ...props
}: WelcomeScreenProps) {
  const { t } = useTranslation();
  const scan = useScannedPage();
  const { sendMessage, messages } = useChatContext();

  // The page-specific prompts are deictic ("Summarize THIS video") — they
  // must carry the page context (and transcript chunk) themselves. The plain
  // onSuggestionClick path goes straight to sendMessage with no contexts,
  // which left gateway models asking "which video?".
  const sendSuggestion = useCallback(
    (text: string) => {
      void (async () => {
        const page = await readActivePageContext().catch(() => null);
        const contexts = page ? [page] : undefined;
        const enriched = await withYoutubeTranscriptChunk(contexts, messages);
        await sendMessage(text, undefined, enriched);
      })();
    },
    [sendMessage, messages],
  );

  // Restricted pages (chrome://, web store, …) keep the generic welcome.
  if (scan.status === "unavailable") {
    return (
      <DefaultWelcomeScreen
        onSuggestionClick={onSuggestionClick}
        onUxAuditClick={onUxAuditClick}
        suggestions={suggestions}
        className={className}
        {...props}
      />
    );
  }

  return (
    <div
      className={cn("flex h-full flex-col gap-3 p-3 pt-4", className)}
      {...props}
    >
      {scan.status === "scanning" ? (
        <ScanStatusLine label={t("pageBrief.scanning")} scanning />
      ) : (
        <>
          <ScanStatusLine
            label={t("pageBrief.read", { title: scan.page.title })}
            scanMs={scan.page.scanMs}
            scanning={false}
          />
          <PageBriefCard page={scan.page} />
          <SuggestionRows page={scan.page} onSuggestionClick={sendSuggestion} />
          <div className="flex items-center gap-2 px-0.5 text-[11.5px] text-muted-foreground/60">
            <span>{t("pageBrief.general")}</span>
            <button
              type="button"
              onClick={() => onSuggestionClick(t("welcome.organizeTabs"))}
              className="underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              {t("pageBrief.generalTabs")}
            </button>
            <button
              type="button"
              onClick={() => onSuggestionClick(t("welcome.research"))}
              className="underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              {t("pageBrief.generalResearch")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
