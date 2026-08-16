import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrateLegacyStorageKeys } from "./storage-key-migration";

let store: Record<string, unknown> = {};

beforeEach(() => {
  store = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async () => ({ ...store })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
      },
    },
  });
});

describe("legacy storage key migration", () => {
  it("carries prefixed keys onto the new names", async () => {
    store = {
      aipex_settings: { aiToken: "sk-secret" },
      aipex_memory: ["a fact"],
    };

    const moved = await migrateLegacyStorageKeys();

    expect(moved).toBe(2);
    expect(store.eterna_settings).toEqual({ aiToken: "sk-secret" });
    expect(store.eterna_memory).toEqual(["a fact"]);
  });

  it("keeps the legacy copy so a downgrade still works", async () => {
    store = { aipex_theme: "dark" };
    await migrateLegacyStorageKeys();
    expect(store.aipex_theme).toBe("dark");
  });

  it("migrates the dash-style keys that predate the prefix", async () => {
    store = { "aipex-saved-prompts": ["p"], "aipex-input-mode": "voice" };

    await migrateLegacyStorageKeys();

    expect(store["eterna-saved-prompts"]).toEqual(["p"]);
    expect(store["eterna-input-mode"]).toBe("voice");
  });

  it("never overwrites data already living under the new name", async () => {
    store = {
      aipex_settings: { aiToken: "old" },
      eterna_settings: { aiToken: "new" },
    };

    const moved = await migrateLegacyStorageKeys();

    expect(moved).toBe(0);
    expect(store.eterna_settings).toEqual({ aiToken: "new" });
  });

  it("leaves unrelated keys alone", async () => {
    store = { "ws-mcp-url": "ws://localhost:9223" };
    const moved = await migrateLegacyStorageKeys();
    expect(moved).toBe(0);
    expect(store["ws-mcp-url"]).toBe("ws://localhost:9223");
    // Only the done marker may be added alongside.
    expect(Object.keys(store).filter((key) => key !== "ws-mcp-url")).toEqual([
      "eterna_storage_key_migration_done",
    ]);
  });

  it("skips the full-store scan once the done marker is set", async () => {
    store = { aipex_theme: "dark" };
    await migrateLegacyStorageKeys();
    expect(store.eterna_theme).toBe("dark");

    const get = (
      chrome.storage.local as unknown as { get: ReturnType<typeof vi.fn> }
    ).get;
    get.mockClear();
    const movedAgain = await migrateLegacyStorageKeys();

    expect(movedAgain).toBe(0);
    // One keyed read for the marker; never get(null) again.
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalledWith(null);
  });

  it("does not throw when storage is unavailable", async () => {
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => {
            throw new Error("no storage");
          }),
        },
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(migrateLegacyStorageKeys()).resolves.toBe(0);
  });
});
