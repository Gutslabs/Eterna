import { describe, expect, it, vi } from "vitest";
import {
  bindOpenEternaShortcut,
  closeEternaPanel,
  isOpenEternaShortcut,
  requestToggleEternaSidePanel,
} from "./open-eterna-shortcut";

function shortcutEvent(
  overrides: Partial<Parameters<typeof isOpenEternaShortcut>[0]> = {},
): Parameters<typeof isOpenEternaShortcut>[0] {
  return {
    key: "e",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    ...overrides,
  };
}

describe("isOpenEternaShortcut", () => {
  it("accepts Command+E regardless of key casing", () => {
    expect(isOpenEternaShortcut(shortcutEvent())).toBe(true);
    expect(isOpenEternaShortcut(shortcutEvent({ key: "E" }))).toBe(true);
  });

  it("rejects modified, repeated, composing, and unrelated key events", () => {
    expect(isOpenEternaShortcut(shortcutEvent({ metaKey: false }))).toBe(false);
    expect(isOpenEternaShortcut(shortcutEvent({ ctrlKey: true }))).toBe(false);
    expect(isOpenEternaShortcut(shortcutEvent({ altKey: true }))).toBe(false);
    expect(isOpenEternaShortcut(shortcutEvent({ shiftKey: true }))).toBe(false);
    expect(isOpenEternaShortcut(shortcutEvent({ repeat: true }))).toBe(false);
    expect(isOpenEternaShortcut(shortcutEvent({ isComposing: true }))).toBe(
      false,
    );
    expect(isOpenEternaShortcut(shortcutEvent({ key: "k" }))).toBe(false);
  });
});

function commandE(): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: "e",
    metaKey: true,
    cancelable: true,
  });
}

describe("bindOpenEternaShortcut", () => {
  it("captures Command+E, cancels Chrome's default, and opens Eterna once", () => {
    const openEterna = vi.fn();
    const unbind = bindOpenEternaShortcut(window, openEterna);
    const event = commandE();

    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(openEterna).toHaveBeenCalledOnce();
    unbind();
  });

  it("leaves ordinary key events untouched", () => {
    const openEterna = vi.fn();
    const unbind = bindOpenEternaShortcut(window, openEterna);
    const event = new KeyboardEvent("keydown", {
      key: "e",
      cancelable: true,
    });

    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(openEterna).not.toHaveBeenCalled();
    unbind();
  });

  it("beats a stale document-level catcher from before an extension reload", () => {
    const staleOpen = vi.fn();
    const staleUnbind = bindOpenEternaShortcut(document, staleOpen);
    const freshOpen = vi.fn();
    const freshUnbind = bindOpenEternaShortcut(window, freshOpen);

    document.dispatchEvent(commandE());

    expect(freshOpen).toHaveBeenCalledOnce();
    expect(staleOpen).not.toHaveBeenCalled();
    staleUnbind();
    freshUnbind();
  });

  it("unbinds a dead copy without blocking the event for live listeners", () => {
    const orphanOpen = vi.fn();
    bindOpenEternaShortcut(window, orphanOpen, () => false);
    const liveOpen = vi.fn();
    const liveUnbind = bindOpenEternaShortcut(window, liveOpen);

    const event = commandE();
    document.dispatchEvent(event);

    expect(orphanOpen).not.toHaveBeenCalled();
    expect(liveOpen).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);

    liveUnbind();
    const orphanRevived = vi.fn();
    bindOpenEternaShortcut(window, orphanRevived, () => true);
    document.dispatchEvent(commandE());
    expect(orphanOpen).not.toHaveBeenCalled();
    expect(orphanRevived).toHaveBeenCalledOnce();
  });
});

describe("requestToggleEternaSidePanel", () => {
  it("asks the background to toggle the side panel", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true });

    await requestToggleEternaSidePanel({ sendMessage });

    expect(sendMessage).toHaveBeenCalledWith({ request: "toggle-sidepanel" });
  });
});

describe("closeEternaPanel", () => {
  it("closes its own window when it is the top-level surface", () => {
    const close = vi.fn();
    const win = { close } as unknown as Window;
    (win as { parent?: unknown }).parent = win;
    (win as { self?: unknown }).self = win;

    closeEternaPanel(win);

    expect(close).toHaveBeenCalledOnce();
  });

  it("asks the host page to close the overlay when framed", () => {
    const postMessage = vi.fn();
    const close = vi.fn();
    const win = { close } as unknown as Window;
    (win as { self?: unknown }).self = win;
    (win as { parent?: unknown }).parent = { postMessage };

    closeEternaPanel(win);

    expect(postMessage).toHaveBeenCalledWith(
      { type: "eterna-close-sidebar" },
      "*",
    );
    expect(close).not.toHaveBeenCalled();
  });
});
