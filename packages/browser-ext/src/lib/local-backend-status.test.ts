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
  it("maps local models to their shared health endpoint", () => {
    expect(localBackendForModel("catgpt-browser::GPT-5.6 Sol|High")).toEqual({
      key: "gpt-web",
      label: "gpt-web",
      healthUrl: "http://localhost:8000/healthz",
    });
    expect(localBackendForModel("gemini-3-flash")?.key).toBe("cliproxy");
    expect(localBackendForModel("gpt-5.5")).toBeNull();
  });

  it("caches successful probes instead of delaying every send", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetchMock);

    await expect(probeLocalBackend("gemini-3-flash")).resolves.toBe(true);
    await expect(probeLocalBackend("gemini-3-flash")).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows an explicit retry to bypass the cache", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(probeLocalBackend("gemini-3-flash")).resolves.toBe(false);
    await expect(
      probeLocalBackend("gemini-3-flash", { force: true }),
    ).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
