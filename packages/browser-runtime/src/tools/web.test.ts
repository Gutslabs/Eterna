import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  htmlToText,
  parseDuckDuckGoHtml,
  runWebFetch,
  runWebSearch,
} from "./web";

describe("parseDuckDuckGoHtml", () => {
  const sample = `
    <div class="result">
      <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fone&rut=x">First <b>result</b></a>
      <a class="result__snippet">Snippet about the first thing.</a>
    </div>
    <div class="result">
      <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Ftwo">Second result</a>
      <a class="result__snippet">Snippet two.</a>
    </div>`;

  it("extracts titles, decoded urls and snippets", () => {
    const results = parseDuckDuckGoHtml(sample, 10);
    expect(results).toEqual([
      {
        title: "First result",
        url: "https://example.com/one",
        snippet: "Snippet about the first thing.",
      },
      {
        title: "Second result",
        url: "https://example.com/two",
        snippet: "Snippet two.",
      },
    ]);
  });

  it("respects the limit", () => {
    expect(parseDuckDuckGoHtml(sample, 1)).toHaveLength(1);
  });
});

describe("htmlToText", () => {
  it("drops scripts/styles and strips tags", () => {
    const html = `<html><head><style>.a{color:red}</style><script>evil()</script></head>
      <body><h1>Title</h1><p>Hello&nbsp;world &amp; friends</p></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain("Title");
    expect(text).toContain("Hello world & friends");
    expect(text).not.toContain("evil");
    expect(text).not.toContain("color:red");
  });
});

describe("webSearchTool", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `<a class="result__a" href="/l/?uddg=https%3A%2F%2Fproj.xyz">Proj</a>
           <a class="result__snippet">A project.</a>`,
            { status: 200 },
          ),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns parsed results on success", async () => {
    const result = await runWebSearch("proj token");
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect((result.results as unknown[])[0]).toMatchObject({
      url: "https://proj.xyz",
      title: "Proj",
    });
  });

  it("returns a soft failure on non-200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );
    const result = await runWebSearch("x");
    expect(result.success).toBe(false);
    expect(result.error).toContain("503");
  });
});

describe("webFetchTool", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns readable text and title for an HTML page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            "<html><head><title>Doc</title></head><body><p>Body text</p></body></html>",
            {
              status: 200,
              headers: { "content-type": "text/html" },
            },
          ),
      ),
    );
    const result = await runWebFetch("https://example.com");
    expect(result.success).toBe(true);
    expect(result.title).toBe("Doc");
    expect(result.text).toContain("Body text");
  });

  it("returns JSON bodies verbatim", async () => {
    const payload = JSON.stringify({ price: 1.23 });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(payload, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const result = await runWebFetch("https://api.example.com/price");
    expect(result.text).toBe(payload);
  });

  it("truncates long content and flags it", async () => {
    const long = "x".repeat(5000);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(long, {
            status: 200,
            headers: { "content-type": "text/plain" },
          }),
      ),
    );
    const result = await runWebFetch("https://example.com", 1000);
    expect((result.text as string).length).toBe(1000);
    expect(result.truncated).toBe(true);
  });

  it("returns a soft failure on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const result = await runWebFetch("https://example.com");
    expect(result.success).toBe(false);
    expect(result.error).toContain("network down");
  });
});
