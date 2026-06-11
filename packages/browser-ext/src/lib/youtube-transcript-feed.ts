/**
 * Auto-feeds the YouTube transcript to the AI in fixed time windows.
 *
 * When the outgoing message has a YouTube video attached as context (the
 * persistent current-page chip or a tab picked from the context menu), each
 * send automatically carries the NEXT 10-minute transcript window as an extra
 * context item. The already-sent window numbers are derived from the
 * conversation's message history (the chunk metadata is stored on each user
 * message), so the feed needs no separate cursor state and survives
 * conversation reloads.
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

export const YOUTUBE_TRANSCRIPT_CONTEXT_KIND = "youtube-transcript";
const CHUNK_FETCH_TIMEOUT_MS = 5000;

export interface YoutubeContextTarget {
  tabId?: number;
  url: string;
  videoId: string;
}

export function findYoutubeContextTarget(
  contexts: ContextItem[] | undefined,
): YoutubeContextTarget | null {
  if (!contexts?.length) {
    return null;
  }
  for (const item of contexts) {
    if (item.metadata?.kind === YOUTUBE_TRANSCRIPT_CONTEXT_KIND) {
      continue;
    }
    const url =
      typeof item.metadata?.url === "string" ? item.metadata.url : undefined;
    if (!url) {
      continue;
    }
    const videoId = extractYoutubeVideoId(url);
    if (!videoId) {
      continue;
    }
    const tabId =
      typeof item.metadata?.tabId === "number"
        ? item.metadata.tabId
        : undefined;
    return { tabId, url, videoId };
  }
  return null;
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
    const target = findYoutubeContextTarget(contexts);
    if (!target) {
      return contexts;
    }

    const tabId = await resolveTabId(target);
    if (tabId === undefined) {
      return contexts;
    }

    const transcript = await withTimeout(
      getYoutubeTranscriptWindows(tabId, target.url),
      CHUNK_FETCH_TIMEOUT_MS,
    );
    if (!transcript?.success || !transcript.windows.length) {
      return contexts;
    }

    const part = nextTranscriptPart(
      messages,
      transcript.videoId ?? target.videoId,
    );
    const window = transcript.windows[part - 1];
    if (!window) {
      return contexts;
    }

    return [
      ...(contexts ?? []),
      buildTranscriptChunkContext(transcript, window, target.url),
    ];
  } catch {
    return contexts;
  }
}
