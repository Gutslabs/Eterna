import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildQueuedTranscriptPrompt,
  buildTranscriptChunkContext,
  cancelYoutubeTranscriptQueue,
  findYoutubeContextTargets,
  getYoutubeTranscriptQueueProgress,
  runPreparedYoutubeTranscriptQueue,
  YOUTUBE_TRANSCRIPT_CONTEXT_KIND,
} from "./youtube-transcript-feed";

const VIDEO_URL = "https://www.youtube.com/watch?v=abc123";

function pageContext(url: string, tabId?: number, id = "eterna-current-page") {
  return {
    id,
    type: "page" as const,
    label: "Some page",
    value: `URL: ${url}`,
    metadata: { url, tabId },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => cancelYoutubeTranscriptQueue());

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

    expect(item.value).toContain("The next part is already queued");
    expect(item.value).not.toContain("Earlier parts were attached");
  });
});

describe("buildQueuedTranscriptPrompt", () => {
  it("shows the queued range and keeps the original request visible", () => {
    const text = buildQueuedTranscriptPrompt(
      "Bu videoyu detaylı özetle",
      { part: 2, startSec: 600, endSec: 1200, text: "..." },
      12,
    );

    expect(text).toContain("[Queued YouTube segment 2/12 · 10:00–20:00]");
    expect(text).toContain("Original request: Bu videoyu detaylı özetle");
  });
});

describe("runPreparedYoutubeTranscriptQueue", () => {
  const transcript = {
    success: true,
    videoId: "abc123",
    title: "Long Video",
    durationSeconds: 1500,
    windows: [
      { part: 1, startSec: 0, endSec: 600, text: "first" },
      { part: 2, startSec: 600, endSec: 1200, text: "second" },
      { part: 3, startSec: 1200, endSec: 1500, text: "third" },
    ],
  };
  const plan = {
    queueId: "queue-1",
    target: { tabId: 42, url: VIDEO_URL, videoId: "abc123" },
    transcript,
    initialContexts: [pageContext(VIDEO_URL, 42)],
  };

  it("waits for each AI response before sending the next window", async () => {
    const gates = [deferred(), deferred(), deferred()];
    const send = vi.fn(
      async (_text: string, _files?: unknown[], _contexts?: unknown[]) => {
        const gate = gates[send.mock.calls.length - 1];
        await gate?.promise;
      },
    );

    const run = runPreparedYoutubeTranscriptQueue(plan, {
      text: "Videoyu özetle",
      send,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBe("Videoyu özetle");
    expect(send.mock.calls[0]?.[2]).toHaveLength(2);
    expect(getYoutubeTranscriptQueueProgress()).toMatchObject({
      currentPart: 1,
      totalParts: 3,
      currentRange: "0:00–10:00",
      queuedParts: 3,
    });

    gates[0]?.resolve();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]?.[0]).toContain(
      "[Queued YouTube segment 2/3 · 10:00–20:00]",
    );
    expect(send.mock.calls[1]?.[2]).toHaveLength(1);
    expect(getYoutubeTranscriptQueueProgress()).toMatchObject({
      currentPart: 2,
      queuedParts: 2,
    });

    gates[1]?.resolve();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(send.mock.calls[2]?.[0]).toContain(
      "[Queued YouTube segment 3/3 · 20:00–25:00]",
    );

    gates[2]?.resolve();
    await run;
    expect(getYoutubeTranscriptQueueProgress()).toBeNull();
  });

  it("does not send remaining windows after cancellation", async () => {
    const firstResponse = deferred();
    const send = vi.fn(async () => firstResponse.promise);
    const run = runPreparedYoutubeTranscriptQueue(plan, {
      text: "Videoyu özetle",
      send,
    });

    expect(send).toHaveBeenCalledTimes(1);
    cancelYoutubeTranscriptQueue();
    firstResponse.resolve();
    await run;

    expect(send).toHaveBeenCalledTimes(1);
    expect(getYoutubeTranscriptQueueProgress()).toBeNull();
  });
});
