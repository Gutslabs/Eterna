import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "./youtube-transcript";
import {
  buildTranscriptWindows,
  extractYoutubeVideoId,
  formatTimecode,
} from "./youtube-transcript-chunks";

function seg(start: number, text: string, duration = 4): TranscriptSegment {
  return { start, duration, text };
}

describe("extractYoutubeVideoId", () => {
  it("extracts from watch, shorts, live and youtu.be URLs", () => {
    expect(
      extractYoutubeVideoId("https://www.youtube.com/watch?v=abc123&t=5s"),
    ).toBe("abc123");
    expect(extractYoutubeVideoId("https://youtube.com/shorts/sh0rt1d")).toBe(
      "sh0rt1d",
    );
    expect(extractYoutubeVideoId("https://www.youtube.com/live/l1veId")).toBe(
      "l1veId",
    );
    expect(extractYoutubeVideoId("https://youtu.be/short1?t=10")).toBe(
      "short1",
    );
    expect(extractYoutubeVideoId("https://m.youtube.com/watch?v=mob1le")).toBe(
      "mob1le",
    );
  });

  it("returns null for non-video and invalid URLs", () => {
    expect(extractYoutubeVideoId("https://www.youtube.com/feed/library")).toBe(
      null,
    );
    expect(extractYoutubeVideoId("https://example.com/watch?v=abc")).toBe(null);
    expect(extractYoutubeVideoId("not a url")).toBe(null);
  });
});

describe("formatTimecode", () => {
  it("formats minutes and hours", () => {
    expect(formatTimecode(0)).toBe("0:00");
    expect(formatTimecode(65)).toBe("1:05");
    expect(formatTimecode(600)).toBe("10:00");
    expect(formatTimecode(3661)).toBe("1:01:01");
  });
});

describe("buildTranscriptWindows", () => {
  it("splits segments into 10-minute windows by start time", () => {
    const segments = [
      seg(10, "first window a"),
      seg(300, "first window b"),
      seg(610, "second window a"),
      seg(1150, "second window b"),
      seg(1210, "third window"),
    ];

    const windows = buildTranscriptWindows(segments, 600);

    expect(windows).toHaveLength(3);
    expect(windows.map((w) => w.part)).toEqual([1, 2, 3]);
    expect(windows[0]).toMatchObject({ startSec: 0, endSec: 600 });
    expect(windows[1]).toMatchObject({ startSec: 600, endSec: 1200 });
    expect(windows[0]?.text).toContain("first window a");
    expect(windows[0]?.text).toContain("first window b");
    expect(windows[1]?.text).toContain("second window a");
    expect(windows[2]?.text).toContain("third window");
  });

  it("skips silent windows while keeping real time ranges", () => {
    const segments = [seg(30, "intro"), seg(1900, "after long music break")];

    const windows = buildTranscriptWindows(segments, 600);

    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({ part: 1, startSec: 0, endSec: 600 });
    expect(windows[1]).toMatchObject({ part: 2, startSec: 1800 });
  });

  it("emits a timestamp marker at most once per minute", () => {
    const segments = [
      seg(0, "zero"),
      seg(20, "twenty"),
      seg(45, "forty-five"),
      seg(70, "seventy"),
      seg(140, "one-forty"),
    ];

    const windows = buildTranscriptWindows(segments, 600);
    const text = windows[0]?.text ?? "";

    expect(text.match(/\[\d+:\d{2}\]/g)).toEqual([
      "[0:00]",
      "[1:10]",
      "[2:20]",
    ]);
    expect(text).toContain("zero twenty forty-five");
  });

  it("clamps the last window end to the actual end of speech", () => {
    const segments = [seg(610, "only line", 5)];

    const windows = buildTranscriptWindows(segments, 600);

    expect(windows[0]?.startSec).toBe(600);
    expect(windows[0]?.endSec).toBe(615);
  });

  it("returns empty for no segments or invalid window size", () => {
    expect(buildTranscriptWindows([], 600)).toEqual([]);
    expect(buildTranscriptWindows([seg(0, "x")], 0)).toEqual([]);
  });

  it("truncates oversized window text", () => {
    const long = "word ".repeat(5000);
    const windows = buildTranscriptWindows([seg(0, long)], 600);

    expect(windows[0]?.text.length).toBeLessThanOrEqual(16100);
    expect(windows[0]?.text).toContain("(window truncated)");
  });
});
