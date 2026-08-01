import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchSidebarCommand } from "./sidebar-commands";
import { restoreStaleSidebarRootStyles, SidebarApp } from "./sidebar-overlay";

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  document.documentElement.removeAttribute("style");
  Object.assign(chrome.storage, {
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  });
  vi.mocked(chrome.storage.local.get).mockImplementation(async (key) => {
    if (key === "eterna-native-sidepanel") {
      return { "eterna-native-sidepanel": false };
    }
    return {};
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("style");
});

describe("SidebarApp", () => {
  it("keeps the fixed panel visible while pushing page content aside", async () => {
    const { getByTitle, unmount } = render(<SidebarApp />);

    await waitFor(() =>
      expect(chrome.storage.local.get).toHaveBeenCalledWith(
        "eterna-native-sidepanel",
      ),
    );

    act(() => dispatchSidebarCommand("open"));

    await waitFor(() => {
      expect(getByTitle("Eterna")).toBeInTheDocument();
      expect(document.documentElement.style.marginRight).toBe("400px");
    });
    expect(document.documentElement.style.overflowX).toBe("visible");

    unmount();
  });

  it("shows an explicitly requested panel even when native support exists", async () => {
    vi.mocked(chrome.storage.local.get).mockImplementation(async (key) => {
      if (key === "eterna-native-sidepanel") {
        return { "eterna-native-sidepanel": true };
      }
      return {};
    });
    const { getByTitle, unmount } = render(<SidebarApp />);

    act(() => dispatchSidebarCommand("open"));

    await waitFor(() =>
      expect(chrome.storage.local.get).toHaveBeenCalledWith(
        "eterna-native-sidepanel",
      ),
    );
    await waitFor(() => {
      expect(getByTitle("Eterna")).toBeInTheDocument();
      expect(document.documentElement.style.marginRight).toBe("400px");
    });
    expect(document.documentElement.style.overflowX).toBe("visible");

    unmount();
  });

  it("restores the page's exact inline styles when the panel unmounts", async () => {
    const root = document.documentElement;
    root.style.setProperty("margin-right", "12px");
    root.style.setProperty("overflow-x", "auto");
    root.style.setProperty("transition", "opacity 1s");
    const { unmount } = render(<SidebarApp />);

    act(() => dispatchSidebarCommand("open"));
    await waitFor(() => expect(root.style.marginRight).toBe("400px"));
    expect(root.hasAttribute("data-eterna-sidebar-root-style")).toBe(true);

    unmount();

    expect(root.style.marginRight).toBe("12px");
    expect(root.style.overflowX).toBe("auto");
    expect(root.style.transition).toBe("opacity 1s");
    expect(root.hasAttribute("data-eterna-sidebar-root-style")).toBe(false);
  });

  it("clears the known legacy page shift left by a stale injected root", () => {
    const root = document.documentElement;
    root.style.setProperty("margin-right", "400px", "important");
    root.style.setProperty("overflow-x", "visible", "important");
    root.style.setProperty(
      "transition",
      "margin-right 220ms cubic-bezier(0.22, 1, 0.36, 1)",
      "important",
    );

    restoreStaleSidebarRootStyles(root);

    expect(root.style.marginRight).toBe("");
    expect(root.style.overflowX).toBe("");
    expect(root.style.transition).toBe("");
  });
});
