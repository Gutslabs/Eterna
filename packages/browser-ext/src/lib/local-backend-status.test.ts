import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLocalBackendStatusCache,
  localBackendForModel,
  probeLocalBackend,
} from "./local-backend-status";

beforeEach(() => {
  clearLocalBackendStatusCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local backend status", () => {
  it("maps every proxy-served model to the shared health endpoint", () => {
    for (const model of [
      "gpt-5.6-sol",
      "claude-opus-5::xhigh",
      "gemini-3.7-flash-high",
      "grok-4.6",
    ]) {
      expect(localBackendForModel(model)).toEqual({
        key: "cliproxy",
        label: "CLIProxy",
        healthUrl: "http://localhost:8317/v1/models",
      });
    }
  });

  it("leaves models the proxy does not serve unprobed", () => {
    expect(localBackendForModel("claude-browser::Opus 5|High")).toBeNull();
    expect(localBackendForModel("gpt-4o")).toBeNull();
    expect(localBackendForModel(undefined)).toBeNull();
  });

  it("caches successful probes instead of delaying every send", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetchMock);

    await expect(probeLocalBackend("gemini-3.7-flash-high")).resolves.toBe(
      true,
    );
    await expect(probeLocalBackend("gemini-3.7-flash-high")).resolves.toBe(
      true,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows an explicit retry to bypass the cache", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(probeLocalBackend("gemini-3.7-flash-high")).resolves.toBe(
      false,
    );
    await expect(
      probeLocalBackend("gemini-3.7-flash-high", { force: true }),
    ).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
