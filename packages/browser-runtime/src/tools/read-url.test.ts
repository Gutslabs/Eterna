import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublicUrl, isPublicHttpUrl, readResponseBytes } from "./read-url";

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

describe("fetchPublicUrl", () => {
  it("rejects redirects into the local network before fetching the target", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPublicUrl("https://example.com/jump")).rejects.toThrow(
      "non-public",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows and re-validates public redirects", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/article" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPublicUrl("https://example.com/start");

    expect(result.finalUrl).toBe("https://example.com/article");
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
