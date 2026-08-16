import { afterEach, describe, expect, it, vi } from "vitest";
import { ChromeStorageAdapter } from "./storage-adapter.js";

describe("ChromeStorageAdapter.update", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serializes concurrent patches for the same key", async () => {
    vi.stubGlobal("navigator", {});
    const adapter = new ChromeStorageAdapter<Record<string, number>>();
    let stored: Record<string, number> = { first: 0, second: 0 };
    vi.spyOn(adapter, "load").mockImplementation(async () => {
      await Promise.resolve();
      return { ...stored };
    });
    vi.spyOn(adapter, "save").mockImplementation(async (_key, next) => {
      await Promise.resolve();
      stored = next;
    });

    await Promise.all([
      adapter.update("settings", (current) => ({
        ...(current ?? {}),
        first: 1,
      })),
      adapter.update("settings", (current) => ({
        ...(current ?? {}),
        second: 2,
      })),
    ]);

    expect(stored).toEqual({ first: 1, second: 2 });
  });
});
