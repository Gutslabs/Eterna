import { tool } from "@aipexstudio/aipex-core";
import { z } from "zod";
import { getActiveTab } from "./tab-utils";

export interface TranscriptSegment {
  start: number;
  duration: number;
  text: string;
}

interface PageCaptionResult {
  success: boolean;
  error?: string;
  videoId?: string;
  title?: string;
  author?: string;
  durationSeconds?: number;
  languageCode?: string;
  isAsr?: boolean;
  source?: "inline" | "innertube";
  xml?: string;
}

interface YoutubeTranscriptResult {
  success: boolean;
  error?: string;
  videoId?: string;
  title?: string;
  author?: string;
  language?: string;
  isAsr?: boolean;
  durationSeconds?: number;
  segmentCount?: number;
  source?: "inline" | "innertube";
  text?: string;
  segments?: { start: number; text: string }[];
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_m, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    );
}

/**
 * Parse YouTube timed-text into segments. Handles both the modern srv3 format
 * (`<p t="ms" d="ms"><s>word</s></p>`) and the legacy format
 * (`<text start="s" dur="s">content</text>`). Pure and side-effect free so it
 * can be unit tested without a browser.
 */
export function parseTranscriptXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  if (!xml) {
    return segments;
  }

  const pRegex = /<p\s+([^>]*?)>([\s\S]*?)<\/p>/g;
  let match: RegExpExecArray | null = pRegex.exec(xml);
  while (match !== null) {
    const attrs = match[1] ?? "";
    const tMatch = attrs.match(/\bt="(\d+)"/);
    if (tMatch?.[1] !== undefined) {
      const dMatch = attrs.match(/\bd="(\d+)"/);
      const startMs = parseInt(tMatch[1], 10);
      const durMs = dMatch?.[1] !== undefined ? parseInt(dMatch[1], 10) : 0;
      const inner = match[2] ?? "";

      let text = "";
      const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
      let sMatch: RegExpExecArray | null = sRegex.exec(inner);
      while (sMatch !== null) {
        text += sMatch[1] ?? "";
        sMatch = sRegex.exec(inner);
      }
      if (!text) {
        text = inner.replace(/<[^>]+>/g, "");
      }
      text = decodeEntities(text.replace(/\n/g, " ").replace(/\s{2,}/g, " "));
      if (text.trim()) {
        segments.push({
          start: startMs / 1000,
          duration: durMs / 1000,
          text: text.trim(),
        });
      }
    }
    match = pRegex.exec(xml);
  }

  if (segments.length === 0) {
    const textRegex = /<text\s+([^>]*?)>([\s\S]*?)<\/text>/g;
    let legacy: RegExpExecArray | null = textRegex.exec(xml);
    while (legacy !== null) {
      const attrs = legacy[1] ?? "";
      const startMatch = attrs.match(/\bstart="([^"]*)"/);
      if (startMatch?.[1] !== undefined) {
        const durMatch = attrs.match(/\bdur="([^"]*)"/);
        const start = parseFloat(startMatch[1]);
        const dur = durMatch?.[1] !== undefined ? parseFloat(durMatch[1]) : 0;
        const raw = (legacy[2] ?? "")
          .replace(/<[^>]+>/g, "")
          .replace(/\n/g, " ")
          .replace(/\s{2,}/g, " ");
        const text = decodeEntities(raw);
        if (text.trim()) {
          segments.push({ start, duration: dur, text: text.trim() });
        }
      }
      legacy = textRegex.exec(xml);
    }
  }

  return segments;
}

function friendlyError(code: string | undefined): string {
  switch (code) {
    case "not_youtube":
      return "The current tab is not a YouTube video page.";
    case "live_stream":
      return "This is a live stream, so a full transcript is not available until it ends.";
    case "no_transcript":
      return "This video has no captions or transcript available.";
    case "empty_transcript":
      return "Captions are listed but YouTube returned an empty transcript.";
    case "no_video_id":
      return "Could not determine the YouTube video ID for the current tab.";
    default:
      return code
        ? `Failed to fetch transcript (${code}).`
        : "Failed to fetch transcript.";
  }
}

/**
 * Runs in the page's MAIN world (youtube.com origin). It resolves the caption
 * track list from the live player, fetches the timed-text with the page's
 * credentials, and falls back to the InnerTube iOS client when the inline
 * baseUrl is stale. Returns raw XML; parsing happens in the extension context.
 */
function fetchCaptionsInPage(
  preferredLang: string | null,
): Promise<PageCaptionResult> {
  const INNERTUBE_URL =
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

  const normalizeTracks = (
    tracks: any[],
  ): { baseUrl: string; languageCode: string; kind: string }[] => {
    if (!Array.isArray(tracks)) {
      return [];
    }
    return tracks
      .map((track: any) => ({
        baseUrl: track?.baseUrl as string,
        languageCode: (track?.languageCode as string) || "",
        kind: (track?.kind as string) || "",
      }))
      .filter((track) => !!track.baseUrl);
  };

  const getPlayerResponse = (): any => {
    try {
      const player: any = document.querySelector("#movie_player");
      if (player && typeof player.getPlayerResponse === "function") {
        const resp = player.getPlayerResponse();
        if (resp) {
          return resp;
        }
      }
    } catch (_e) {
      /* ignore */
    }
    try {
      const initial = (window as any).ytInitialPlayerResponse;
      if (initial) {
        return initial;
      }
    } catch (_e) {
      /* ignore */
    }
    return null;
  };

  const pickTrack = (
    tracks: { languageCode: string; kind: string }[],
    lang: string | null,
  ): number => {
    if (!tracks.length) {
      return -1;
    }
    if (lang) {
      const lower = lang.toLowerCase();
      let i = tracks.findIndex(
        (t) => t.languageCode.toLowerCase() === lower && t.kind !== "asr",
      );
      if (i < 0) {
        i = tracks.findIndex((t) =>
          t.languageCode.toLowerCase().startsWith(lower),
        );
      }
      if (i >= 0) {
        return i;
      }
    }
    const manual = tracks.findIndex((t) => t.kind !== "asr");
    return manual >= 0 ? manual : 0;
  };

  const looksEmpty = (xml: string): boolean => !/<(p|text)\b/i.test(xml || "");

  const fetchXml = (url: string): Promise<string> =>
    fetch(url, { credentials: "include" }).then((r) => r.text());

  const callInnerTube = (
    videoId: string,
    client: { clientName: string; clientVersion: string },
  ): Promise<{ baseUrl: string; languageCode: string; kind: string }[]> =>
    fetch(INNERTUBE_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: { client }, videoId }),
    })
      .then((r) => {
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data: any) => {
        const tracks = normalizeTracks(
          data?.captions?.playerCaptionsTracklistRenderer?.captionTracks,
        );
        if (!tracks.length) {
          throw new Error("no-tracks");
        }
        return tracks;
      });

  const fetchFreshTracks = (
    videoId: string,
  ): Promise<{ baseUrl: string; languageCode: string; kind: string }[]> =>
    callInnerTube(videoId, { clientName: "IOS", clientVersion: "20.10.3" })
      .catch(() =>
        callInnerTube(videoId, {
          clientName: "WEB",
          clientVersion: "2.20240101.00.00",
        }),
      )
      .catch(() =>
        callInnerTube(videoId, {
          clientName: "ANDROID",
          clientVersion: "20.10.38",
        }),
      );

  const host = location.hostname;
  if (!/(^|\.)youtube\.com$/.test(host) && host !== "youtu.be") {
    return Promise.resolve({ success: false, error: "not_youtube" });
  }

  let videoId = "";
  try {
    if (host === "youtu.be") {
      videoId = location.pathname.slice(1).split("/")[0] ?? "";
    } else {
      videoId = new URLSearchParams(location.search).get("v") ?? "";
      if (!videoId) {
        const pathMatch = location.pathname.match(
          /\/(?:shorts|live|embed)\/([^/?#]+)/,
        );
        if (pathMatch?.[1]) {
          videoId = pathMatch[1];
        }
      }
    }
  } catch (_e) {
    /* ignore */
  }

  const playerResponse = getPlayerResponse();
  const meta: {
    title: string;
    author?: string;
    durationSeconds?: number;
  } = { title: document.title.replace(/\s*-\s*YouTube\s*$/, "") };

  const details = playerResponse?.videoDetails;
  if (details) {
    if (details.title) {
      meta.title = details.title;
    }
    if (details.author) {
      meta.author = details.author;
    }
    const len = parseInt(details.lengthSeconds, 10);
    if (Number.isFinite(len) && len > 0) {
      meta.durationSeconds = len;
    }
    if (!videoId && details.videoId) {
      videoId = details.videoId;
    }
    if (details.isLive === true) {
      return Promise.resolve({
        success: false,
        error: "live_stream",
        videoId,
        title: meta.title,
      });
    }
  }

  const inlineTracks = normalizeTracks(
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks,
  );

  const tryInnerTube = (): Promise<PageCaptionResult> => {
    if (!videoId) {
      return Promise.resolve({
        success: false,
        error: "no_video_id",
        title: meta.title,
      });
    }
    return fetchFreshTracks(videoId)
      .then((fresh) => {
        const idx = pickTrack(fresh, preferredLang);
        const track = idx >= 0 ? fresh[idx] : undefined;
        if (!track) {
          return {
            success: false,
            error: "no_transcript",
            videoId,
            title: meta.title,
          } as PageCaptionResult;
        }
        return fetchXml(track.baseUrl).then((xml) => {
          if (looksEmpty(xml)) {
            return {
              success: false,
              error: "empty_transcript",
              videoId,
              title: meta.title,
            } as PageCaptionResult;
          }
          return {
            success: true,
            videoId,
            title: meta.title,
            author: meta.author,
            durationSeconds: meta.durationSeconds,
            languageCode: track.languageCode,
            isAsr: track.kind === "asr",
            source: "innertube",
            xml,
          } as PageCaptionResult;
        });
      })
      .catch(
        () =>
          ({
            success: false,
            error: "no_transcript",
            videoId,
            title: meta.title,
          }) as PageCaptionResult,
      );
  };

  if (inlineTracks.length) {
    const idx = pickTrack(inlineTracks, preferredLang);
    const track = idx >= 0 ? inlineTracks[idx] : undefined;
    if (track) {
      return fetchXml(track.baseUrl)
        .then((xml) => {
          if (!looksEmpty(xml)) {
            return {
              success: true,
              videoId,
              title: meta.title,
              author: meta.author,
              durationSeconds: meta.durationSeconds,
              languageCode: track.languageCode,
              isAsr: track.kind === "asr",
              source: "inline",
              xml,
            } as PageCaptionResult;
          }
          return tryInnerTube();
        })
        .catch(() => tryInnerTube());
    }
  }

  return tryInnerTube();
}

export interface YoutubeTranscriptFetch {
  success: boolean;
  error?: string;
  videoId?: string;
  title?: string;
  author?: string;
  durationSeconds?: number;
  language?: string;
  isAsr?: boolean;
  source?: "inline" | "innertube";
  segments?: TranscriptSegment[];
}

export function isYoutubeVideoUrl(url: string): boolean {
  return /youtube\.com\/(watch|shorts|live|embed)|youtu\.be\//.test(url);
}

/**
 * Fetch and parse the transcript of the YouTube video shown in the given tab.
 * Shared by the agent tool (active tab) and the auto-context transcript feed
 * (any attached tab).
 */
export async function fetchYoutubeTranscriptForTab(
  tabId: number,
  language?: string | null,
): Promise<YoutubeTranscriptFetch> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [language ?? null],
    func: fetchCaptionsInPage,
  });

  const page = results[0]?.result as PageCaptionResult | undefined;
  if (!page) {
    return { success: false, error: "Failed to read the YouTube page." };
  }
  if (!page.success || !page.xml) {
    return {
      success: false,
      error: friendlyError(page.error),
      videoId: page.videoId,
      title: page.title,
    };
  }

  const segments = parseTranscriptXml(page.xml);
  if (!segments.length) {
    return {
      success: false,
      error: friendlyError("empty_transcript"),
      videoId: page.videoId,
      title: page.title,
    };
  }

  return {
    success: true,
    videoId: page.videoId,
    title: page.title,
    author: page.author,
    durationSeconds: page.durationSeconds,
    language: page.languageCode,
    isAsr: page.isAsr,
    source: page.source,
    segments,
  };
}

export const getYoutubeTranscriptTool = tool({
  name: "get_youtube_transcript",
  description:
    "Fetch the full transcript (captions) of the YouTube video in the user's current tab. Use this whenever the user wants to summarize, explain, translate, quote, or ask questions about the YouTube video they are watching. Returns the complete transcript text and video metadata. Only works on a youtube.com/watch, youtu.be, /shorts or /live page.",
  parameters: z.object({
    language: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Optional BCP-47 language code (e.g. 'en', 'tr') to prefer a specific caption track. If omitted, the original/manual track is preferred, then auto-generated captions.",
      ),
    includeTimestamps: z
      .boolean()
      .nullable()
      .optional()
      .describe(
        "When true, also return per-line timestamps (segments). Leave false/omitted for summaries to save tokens; set true when the user asks about specific moments or timestamps.",
      ),
  }),
  execute: async ({
    language,
    includeTimestamps,
  }): Promise<YoutubeTranscriptResult> => {
    const tab = await getActiveTab();
    if (!tab.id) {
      return { success: false, error: "No active tab found." };
    }

    const url = tab.url ?? "";
    if (!isYoutubeVideoUrl(url)) {
      return { success: false, error: friendlyError("not_youtube") };
    }

    const fetched = await fetchYoutubeTranscriptForTab(tab.id, language);
    if (!fetched.success || !fetched.segments) {
      return {
        success: false,
        error: fetched.error,
        videoId: fetched.videoId,
        title: fetched.title,
      };
    }

    const segments = fetched.segments;
    const text = segments.map((segment) => segment.text).join(" ");
    const result: YoutubeTranscriptResult = {
      success: true,
      videoId: fetched.videoId,
      title: fetched.title,
      author: fetched.author,
      language: fetched.language,
      isAsr: fetched.isAsr,
      durationSeconds: fetched.durationSeconds,
      segmentCount: segments.length,
      source: fetched.source,
      text,
    };

    if (includeTimestamps) {
      result.segments = segments.map((segment) => ({
        start: Math.round(segment.start * 10) / 10,
        text: segment.text,
      }));
    }

    return result;
  },
});
