/**
 * Splits an attached YouTube transcript into a sequential send queue.
 *
 * The first window travels with the user's original message. Each remaining
 * window is sent only after the previous AI response has finished.
 */

import type { ContextItem } from "@aipexstudio/aipex-react/components/ai-elements/prompt-input";
import type { MessageAttachment } from "@aipexstudio/aipex-react/types";
import {
  extractYoutubeVideoId,
  formatTimecode,
  getYoutubeTranscriptWindows,
  type TranscriptWindow,
  type YoutubeTranscriptWindows,
} from "@aipexstudio/browser-runtime/tools/youtube-transcript-chunks";
import { CURRENT_PAGE_CONTEXT_ID } from "./context-ids";

export const YOUTUBE_TRANSCRIPT_CONTEXT_KIND = "youtube-transcript";
export const YOUTUBE_TRANSCRIPT_QUEUE_MODE = "automatic";
const CHUNK_FETCH_TIMEOUT_MS = 5000;

export interface YoutubeContextTarget {
  tabId?: number;
  url: string;
  videoId: string;
}

export interface YoutubeTranscriptQueuePlan {
  queueId: string;
  target: YoutubeContextTarget & { tabId: number };
  transcript: YoutubeTranscriptWindows;
  initialContexts: ContextItem[] | undefined;
}

export interface YoutubeTranscriptQueueProgress {
  queueId: string;
  videoId: string;
  currentPart: number;
  totalParts: number;
  currentRange: string;
  queuedParts: number;
}

export interface YoutubeTranscriptQueueInput {
  text: string;
  files?: MessageAttachment[];
  contexts?: ContextItem[];
  send: (
    text: string,
    files?: MessageAttachment[],
    contexts?: ContextItem[],
  ) => Promise<void> | void;
}

type QueueProgressListener = (
  progress: YoutubeTranscriptQueueProgress | null,
) => void;

let activeQueueSequence = 0;
let activeQueueProgress: YoutubeTranscriptQueueProgress | null = null;
const queueProgressListeners = new Set<QueueProgressListener>();

function publishQueueProgress(
  progress: YoutubeTranscriptQueueProgress | null,
): void {
  activeQueueProgress = progress;
  for (const listener of queueProgressListeners) {
    listener(progress);
  }
}

export function getYoutubeTranscriptQueueProgress(): YoutubeTranscriptQueueProgress | null {
  return activeQueueProgress;
}

export function subscribeYoutubeTranscriptQueueProgress(
  listener: QueueProgressListener,
): () => void {
  queueProgressListeners.add(listener);
  return () => queueProgressListeners.delete(listener);
}

export function cancelYoutubeTranscriptQueue(): void {
  activeQueueSequence += 1;
  publishQueueProgress(null);
}

/**
 * All YouTube videos referenced by the attached contexts, deduped by video.
 * The current-page chip is preferred over manually attached tabs.
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
    if (!videoId || targets.some((target) => target.videoId === videoId)) {
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

export function buildTranscriptChunkContext(
  transcript: YoutubeTranscriptWindows,
  window: TranscriptWindow,
  url: string,
  queue?: { queueId: string; tabId: number },
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
      ? " The next part is already queued and will be sent automatically after this response."
      : " This is the final part — the conversation now contains the full transcript.";

  const value = [
    `[Auto-attached YouTube transcript — part ${window.part}/${totalParts}, covering ${range}]`,
    `Video: "${transcript.title ?? "YouTube video"}" (${url}${duration})`,
    `${before}${after}`.trim(),
    "",
    window.text,
  ].join("\n");

  return {
    id: `youtube-transcript-${transcript.videoId}-${queue?.queueId ?? "single"}-${window.part}`,
    type: "custom",
    label: `YouTube transcript ${range} · ${window.part}/${totalParts}`,
    value,
    metadata: {
      kind: YOUTUBE_TRANSCRIPT_CONTEXT_KIND,
      queueMode: queue ? YOUTUBE_TRANSCRIPT_QUEUE_MODE : undefined,
      queueId: queue?.queueId,
      videoId: transcript.videoId,
      part: window.part,
      totalParts,
      startSec: window.startSec,
      endSec: window.endSec,
      tabId: queue?.tabId,
      url,
    },
  };
}

export function buildQueuedTranscriptPrompt(
  originalPrompt: string,
  window: TranscriptWindow,
  totalParts: number,
): string {
  const range = `${formatTimecode(window.startSec)}–${formatTimecode(window.endSec)}`;
  const original = originalPrompt.trim();
  return [
    `[Queued YouTube segment ${window.part}/${totalParts} · ${range}]`,
    "Continue the original request with this next video segment. Preserve and extend the work from earlier segments; do not restart or ask the user to send the next part.",
    ...(original ? ["", `Original request: ${original}`] : []),
  ].join("\n");
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

function createQueueId(videoId: string): string {
  return `${videoId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function prepareYoutubeTranscriptQueue(
  contexts: ContextItem[] | undefined,
): Promise<YoutubeTranscriptQueuePlan | null> {
  try {
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
      return {
        queueId: createQueueId(transcript.videoId ?? target.videoId),
        target: { ...target, tabId },
        transcript,
        initialContexts: contexts,
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function executeYoutubeTranscriptQueue(
  plan: YoutubeTranscriptQueuePlan,
  input: YoutubeTranscriptQueueInput,
  sequence: number,
): Promise<void> {
  const { transcript, target, queueId } = plan;
  const totalParts = transcript.windows.length;

  try {
    for (const window of transcript.windows) {
      if (sequence !== activeQueueSequence) {
        return;
      }
      const currentRange = `${formatTimecode(window.startSec)}–${formatTimecode(window.endSec)}`;
      publishQueueProgress({
        queueId,
        videoId: transcript.videoId ?? target.videoId,
        currentPart: window.part,
        totalParts,
        currentRange,
        queuedParts: totalParts - window.part + 1,
      });

      const chunk = buildTranscriptChunkContext(
        transcript,
        window,
        target.url,
        { queueId, tabId: target.tabId },
      );
      const isFirst = window.part === 1;
      const text = isFirst
        ? input.text
        : buildQueuedTranscriptPrompt(input.text, window, totalParts);
      const contexts = isFirst
        ? [...(plan.initialContexts ?? []), chunk]
        : [chunk];

      await input.send(text, isFirst ? input.files : undefined, contexts);
    }
  } finally {
    if (sequence === activeQueueSequence) {
      publishQueueProgress(null);
    }
  }
}

export async function runPreparedYoutubeTranscriptQueue(
  plan: YoutubeTranscriptQueuePlan,
  input: YoutubeTranscriptQueueInput,
): Promise<void> {
  const sequence = ++activeQueueSequence;
  await executeYoutubeTranscriptQueue(plan, input, sequence);
}

/**
 * Start a fresh queue for this user submission. If no usable YouTube
 * transcript is attached, send the message normally.
 */
export async function runYoutubeTranscriptQueue(
  input: YoutubeTranscriptQueueInput,
): Promise<void> {
  const sequence = ++activeQueueSequence;
  publishQueueProgress(null);
  const plan = await prepareYoutubeTranscriptQueue(input.contexts);
  if (sequence !== activeQueueSequence) {
    return;
  }
  if (!plan) {
    await input.send(input.text, input.files, input.contexts);
    return;
  }
  await executeYoutubeTranscriptQueue(plan, input, sequence);
}
