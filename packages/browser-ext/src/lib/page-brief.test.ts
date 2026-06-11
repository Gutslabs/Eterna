import { describe, expect, it } from "vitest";
import { buildPageBrief, cleanPageTitle, countWords } from "./page-brief";

const LONG_TEXT = "kelime ".repeat(900);

describe("buildPageBrief", () => {
  it("classifies YouTube watch/shorts/youtu.be as video", () => {
    expect(buildPageBrief("https://www.youtube.com/watch?v=abc", "").kind).toBe(
      "video",
    );
    expect(buildPageBrief("https://youtube.com/shorts/x1", "").kind).toBe(
      "video",
    );
    expect(buildPageBrief("https://youtu.be/abc", "").kind).toBe("video");
    expect(
      buildPageBrief("https://www.youtube.com/feed/library", "").kind,
    ).toBe("page");
  });

  it("splits X into feed and post", () => {
    expect(buildPageBrief("https://x.com/home", "").kind).toBe("x-feed");
    expect(buildPageBrief("https://x.com/patio11/status/123456", "").kind).toBe(
      "x-post",
    );
    expect(buildPageBrief("https://twitter.com/explore", "").kind).toBe(
      "x-feed",
    );
  });

  it("detects github and long-text articles", () => {
    expect(buildPageBrief("https://github.com/foo/bar", "").kind).toBe(
      "github",
    );
    expect(
      buildPageBrief("https://blog.example.com/post", LONG_TEXT).kind,
    ).toBe("article");
    expect(buildPageBrief("https://blog.example.com/post", "kısa").kind).toBe(
      "page",
    );
  });

  it("computes word count and reading minutes", () => {
    const brief = buildPageBrief("https://blog.example.com/post", LONG_TEXT);
    expect(brief.wordCount).toBe(900);
    expect(brief.readingMinutes).toBe(5);
    expect(buildPageBrief("https://a.com", "").readingMinutes).toBe(1);
  });

  it("always returns three suggestions and survives invalid urls", () => {
    expect(buildPageBrief("not a url", "").suggestions).toHaveLength(3);
    expect(buildPageBrief("https://x.com/home", "").suggestions).toHaveLength(
      3,
    );
  });
});

describe("countWords", () => {
  it("counts whitespace-separated words", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  bir   iki\nüç  ")).toBe(3);
  });
});

describe("cleanPageTitle", () => {
  it("strips site suffixes", () => {
    expect(cleanPageTitle("Home / X", "https://x.com/home")).toBe("Home");
    expect(
      cleanPageTitle("Cool Video - YouTube", "https://youtube.com/watch?v=1"),
    ).toBe("Cool Video");
  });

  it("falls back to the hostname", () => {
    expect(cleanPageTitle(undefined, "https://www.example.com/x")).toBe(
      "example.com",
    );
    expect(cleanPageTitle("   ", "https://example.com")).toBe("example.com");
  });
});
