import type { UIMessage } from "@aipexstudio/aipex-react/types";
import { describe, expect, it } from "vitest";
import {
  buildTranscriptChunkContext,
  findYoutubeContextTargets,
  nextTranscriptPart,
  YOUTUBE_TRANSCRIPT_CONTEXT_KIND,
} from "./youtube-transcript-feed";

const VIDEO_URL = "https://www.youtube.com/watch?v=abc123";

function pageContext(url: string, tabId?: number, id = "aipex-current-page") {
  return {
    id,
    type: "page" as const,
    label: "Some page",
    value: `URL: ${url}`,
    metadata: { url, tabId },
  };
}

function chunkMessage(videoId: string, part: number): UIMessage {
  return {
    id: `m-${part}`,
    role: "user",
    parts: [
      {
        type: "context",
        contextType: "custom",
        label: `part ${part}`,
        value: "...",
        metadata: { kind: YOUTUBE_TRANSCRIPT_CONTEXT_KIND, videoId, part },
      },
      { type: "text", text: "soru" },
    ],
  };
}

describe("findYoutubeContextTargets", () => {
  it("finds YouTube videos among attached contexts", () => {
    const targets = findYoutubeContextTargets([
      pageContext("https://example.com"),
      pageContext(VIDEO_URL, 42),
    ]);

    expect(targets).toEqual([{ tabId: 42, url: VIDEO_URL, videoId: "abc123" }]);
  });

  it("prefers the current-page chip regardless of composer order", () => {
    const otherVideo = pageContext(
      "https://www.youtube.com/watch?v=tabVid",
      7,
      "tab-7",
    );
    const targets = findYoutubeContextTargets([
      otherVideo,
      pageContext(VIDEO_URL, 42),
    ]);

    expect(targets.map((t) => t.videoId)).toEqual(["abc123", "tabVid"]);
  });

  it("dedupes by video id", () => {
    const targets = findYoutubeContextTargets([
      pageContext(VIDEO_URL, 42),
      pageContext(VIDEO_URL, 42, "tab-dup"),
    ]);

    expect(targets).toHaveLength(1);
  });

  it("returns empty without contexts or without a YouTube video", () => {
    expect(findYoutubeContextTargets(undefined)).toEqual([]);
    expect(findYoutubeContextTargets([])).toEqual([]);
    expect(
      findYoutubeContextTargets([pageContext("https://example.com", 1)]),
    ).toEqual([]);
    expect(
      findYoutubeContextTargets([
        pageContext("https://www.youtube.com/feed/library", 1),
      ]),
    ).toEqual([]);
  });

  it("ignores previously injected transcript chunks", () => {
    const chunk = {
      id: "youtube-transcript-abc123-1",
      type: "custom" as const,
      label: "YouTube transcript",
      value: "...",
      metadata: {
        kind: YOUTUBE_TRANSCRIPT_CONTEXT_KIND,
        url: VIDEO_URL,
        videoId: "abc123",
      },
    };

    expect(findYoutubeContextTargets([chunk])).toEqual([]);
  });
});

describe("nextTranscriptPart", () => {
  it("starts at part 1 for a fresh conversation", () => {
    expect(nextTranscriptPart([], "abc123")).toBe(1);
  });

  it("continues after the highest part already sent for this video", () => {
    const messages = [
      chunkMessage("abc123", 1),
      chunkMessage("abc123", 2),
      chunkMessage("otherVideo", 5),
    ];

    expect(nextTranscriptPart(messages, "abc123")).toBe(3);
    expect(nextTranscriptPart(messages, "otherVideo")).toBe(6);
    expect(nextTranscriptPart(messages, "freshVideo")).toBe(1);
  });
});

describe("buildTranscriptChunkContext", () => {
  const transcript = {
    success: true,
    videoId: "abc123",
    title: "Test Video",
    durationSeconds: 3600,
    windows: [
      { part: 1, startSec: 0, endSec: 600, text: "[0:00] first" },
      { part: 2, startSec: 600, endSec: 1200, text: "[10:01] second" },
    ],
  };

  it("labels the chunk with its time range and progress", () => {
    const item = buildTranscriptChunkContext(
      transcript,
      transcript.windows[1]!,
      VIDEO_URL,
    );

    expect(item.label).toBe("YouTube transcript 10:00–20:00 · 2/2");
    expect(item.metadata).toMatchObject({
      kind: YOUTUBE_TRANSCRIPT_CONTEXT_KIND,
      videoId: "abc123",
      part: 2,
      totalParts: 2,
      startSec: 600,
      endSec: 1200,
    });
    expect(item.value).toContain("part 2/2, covering 10:00–20:00");
    expect(item.value).toContain("Earlier parts were attached");
    expect(item.value).toContain("final part");
    expect(item.value).toContain("[10:01] second");
  });

  it("announces the upcoming part on non-final chunks", () => {
    const item = buildTranscriptChunkContext(
      transcript,
      transcript.windows[0]!,
      VIDEO_URL,
    );

    expect(item.value).toContain(
      "The next part will be attached automatically",
    );
    expect(item.value).not.toContain("Earlier parts were attached");
  });
});
