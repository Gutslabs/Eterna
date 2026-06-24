/**
 * Auto-feeds the YouTube transcript to the AI in fixed time windows.
 *
 * When the outgoing message has a YouTube video attached as context (the
 * persistent current-page chip or a tab picked from the context menu), each
 * send automatically carries the NEXT 10-minute transcript window as an extra
 * context item. The already-sent window numbers are derived from the
 * IN-MEMORY message history (chunk metadata on each user message) — no
 * separate cursor state. Note: conversation storage strips context parts, so
 * a restored conversation starts again from part 1; that matches reality,
 * because restoring also starts a fresh agent session that hasn't seen the
 * earlier parts.
 */

import type { ContextItem } from "@aipexstudio/aipex-react/components/ai-elements/prompt-input";
import type { UIMessage } from "@aipexstudio/aipex-react/types";
import {
  extractYoutubeVideoId,
  formatTimecode,
  getYoutubeTranscriptWindows,
  type TranscriptWindow,
  type YoutubeTranscriptWindows,
} from "@aipexstudio/browser-runtime/tools/youtube-transcript-chunks";
import { CURRENT_PAGE_CONTEXT_ID } from "./context-ids";

export const YOUTUBE_TRANSCRIPT_CONTEXT_KIND = "youtube-transcript";
const CHUNK_FETCH_TIMEOUT_MS = 5000;

export interface YoutubeContextTarget {
  tabId?: number;
  url: string;
  videoId: string;
}

/**
 * All YouTube videos referenced by the attached contexts, deduped by video.
 * The current-page chip is preferred first — its position in the composer
 * array shifts between sends (the loader's refresh re-appends it), and
 * ordering by raw array position made the feed alternate between videos.
 */
export function findYoutubeContextTargets(
  contexts: ContextItem[] | undefined,
): YoutubeContextTarget[] {
  if (!contexts?.length) {
    return [];
  }
  const ordered = [...contexts].sort(
    (a, b) =>
      Number(b.id === CURRENT_PAGE_CONTEXT_ID) -
      Number(a.id === CURRENT_PAGE_CONTEXT_ID),
  );
  const targets: YoutubeContextTarget[] = [];
  for (const item of ordered) {
    if (item.metadata?.kind === YOUTUBE_TRANSCRIPT_CONTEXT_KIND) {
      continue;
    }
    const url =
      typeof item.metadata?.url === "string" ? item.metadata.url : undefined;
    if (!url) {
      continue;
    }
    const videoId = extractYoutubeVideoId(url);
    if (!videoId || targets.some((t) => t.videoId === videoId)) {
      continue;
    }
    const tabId =
      typeof item.metadata?.tabId === "number"
        ? item.metadata.tabId
        : undefined;
    targets.push({ tabId, url, videoId });
  }
  return targets;
}

/**
 * The next window to send is one past the highest part number already present
 * in the conversation for this video.
 */
export function nextTranscriptPart(
  messages: UIMessage[],
  videoId: string,
): number {
  let maxPart = 0;
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "context") {
        continue;
      }
      const meta = part.metadata;
      if (
        meta?.kind !== YOUTUBE_TRANSCRIPT_CONTEXT_KIND ||
        meta.videoId !== videoId
      ) {
        continue;
      }
      const sentPart = typeof meta.part === "number" ? meta.part : 0;
      if (sentPart > maxPart) {
        maxPart = sentPart;
      }
    }
  }
  return maxPart + 1;
}

export function buildTranscriptChunkContext(
  transcript: YoutubeTranscriptWindows,
  window: TranscriptWindow,
  url: string,
): ContextItem {
  const totalParts = transcript.windows.length;
  const range = `${formatTimecode(window.startSec)}–${formatTimecode(window.endSec)}`;
  const duration = transcript.durationSeconds
    ? `, duration ${formatTimecode(transcript.durationSeconds)}`
    : "";
  const before =
    window.part > 1
      ? " Earlier parts were attached to previous messages in this conversation."
      : "";
  const after =
    window.part < totalParts
      ? " The next part will be attached automatically to the user's next message."
      : " This is the final part — the conversation now contains the full transcript.";

  const value = [
    `[Auto-attached YouTube transcript — part ${window.part}/${totalParts}, covering ${range}]`,
    `Video: "${transcript.title ?? "YouTube video"}" (${url}${duration})`,
    `${before}${after}`.trim(),
    "If the user needs information beyond the parts received so far, call the get_youtube_transcript tool to fetch the full transcript at once.",
    "",
    window.text,
  ].join("\n");

  return {
    id: `youtube-transcript-${transcript.videoId}-${window.part}`,
    type: "custom",
    label: `YouTube transcript ${range} · ${window.part}/${totalParts}`,
    value,
    metadata: {
      kind: YOUTUBE_TRANSCRIPT_CONTEXT_KIND,
      videoId: transcript.videoId,
      part: window.part,
      totalParts,
      startSec: window.startSec,
      endSec: window.endSec,
      url,
    },
  };
}

async function resolveTabId(
  target: YoutubeContextTarget,
): Promise<number | undefined> {
  if (target.tabId !== undefined) {
    return target.tabId;
  }
  try {
    const tabs = await chrome.tabs.query({});
    return tabs.find(
      (tab) => tab.url && extractYoutubeVideoId(tab.url) === target.videoId,
    )?.id;
  } catch {
    return undefined;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * If the outgoing contexts reference a YouTube video, append the next unsent
 * transcript window as an extra context item. Falls back to the original
 * contexts on any failure or timeout (the fetch keeps warming the cache for
 * the next send), and appends nothing once every window has been sent.
 */
export async function withYoutubeTranscriptChunk(
  contexts: ContextItem[] | undefined,
  messages: UIMessage[],
): Promise<ContextItem[] | undefined> {
  try {
    // Walk the candidates in preference order — when the first video's
    // windows are all sent (or its fetch fails), the next attached video
    // still gets fed instead of being silently skipped.
    for (const target of findYoutubeContextTargets(contexts)) {
      const tabId = await resolveTabId(target);
      if (tabId === undefined) {
        continue;
      }

      const transcript = await withTimeout(
        getYoutubeTranscriptWindows(tabId, target.url),
        CHUNK_FETCH_TIMEOUT_MS,
      );
      if (!transcript?.success || !transcript.windows.length) {
        continue;
      }

      const part = nextTranscriptPart(
        messages,
        transcript.videoId ?? target.videoId,
      );
      const window = transcript.windows[part - 1];
      if (!window) {
        continue;
      }

      return [
        ...(contexts ?? []),
        buildTranscriptChunkContext(transcript, window, target.url),
      ];
    }
    return contexts;
  } catch {
    return contexts;
  }
}
