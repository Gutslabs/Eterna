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
    expect(Object.keys(store)).toEqual(["ws-mcp-url"]);
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
