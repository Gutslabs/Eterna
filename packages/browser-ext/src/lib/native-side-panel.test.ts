import { describe, expect, it, vi } from "vitest";
import { supportsNativeSidePanel } from "./native-side-panel";

describe("supportsNativeSidePanel", () => {
  it("accepts a complete native side-panel API", () => {
    expect(
      supportsNativeSidePanel({
        open: vi.fn(),
        setPanelBehavior: vi.fn(),
      }),
    ).toBe(true);
  });

  it("rejects browsers that expose only sidePanel.open", () => {
    expect(supportsNativeSidePanel({ open: vi.fn() })).toBe(false);
  });

  it("rejects browsers that expose only sidePanel.setPanelBehavior", () => {
    expect(supportsNativeSidePanel({ setPanelBehavior: vi.fn() })).toBe(false);
  });

  it("rejects a missing side-panel API", () => {
    expect(supportsNativeSidePanel(undefined)).toBe(false);
  });
});
