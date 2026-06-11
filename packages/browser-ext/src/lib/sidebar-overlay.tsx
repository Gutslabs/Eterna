/**
 * In-page sidebar overlay
 *
 * Renders the AIPex chat as a docked panel injected into the host page by the
 * content script, instead of a separate browser window. The chat itself lives
 * in an <iframe> pointing at the extension's sidepanel.html, so it runs as a
 * full extension page (all chrome.* APIs and browser tools keep working) while
 * appearing chrome-less and edge-docked like a native browser AI sidebar.
 *
 * The iframe is mounted lazily on first open and then kept alive so the chat
 * state survives toggling within a page. Open/closed and width are global flags
 * in chrome.storage.local, so — like a native browser sidebar — they apply
 * everywhere and persist across navigations. The panel is resizable by dragging
 * its left edge.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { onSidebarCommand } from "./sidebar-commands";
import { readSidebarOpen, writeSidebarOpen } from "./sidebar-open-flag";

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 320;
const MAX_WIDTH = 760;
const SIDEPANEL_PATH = "src/sidepanel.html";
const WIDTH_KEY = "aipex-sidebar-width";
const PANEL_BG = "#181817";

const clampWidth = (value: number) =>
  Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));

export function SidebarApp() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  // Whether the next visual change should animate. Restoring a persisted-open
  // panel after a navigation should appear instantly; user actions slide.
  const animateRef = useRef(true);
  const iframeUrl = useRef(chrome.runtime.getURL(SIDEPANEL_PATH));
  const widthRef = useRef(width);
  widthRef.current = width;

  const persist = useCallback((value: boolean) => {
    // Per-tab (sessionStorage), so opening here never opens another tab.
    writeSidebarOpen(value);
  }, []);

  const openPanel = useCallback(() => {
    animateRef.current = true;
    setMounted(true);
    // Mount off-screen first, then slide in on the next frame so the
    // transition runs on the very first open as well.
    requestAnimationFrame(() => setOpen(true));
    persist(true);
  }, [persist]);

  const closePanel = useCallback(() => {
    animateRef.current = true;
    setOpen(false);
    persist(false);
  }, [persist]);

  const togglePanel = useCallback(() => {
    setOpen((isOpen) => {
      const next = !isOpen;
      animateRef.current = true;
      if (next) setMounted(true);
      persist(next);
      return next;
    });
  }, [persist]);

  // Restore on mount. Open state is per-tab (sessionStorage) so it survives a
  // same-tab navigation without fanning out to other tabs; width is a shared,
  // cross-tab preference. Restored state appears instantly (no slide).
  useEffect(() => {
    if (readSidebarOpen()) {
      animateRef.current = false;
      setMounted(true);
      setOpen(true);
    }
    let cancelled = false;
    chrome.storage.local.get(WIDTH_KEY).then((result) => {
      if (cancelled) return;
      const storedWidth = result[WIDTH_KEY];
      if (
        typeof storedWidth === "number" &&
        storedWidth >= MIN_WIDTH &&
        storedWidth <= MAX_WIDTH
      ) {
        setWidth(storedWidth);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Width is a shared preference, so keep it in sync across tabs. Open state is
  // deliberately NOT synced — each tab opens independently.
  useEffect(() => {
    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== "local") return;
      if (
        changes[WIDTH_KEY] &&
        typeof changes[WIDTH_KEY].newValue === "number"
      ) {
        setWidth(clampWidth(changes[WIDTH_KEY].newValue));
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  // Drag-to-resize: while resizing, track the pointer at the document level and
  // disable the iframe's pointer events so the move events aren't swallowed.
  useEffect(() => {
    if (!resizing) return;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const onMove = (event: MouseEvent) => {
      setWidth(clampWidth(window.innerWidth - event.clientX));
    };
    const onUp = () => {
      setResizing(false);
      chrome.storage.local
        .set({ [WIDTH_KEY]: widthRef.current })
        .catch(() => {});
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = prevUserSelect;
    };
  }, [resizing]);

  // Toggle requests broadcast from the background service worker (toolbar icon
  // click and the keyboard command) arrive via the content script bootstrap,
  // which lazy-loads this UI and replays the command that triggered the load.
  useEffect(
    () =>
      onSidebarCommand((command) => {
        switch (command) {
          case "toggle":
            togglePanel();
            break;
          case "open":
            openPanel();
            break;
          case "close":
            closePanel();
            break;
        }
      }),
    [togglePanel, openPanel, closePanel],
  );

  // Close button inside the iframe posts a message up to the host frame.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "aipex-close-sidebar") closePanel();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [closePanel]);

  // Esc closes the panel when focus is on the host page (typing inside the
  // chat keeps focus in the iframe, so it won't close mid-message).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closePanel]);

  // A previous version of this script pushed pages by also putting a
  // `transform` on <body>. Pages that were open across an extension update
  // still carry that style inline on <body>, and it keeps breaking
  // `position: fixed`/`sticky` there (e.g. X's left nav scrolling away with
  // the page) — so strip exactly the styles that old version set.
  useEffect(() => {
    const body = document.body;
    if (body && body.style.transform === "translateX(0)") {
      body.style.removeProperty("transform");
      body.style.removeProperty("overflow-x");
    }
  }, []);

  // Push the page content aside (like a native browser sidebar) instead of
  // floating over it, so the page reflows beside the panel and stays usable.
  // The margin animates with the slide, but follows the pointer during resize.
  //
  // We only ever style <html> — never <body>. An earlier version also put a
  // `transform` on <body> so `position: fixed` elements would get pushed too,
  // but a transform on an ancestor silently breaks every `position: sticky`
  // descendant (e.g. X's left nav stops scrolling with the page). Shrinking the
  // root's content box with `margin-right` reflows the page without disturbing
  // sticky/fixed positioning. `overflow-x: clip` trims anything still sized to
  // the full viewport (`100vw`); unlike `overflow: hidden` it does NOT create a
  // scroll container, so it leaves `overflow-y: visible` — and sticky — intact.
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    const animate = animateRef.current && !resizing;
    root.style.transition = animate
      ? "margin-right 220ms cubic-bezier(0.22, 1, 0.36, 1)"
      : "none";

    if (open) {
      root.style.setProperty("margin-right", `${width}px`, "important");
      root.style.setProperty("overflow-x", "clip", "important");
      return;
    }

    root.style.setProperty("margin-right", "0px", "important");
    const timer = setTimeout(
      () => {
        // Fully restore the page's own styles once the panel has slid away.
        root.style.removeProperty("margin-right");
        root.style.removeProperty("overflow-x");
        root.style.transition = "";
      },
      animate ? 240 : 0,
    );
    return () => clearTimeout(timer);
  }, [open, mounted, width, resizing]);

  if (!mounted) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        height: "100vh",
        width: `${width}px`,
        maxWidth: "100vw",
        zIndex: 2147483647,
        transform: open ? "translateX(0)" : "translateX(100%)",
        transition: resizing
          ? "none"
          : animateRef.current
            ? "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)"
            : "none",
        boxShadow: open ? "0 0 24px 0 rgba(0, 0, 0, 0.35)" : "none",
        // No visible border — the panel reads as borderless and keeps its own
        // background; the soft shadow alone separates it from light pages.
        borderLeft: "none",
        pointerEvents: open ? "auto" : "none",
        background: PANEL_BG,
      }}
    >
      {/* Drag the left edge to resize the panel. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        title="Drag to resize"
        onMouseDown={(event) => {
          event.preventDefault();
          setResizing(true);
        }}
        onKeyDown={(event) => {
          const delta =
            event.key === "ArrowLeft"
              ? 20
              : event.key === "ArrowRight"
                ? -20
                : 0;
          if (delta === 0) return;
          event.preventDefault();
          setWidth((current) => {
            const next = clampWidth(current + delta);
            chrome.storage.local.set({ [WIDTH_KEY]: next }).catch(() => {});
            return next;
          });
        }}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: "6px",
          cursor: "ew-resize",
          zIndex: 2,
          background: resizing ? "rgba(255, 255, 255, 0.15)" : "transparent",
        }}
      />
      <iframe
        title="Eterna"
        src={iframeUrl.current}
        allow="microphone; clipboard-read; clipboard-write"
        style={{
          width: "100%",
          height: "100%",
          border: "0",
          display: "block",
          pointerEvents: resizing ? "none" : "auto",
        }}
      />
    </div>
  );
}
