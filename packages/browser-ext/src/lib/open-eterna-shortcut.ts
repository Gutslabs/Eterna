export interface OpenEternaShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
}

export interface EternaRuntimeMessenger {
  sendMessage(message: { request: "toggle-sidepanel" }): Promise<unknown>;
}

export function requestToggleEternaSidePanel(
  runtime: EternaRuntimeMessenger,
): Promise<unknown> {
  return runtime.sendMessage({ request: "toggle-sidepanel" });
}

// Close whatever surface hosts the chat. The overlay iframe can't close its
// own window, so it asks the host page's overlay to slide shut; the native
// side panel and the fallback tab close their own window.
export function closeEternaPanel(win: Window): void {
  if (win.parent !== win.self) {
    win.parent.postMessage({ type: "eterna-close-sidebar" }, "*");
    return;
  }
  win.close();
}

export function isOpenEternaShortcut(event: OpenEternaShortcutEvent): boolean {
  return (
    event.key.toLowerCase() === "e" &&
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.repeat &&
    !event.isComposing
  );
}

// Bound on `window` (not `document`): window-capture listeners run before
// document-capture ones, so a freshly injected script wins over stale copies
// from before an extension reload no matter who registered first.
export function bindOpenEternaShortcut(
  target: EventTarget,
  openEterna: () => void,
  isAlive: () => boolean = () => true,
): () => void {
  const onKeyDown = (event: Event) => {
    // Orphaned copy (extension reloaded underneath us): unbind without
    // touching the event so the live script's listener still sees it.
    if (!isAlive()) {
      unbind();
      return;
    }
    if (!(event instanceof KeyboardEvent)) return;
    if (!isOpenEternaShortcut(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openEterna();
  };

  const unbind = () => target.removeEventListener("keydown", onKeyDown, true);
  target.addEventListener("keydown", onKeyDown, true);
  return unbind;
}
