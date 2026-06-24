import { afterEach, describe, expect, it, vi } from "vitest";
import { runTwitterSearch, runTwitterUser } from "./twitter";

const tweetPayload = {
  tweets: [
    {
      id: "1",
      text: "gm from the project",
      author: { name: "Proj", screen_name: "proj", followers: 1200 },
      created_at: "2026-06-01",
      likes: 50,
      retweets: 5,
      url: "https://x.com/proj/status/1",
      extraneous: "dropped",
    },
  ],
};

describe("runTwitterSearch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("compacts tweets and reports the called URL", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(tweetPayload), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTwitterSearch("proj token", 5);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.count).toBe(1);
      expect(result.tweets[0]).toEqual({
        id: "1",
        text: "gm from the project",
        author: { name: "Proj", screen_name: "proj", followers: 1200 },
        created_at: "2026-06-01",
        likes: 50,
        retweets: 5,
        views: undefined,
        url: "https://x.com/proj/status/1",
      });
    }
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("/search?");
    expect(calledUrl).toContain("q=proj+token");
    expect(calledUrl).toContain("limit=5");
  });

  it("fails softly when the service is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const result = await runTwitterSearch("x");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("unreachable");
    }
  });

  it("surfaces a service error body on non-200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "bad cookies" }), {
            status: 502,
          }),
      ),
    );
    const result = await runTwitterSearch("x");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("bad cookies");
    }
  });
});

describe("runTwitterUser", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("strips a leading @ and hits the /user route", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ tweets: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await runTwitterUser("@founder", 3);
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("/user?");
    expect(calledUrl).toContain("handle=founder");
    expect(calledUrl).not.toContain("%40");
  });
});
