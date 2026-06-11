import {
  fetchYoutubeTranscriptForTab,
  type TranscriptSegment,
} from "./youtube-transcript";

export interface TranscriptWindow {
  part: number;
  startSec: number;
  endSec: number;
  text: string;
}

export interface YoutubeTranscriptWindows {
  success: boolean;
  error?: string;
  videoId?: string;
  title?: string;
  author?: string;
  durationSeconds?: number;
  language?: string;
  isAsr?: boolean;
  windows: TranscriptWindow[];
}

export const TRANSCRIPT_WINDOW_SECONDS = 600;
const TIMESTAMP_MARKER_INTERVAL_SECONDS = 60;
const WINDOW_TEXT_CHAR_LIMIT = 16000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const ERROR_CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_MAX_ENTRIES = 4;

export function extractYoutubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") {
      const id = parsed.pathname.slice(1).split("/")[0];
      return id || null;
    }
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      const v = parsed.searchParams.get("v");
      if (v) {
        return v;
      }
      const pathMatch = parsed.pathname.match(
        /\/(?:shorts|live|embed)\/([^/?#]+)/,
      );
      return pathMatch?.[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

export function formatTimecode(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mmss = `${minutes}:${String(seconds).padStart(2, "0")}`;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : mmss;
}

/**
 * Split a transcript into fixed time windows (default 10 minutes). Windows
 * with no speech are skipped, so `part` numbers are sequential while
 * startSec/endSec always state the real time range covered. Inside a window a
 * [m:ss] marker is emitted roughly every minute so the model can reference
 * moments in the video.
 */
export function buildTranscriptWindows(
  segments: TranscriptSegment[],
  windowSeconds: number = TRANSCRIPT_WINDOW_SECONDS,
): TranscriptWindow[] {
  if (!segments.length || windowSeconds <= 0) {
    return [];
  }

  const buckets = new Map<number, TranscriptSegment[]>();
  for (const segment of segments) {
    const bucket = Math.floor(segment.start / windowSeconds);
    const list = buckets.get(bucket);
    if (list) {
      list.push(segment);
    } else {
      buckets.set(bucket, [segment]);
    }
  }

  const windows: TranscriptWindow[] = [];
  const orderedBuckets = [...buckets.keys()].sort((a, b) => a - b);
  for (const bucket of orderedBuckets) {
    const bucketSegments = buckets.get(bucket);
    if (!bucketSegments?.length) {
      continue;
    }

    let text = "";
    let lastMarkerAt = Number.NEGATIVE_INFINITY;
    for (const segment of bucketSegments) {
      if (segment.start - lastMarkerAt >= TIMESTAMP_MARKER_INTERVAL_SECONDS) {
        text += `${text ? "\n" : ""}[${formatTimecode(segment.start)}] `;
        lastMarkerAt = segment.start;
      } else {
        text += " ";
      }
      text += segment.text;
    }
    if (text.length > WINDOW_TEXT_CHAR_LIMIT) {
      text = `${text.slice(0, WINDOW_TEXT_CHAR_LIMIT)}… (window truncated)`;
    }

    windows.push({
      part: windows.length + 1,
      startSec: bucket * windowSeconds,
      endSec: (bucket + 1) * windowSeconds,
      text,
    });
  }

  const lastWindow = windows[windows.length - 1];
  const lastSegment = segments[segments.length - 1];
  if (lastWindow && lastSegment) {
    const speechEnd = Math.ceil(
      lastSegment.start + (lastSegment.duration || 0),
    );
    lastWindow.endSec = Math.min(
      lastWindow.endSec,
      Math.max(speechEnd, lastWindow.startSec + 1),
    );
  }

  return windows;
}

interface CacheEntry {
  result: YoutubeTranscriptWindows;
  expiresAt: number;
}

const windowsCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<YoutubeTranscriptWindows>>();

function now(): number {
  return Date.now();
}

function readCache(videoId: string): YoutubeTranscriptWindows | null {
  const entry = windowsCache.get(videoId);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt < now()) {
    windowsCache.delete(videoId);
    return null;
  }
  return entry.result;
}

function writeCache(videoId: string, result: YoutubeTranscriptWindows): void {
  while (windowsCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = windowsCache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    windowsCache.delete(oldest);
  }
  windowsCache.set(videoId, {
    result,
    expiresAt: now() + (result.success ? CACHE_TTL_MS : ERROR_CACHE_TTL_MS),
  });
}

/**
 * Fetch (or reuse from cache) the windowed transcript for the YouTube video
 * in the given tab. Concurrent calls for the same video share one fetch.
 */
export async function getYoutubeTranscriptWindows(
  tabId: number,
  url: string,
  windowSeconds: number = TRANSCRIPT_WINDOW_SECONDS,
): Promise<YoutubeTranscriptWindows> {
  const videoId = extractYoutubeVideoId(url);
  if (!videoId) {
    return {
      success: false,
      error: "Not a YouTube video URL.",
      windows: [],
    };
  }

  const cached = readCache(videoId);
  if (cached) {
    return cached;
  }

  const pending = inFlight.get(videoId);
  if (pending) {
    return pending;
  }

  const fetchPromise = (async (): Promise<YoutubeTranscriptWindows> => {
    try {
      const fetched = await fetchYoutubeTranscriptForTab(tabId);
      if (!fetched.success || !fetched.segments) {
        return {
          success: false,
          error: fetched.error,
          videoId: fetched.videoId ?? videoId,
          title: fetched.title,
          windows: [],
        };
      }
      return {
        success: true,
        videoId: fetched.videoId ?? videoId,
        title: fetched.title,
        author: fetched.author,
        durationSeconds: fetched.durationSeconds,
        language: fetched.language,
        isAsr: fetched.isAsr,
        windows: buildTranscriptWindows(fetched.segments, windowSeconds),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        videoId,
        windows: [],
      };
    }
  })();

  inFlight.set(videoId, fetchPromise);
  try {
    const result = await fetchPromise;
    writeCache(videoId, result);
    return result;
  } finally {
    inFlight.delete(videoId);
  }
}

/**
 * Warm the transcript cache for a YouTube tab so the first send doesn't have
 * to wait for the fetch. Fire-and-forget; errors are cached briefly and
 * surface as a silent no-op at send time.
 */
export function prefetchYoutubeTranscript(tabId: number, url: string): void {
  const videoId = extractYoutubeVideoId(url);
  if (!videoId || readCache(videoId) || inFlight.has(videoId)) {
    return;
  }
  void getYoutubeTranscriptWindows(tabId, url).catch(() => {});
}
