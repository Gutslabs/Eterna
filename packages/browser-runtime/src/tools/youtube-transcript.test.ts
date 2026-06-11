import { describe, expect, it } from "vitest";
import { parseTranscriptXml } from "./youtube-transcript";

describe("parseTranscriptXml", () => {
  it("parses srv3 format with <p>/<s> word spans", () => {
    const xml = `<?xml version="1.0"?><timedtext><body>
      <p t="0" d="1500"><s>Hello</s><s> world</s></p>
      <p t="1500" d="2000"><s>second</s><s> line</s></p>
    </body></timedtext>`;

    const segments = parseTranscriptXml(xml);

    expect(segments).toEqual([
      { start: 0, duration: 1.5, text: "Hello world" },
      { start: 1.5, duration: 2, text: "second line" },
    ]);
  });

  it("falls back to <p> inner text when there are no <s> spans", () => {
    const xml = `<p t="3000" d="1000">plain caption</p>`;

    const segments = parseTranscriptXml(xml);

    expect(segments).toEqual([
      { start: 3, duration: 1, text: "plain caption" },
    ]);
  });

  it("parses the legacy <text start dur> format", () => {
    const xml = `<?xml version="1.0"?><transcript>
      <text start="0.5" dur="2.3">first legacy line</text>
      <text start="2.8" dur="1.2">second legacy line</text>
    </transcript>`;

    const segments = parseTranscriptXml(xml);

    expect(segments).toEqual([
      { start: 0.5, duration: 2.3, text: "first legacy line" },
      { start: 2.8, duration: 1.2, text: "second legacy line" },
    ]);
  });

  it("decodes HTML entities including numeric references", () => {
    const xml = `<text start="0" dur="1">Tom &amp; Jerry &#39;run&#39; &#x1F600;</text>`;

    const segments = parseTranscriptXml(xml);

    expect(segments[0]?.text).toBe("Tom & Jerry 'run' 😀");
  });

  it("collapses whitespace and trims each line", () => {
    const xml = `<text start="0" dur="1">  spaced   out\n  text  </text>`;

    const segments = parseTranscriptXml(xml);

    expect(segments[0]?.text).toBe("spaced out text");
  });

  it("skips segments without a timestamp and drops empty text", () => {
    const xml = `
      <p d="1000"><s>no timestamp</s></p>
      <p t="2000" d="500"><s>   </s></p>
      <p t="3000" d="500"><s>kept</s></p>
    `;

    const segments = parseTranscriptXml(xml);

    expect(segments).toEqual([{ start: 3, duration: 0.5, text: "kept" }]);
  });

  it("returns an empty array for empty or unparseable input", () => {
    expect(parseTranscriptXml("")).toEqual([]);
    expect(parseTranscriptXml("<html><body>no captions</body></html>")).toEqual(
      [],
    );
  });

  it("prefers srv3 over legacy when both are present", () => {
    const xml = `
      <p t="0" d="1000"><s>modern</s></p>
      <text start="5" dur="1">legacy ignored</text>
    `;

    const segments = parseTranscriptXml(xml);

    expect(segments).toEqual([{ start: 0, duration: 1, text: "modern" }]);
  });
});
