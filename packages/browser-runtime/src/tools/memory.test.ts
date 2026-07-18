import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addMemory,
  loadMemories,
  removeMemory,
  renderMemoriesForPrompt,
} from "./memory";

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
