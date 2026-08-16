import { STORAGE_KEYS } from "@eterna/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureConversationToSupermemory,
  captureToSupermemory,
  fetchSupermemoryProfileCached,
  forgetMatchingInSupermemory,
  renderProfileForPrompt,
  resetSupermemoryProfileCache,
  searchSupermemory,
} from "./supermemory-client";

let store: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = {};
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
      },
    },
  });
  resetSupermemoryProfileCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const configure = () => {
  store[STORAGE_KEYS.SUPERMEMORY] = {
    url: "http://localhost:6767/",
    apiKey: "sm_test",
  };
};

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

describe("supermemory client", () => {
  it("does nothing when not configured", async () => {
    expect(await captureToSupermemory("fact")).toBe(false);
    expect(await searchSupermemory("q")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("captures with bearer auth, container tag and a normalized url", async () => {
    configure();
    fetchMock.mockResolvedValue(jsonResponse({ id: "doc1" }));
    expect(await captureToSupermemory("likes spicy food")).toBe(true);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:6767/v3/documents");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer sm_test",
    });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      content: "likes spicy food",
      containerTag: "eterna",
    });
  });

  it("fails soft on network errors and non-OK responses", async () => {
    configure();
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await captureToSupermemory("fact")).toBe(false);
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    expect(await searchSupermemory("q")).toBeNull();
  });

  it("maps v4 memory results, falling back to chunk content", async () => {
    configure();
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [
          {
            memory: "User prefers dark mode",
            similarity: 0.91,
            updatedAt: "2026-08-01",
          },
          { chunk: "chunk-only result" },
          { memory: "" },
        ],
      }),
    );
    expect(await searchSupermemory("theme")).toEqual([
      {
        memory: "User prefers dark mode",
        similarity: 0.91,
        updatedAt: "2026-08-01",
      },
      {
        memory: "chunk-only result",
        similarity: undefined,
        updatedAt: undefined,
      },
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:6767/v4/search",
    );
  });

  it("captures a conversation exchange with its id and container", async () => {
    configure();
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const ok = await captureConversationToSupermemory("sess-1", [
      { role: "user", content: "soru" },
      { role: "assistant", content: "cevap" },
    ]);
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:6767/v4/conversations");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      conversationId: "sess-1",
      containerTags: ["eterna"],
      messages: [
        { role: "user", content: "soru" },
        { role: "assistant", content: "cevap" },
      ],
    });
  });

  it("sends natural-language forgets to forget-matching", async () => {
    configure();
    fetchMock.mockResolvedValue(jsonResponse({ forgotten: [] }));
    expect(await forgetMatchingInSupermemory("prefers dark mode")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:6767/v4/memories/forget-matching");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      query: "prefers dark mode",
      containerTag: "eterna",
    });
  });

  it("caches the profile (and its absence) within the TTL", async () => {
    configure();
    fetchMock.mockResolvedValue(
      jsonResponse({ profile: { static: ["dev"], dynamic: [] } }),
    );
    expect(await fetchSupermemoryProfileCached(1000)).toEqual({
      static: ["dev"],
      dynamic: [],
    });
    expect(await fetchSupermemoryProfileCached(2000)).toEqual({
      static: ["dev"],
      dynamic: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fetchSupermemoryProfileCached(70_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("renderProfileForPrompt", () => {
  it("is empty for null or empty profiles", () => {
    expect(renderProfileForPrompt(null)).toBe("");
    expect(renderProfileForPrompt({ static: [], dynamic: [] })).toBe("");
  });

  it("renders capped stable and recent sections", () => {
    const block = renderProfileForPrompt({
      static: ["a", "b", "c", "d", "e", "f", "g"],
      dynamic: ["x"],
    });
    expect(block).toContain("=== USER PROFILE");
    expect(block).toContain("- f");
    expect(block).not.toContain("- g");
    expect(block).toContain("Recent:\n- x");
  });
});
