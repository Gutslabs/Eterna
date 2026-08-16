import { describe, expect, it } from "vitest";
import type { KeyValueStorage, WatchCallback } from "../storage/index.js";
import {
  type AppSettings,
  changedAppSettings,
  mergeAppSettings,
  updateAppSettings,
} from "./settings.js";

function createStorage(initial: AppSettings): KeyValueStorage<unknown> {
  let value: unknown = initial;
  return {
    async save(_key, next) {
      value = next;
    },
    async load() {
      return value;
    },
    async update(_key, updater) {
      value = updater(value);
      return value;
    },
    async delete() {
      value = null;
    },
    async listAll() {
      return value === null ? [] : [value];
    },
    async query(predicate) {
      return value !== null && predicate(value) ? [value] : [];
    },
    watch(_key, _callback: WatchCallback<unknown>) {
      return () => {};
    },
  };
}

describe("app settings updates", () => {
  it("merges defined values without erasing unrelated settings", () => {
    expect(
      mergeAppSettings(
        { aiModel: "before", dataSharingEnabled: true },
        { aiModel: "after", dataSharingEnabled: undefined },
      ),
    ).toMatchObject({
      aiModel: "after",
      dataSharingEnabled: true,
      language: "en",
    });
  });

  it("creates a patch from fields changed by a settings form", () => {
    const customModels: AppSettings["customModels"] = [];
    expect(
      changedAppSettings(
        { aiModel: "same", theme: "light", customModels },
        { aiModel: "same", theme: "dark", customModels },
      ),
    ).toEqual({ theme: "dark" });
  });

  it("atomically applies a patch over the latest stored value", async () => {
    const storage = createStorage({
      aiModel: "old-model",
      dataSharingEnabled: true,
    });

    const saved = await updateAppSettings(storage, "settings", {
      aiModel: "new-model",
    });

    expect(saved).toMatchObject({
      aiModel: "new-model",
      dataSharingEnabled: true,
    });
  });
});
