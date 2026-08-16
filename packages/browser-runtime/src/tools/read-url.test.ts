import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchPublicUrl,
  isPublicHttpUrl,
  readResponseBytes,
  readXStatus,
} from "./read-url";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isPublicHttpUrl", () => {
  it("allows public http(s) URLs", () => {
    expect(isPublicHttpUrl("https://example.com/post")).toBe(true);
    expect(isPublicHttpUrl("http://news.ycombinator.com/item?id=1")).toBe(true);
    expect(isPublicHttpUrl("https://x.com/user/status/123")).toBe(true);
    expect(isPublicHttpUrl("https://8.8.8.8/")).toBe(true);
  });

  it("rejects non-http(s) protocols", () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/x",
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      "chrome://settings",
    ]) {
      expect(isPublicHttpUrl(url)).toBe(false);
    }
  });

  it("rejects loopback and unspecified hosts", () => {
    for (const url of [
      "http://localhost/",
      "http://localhost:8317/v1/models",
      "http://app.localhost/",
      "http://127.0.0.1/",
      "http://127.5.5.5/",
      "http://[::1]/",
      "http://[::]/",
      "http://[::ffff:127.0.0.1]/",
      "http://0.0.0.0/",
    ]) {
      expect(isPublicHttpUrl(url)).toBe(false);
    }
  });

  it("rejects private and link-local ranges (SSRF)", () => {
    for (const url of [
      "http://10.0.0.1/",
      "http://192.168.1.1/admin",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[fe80::1]/",
      "http://[fd00::1]/",
    ]) {
      expect(isPublicHttpUrl(url)).toBe(false);
    }
  });

  it("allows 172.x hosts outside the private 16–31 block", () => {
    expect(isPublicHttpUrl("http://172.15.0.1/")).toBe(true);
    expect(isPublicHttpUrl("http://172.32.0.1/")).toBe(true);
  });

  it("rejects the cloud metadata hostname", () => {
    expect(isPublicHttpUrl("http://metadata.google.internal/")).toBe(false);
  });

  it("rejects malformed input", () => {
    for (const url of ["not a url", "", "://nope", "http://"]) {
      expect(isPublicHttpUrl(url)).toBe(false);
    }
  });
});

function responseAt(url: string, body: string | null, status = 200): Response {
  const response = new Response(body, { status });
  // Response.url is read-only and empty when constructed by hand; the browser
  // sets it to the post-redirect destination on real fetches.
  Object.defineProperty(response, "url", { value: url });
  return response;
}

describe("fetchPublicUrl", () => {
  it("follows redirects — the browser's redirect chain sets the final url", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(responseAt("https://example.com/article", "ok"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPublicUrl("https://example.com/start");

    expect(result.finalUrl).toBe("https://example.com/article");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/start",
      expect.objectContaining({ redirect: "follow" }),
    );
  });

  it("rejects a chain that lands on the local network, without exposing the body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(responseAt("http://127.0.0.1/admin", "secret"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPublicUrl("https://example.com/jump")).rejects.toThrow(
      "non-public",
    );
  });

  it("keeps the requested url when the response does not carry one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("ok", { status: 200 })),
    );

    const result = await fetchPublicUrl("https://example.com/plain");
    expect(result.finalUrl).toBe("https://example.com/plain");
  });
});

describe("readXStatus", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads a tweet through FxTwitter and formats it as markdown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          tweet: {
            text: "just setting up my twttr",
            created_at: "Tue Mar 21 20:50:14 +0000 2006",
            likes: 3,
            retweets: 2,
            replies: 1,
            author: { name: "jack", screen_name: "jack" },
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await readXStatus("https://x.com/jack/status/20");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.fxtwitter.com/jack/status/20",
      expect.anything(),
    );
    expect(result).toMatchObject({
      success: true,
      title: "jack (@jack) on X",
      site: "X (Twitter)",
    });
    expect(result?.content).toContain("just setting up my twttr");
    expect(result?.content).toContain("3 likes");
  });

  it("handles twitter.com and mobile hosts too", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ tweet: { text: "hi", author: { name: "a" } } }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await readXStatus("https://mobile.twitter.com/a/status/99");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.fxtwitter.com/a/status/99",
      expect.anything(),
    );
  });

  it("returns null for non-status urls without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await readXStatus("https://x.com/jack")).toBeNull();
    expect(await readXStatus("https://example.com/status/1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back (null) when the API errors, so the generic fetch can try", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 404 })),
    );
    expect(await readXStatus("https://x.com/gone/status/1")).toBeNull();
  });
});

describe("readResponseBytes", () => {
  it("rejects a response whose declared body exceeds the byte budget", async () => {
    const response = new Response("small", {
      headers: { "content-length": "1000" },
    });

    await expect(readResponseBytes(response, 100)).rejects.toThrow("too large");
  });
});
