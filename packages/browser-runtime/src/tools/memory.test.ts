import { STORAGE_KEYS } from "@eterna/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addMemory,
  importLocalMemoriesOnce,
  loadMemories,
  recallTool,
  removeMemory,
  renderMemoriesForPrompt,
} from "./memory";

type Invocable = { invoke: (ctx: unknown, input: string) => Promise<unknown> };

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (obj: Record<string, unknown>) => {
          Object.assign(store, obj);
        },
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("memory store", () => {
  it("starts empty", async () => {
    expect(await loadMemories()).toEqual([]);
  });

  it("adds a memory and returns its id", async () => {
    const { saved, id } = await addMemory("I'm a Solidity dev");
    expect(saved).toBe(true);
    expect(id).toBeTruthy();
    const all = await loadMemories();
    expect(all).toHaveLength(1);
    expect(all[0]?.text).toBe("I'm a Solidity dev");
  });

  it("dedupes case-insensitively without adding a second entry", async () => {
    const first = await addMemory("Always answer in Turkish");
    const dup = await addMemory("  always answer in TURKISH ");
    expect(dup.saved).toBe(false);
    expect(dup.id).toBe(first.id);
    expect(await loadMemories()).toHaveLength(1);
  });

  it("ignores empty content", async () => {
    const res = await addMemory("   ");
    expect(res.saved).toBe(false);
    expect(res.id).toBeUndefined();
    expect(await loadMemories()).toHaveLength(0);
  });

  it("removes a memory by id", async () => {
    const { id } = await addMemory("My main repo is eterna");
    expect(await removeMemory(id as string)).toBe(true);
    expect(await loadMemories()).toHaveLength(0);
  });

  it("returns false when forgetting a missing id", async () => {
    await addMemory("keep me");
    expect(await removeMemory("mem-nope")).toBe(false);
    expect(await loadMemories()).toHaveLength(1);
  });
});

describe("supermemory dual-write", () => {
  it("mirrors a saved fact to the configured local server, soft-failing", async () => {
    store[STORAGE_KEYS.SUPERMEMORY] = {
      url: "http://localhost:6767",
      apiKey: "sm_test",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { saved } = await addMemory("uses pnpm");
    expect(saved).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:6767/v3/documents",
      expect.anything(),
    );

    fetchMock.mockRejectedValue(new Error("down"));
    const second = await addMemory("prefers dark mode");
    expect(second.saved).toBe(true);
  });
});

describe("forget parity", () => {
  it("asks the server to forget the removed fact's text", async () => {
    store[STORAGE_KEYS.SUPERMEMORY] = {
      url: "http://localhost:6767",
      apiKey: "sm_test",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { id } = await addMemory("prefers dark mode");
    fetchMock.mockClear();
    expect(await removeMemory(id as string)).toBe(true);
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/v4/memories/forget-matching"),
    );
    expect(call).toBeTruthy();
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toMatchObject(
      { query: "prefers dark mode" },
    );
  });
});

describe("importLocalMemoriesOnce", () => {
  it("pushes existing facts once and sets the flag", async () => {
    await addMemory("fact one");
    store[STORAGE_KEYS.SUPERMEMORY] = {
      url: "http://localhost:6767",
      apiKey: "sm_test",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await importLocalMemoriesOnce();
    const documentCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/v3/documents"),
    );
    expect(documentCalls).toHaveLength(1);
    expect(store[STORAGE_KEYS.SUPERMEMORY_IMPORTED]).toBe(true);

    await importLocalMemoriesOnce();
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("/v3/documents"),
      ),
    ).toHaveLength(1);
  });

  it("does not set the flag when the push fails", async () => {
    await addMemory("fact one");
    store[STORAGE_KEYS.SUPERMEMORY] = {
      url: "http://localhost:6767",
      apiKey: "sm_test",
    };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await importLocalMemoriesOnce();
    expect(store[STORAGE_KEYS.SUPERMEMORY_IMPORTED]).toBeUndefined();
  });
});

describe("recall tool", () => {
  it("falls back to substring search over local memories when unconfigured", async () => {
    await addMemory("Main repo is eterna");
    await addMemory("Prefers Turkish answers");
    const result = (await (recallTool as unknown as Invocable).invoke(
      {},
      JSON.stringify({ query: "repo" }),
    )) as { results: Array<{ memory: string }>; source: string };
    expect(result.source).toBe("local");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.memory).toBe("Main repo is eterna");
  });
});

describe("renderMemoriesForPrompt", () => {
  it("is empty when there are no memories", () => {
    expect(renderMemoriesForPrompt([])).toBe("");
  });

  it("renders each memory with its id under a MEMORY heading", () => {
    const block = renderMemoriesForPrompt([
      { id: "mem-1", text: "Likes concise answers", createdAt: 0 },
      { id: "mem-2", text: "Works in TypeScript", createdAt: 0 },
    ]);
    expect(block).toContain("=== MEMORY");
    expect(block).toContain("- (mem-1) Likes concise answers");
    expect(block).toContain("- (mem-2) Works in TypeScript");
  });
});
