/**
 * Content script bootstrap
 *
 * Runs on every page and every frame at document_start, so it must stay tiny:
 * no React, no CSS, no UI imports. It answers the cheap requests (page text,
 * scrolling, element capture, DOM snapshots via a dynamic import) directly and
 * lazily loads the React UI module (`./ui`) only when something actually needs
 * it — the sidebar opening, a fake-mouse message, or the user selecting text.
 */

import type { CollectorOptions } from "@aipexstudio/dom-snapshot";
import {
  serializePageForExtraction,
  serializeSafeElementAttributes,
  serializeSafeElementText,
} from "../../lib/page-serialization";
import { readSidebarOpen } from "../../lib/sidebar-open-flag";
import { suppressStaleContextErrors } from "../../lib/suppress-stale-errors";

// Quiet the benign "Extension context invalidated" noise a stale content script
// emits for a moment after the extension is reloaded or updated.
suppressStaleContextErrors();

const MIN_SELECTION_LENGTH = 3;
const SELECTION_DEBOUNCE_MS = 100;
const isTopFrame = window.top === window.self;

type UiModule = typeof import("./ui");

let uiPromise: Promise<UiModule> | null = null;

function loadUi(): Promise<UiModule> {
  if (!uiPromise) {
    uiPromise = import("./ui")
      .then((ui) => {
        unbindSelectionTriggers();
        ui.mountUi();
        return ui;
      })
      .catch((error) => {
        uiPromise = null;
        throw error;
      });
  }
  return uiPromise;
}

interface ContentMessage {
  request?: string;
  type?: string;
  x?: number;
  y?: number;
  duration?: number;
  options?: Partial<CollectorOptions>;
}

type SendResponse = (response?: unknown) => void;

// ---------------------------------------------------------------------------
// Element capture (vanilla — used by the intervention flow in any frame)
// ---------------------------------------------------------------------------

const captureState = {
  isCapturing: false,
  highlightedElement: null as Element | null,
  cleanup: null as (() => void) | null,
};

function generateCssSelector(element: Element): string {
  const path: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  const maxDepth = 5;

  while (current && current !== document.body && depth < maxDepth) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector += `#${current.id}`;
      path.unshift(selector);
      break;
    }

    if (current.classList.length > 0) {
      const classes = Array.from(current.classList)
        .filter((c) => !c.startsWith("plasmo-") && !c.startsWith("aipex-"))
        .slice(0, 2)
        .join(".");
      if (classes) {
        selector += `.${classes}`;
      }
    }

    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children);
      const index = siblings.indexOf(current) + 1;
      if (siblings.length > 1) {
        selector += `:nth-child(${index})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;
    depth++;
  }

  return path.join(" > ");
}

function stopCapture() {
  captureState.isCapturing = false;

  if (captureState.highlightedElement) {
    captureState.highlightedElement.classList.remove("aipex-capture-highlight");
    captureState.highlightedElement = null;
  }

  captureState.cleanup?.();
  captureState.cleanup = null;
}

function startCapture() {
  if (captureState.isCapturing) {
    console.warn("⚠️ Capture already in progress");
    return;
  }

  captureState.isCapturing = true;

  const handleMouseOver = (e: MouseEvent) => {
    if (!captureState.isCapturing) return;

    const target = e.target as Element | null;
    if (!target) return;

    if (captureState.highlightedElement) {
      captureState.highlightedElement.classList.remove(
        "aipex-capture-highlight",
      );
    }

    target.classList.add("aipex-capture-highlight");
    captureState.highlightedElement = target;
  };

  const handleClick = (e: MouseEvent) => {
    if (!captureState.isCapturing) return;

    e.preventDefault();
    e.stopPropagation();

    const target = e.target as Element | null;
    if (!target) return;

    const selector = generateCssSelector(target);
    const rect = target.getBoundingClientRect();
    const data = {
      timestamp: Date.now(),
      url: window.location.href,
      tagName: target.tagName.toLowerCase(),
      selector,
      id: target.id || undefined,
      classes: Array.from(target.classList).filter(
        (c) => !c.startsWith("aipex-") && !c.startsWith("plasmo-"),
      ),
      textContent: serializeSafeElementText(target),
      attributes: serializeSafeElementAttributes(target),
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    };

    chrome.runtime
      .sendMessage({
        request: "capture-click-event",
        data,
      })
      .catch((err) => {
        console.error("❌ Failed to send capture event:", err);
      });

    stopCapture();
  };

  document.addEventListener("mouseover", handleMouseOver, true);
  document.addEventListener("click", handleClick, true);

  captureState.cleanup = () => {
    document.removeEventListener("mouseover", handleMouseOver, true);
    document.removeEventListener("click", handleClick, true);
  };

  if (!document.getElementById("aipex-capture-styles")) {
    const style = document.createElement("style");
    style.id = "aipex-capture-styles";
    style.textContent = `
      .aipex-capture-highlight {
        outline: 2px solid #3b82f6 !important;
        outline-offset: 2px !important;
        cursor: crosshair !important;
      }
    `;
    document.head.appendChild(style);
  }
}

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------

function handleMessage(
  message: ContentMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): boolean {
  if (message?.request === "get-page-text") {
    // Hand back the page's HTML (lightly pruned) plus a readable-text fallback.
    // Defuddle then runs in the extension/sidepanel context — a content script
    // can't load module chunks on CSP-strict sites like x.com (the import
    // resolves to the page origin and returns "MIME type text/html"), so the
    // extraction itself can't happen here. Pruning drops heavy scripts/styles
    // to shrink the payload but keeps JSON-LD so Defuddle still gets metadata.
    try {
      const serialized = serializePageForExtraction(document);
      // What the user is actually looking at. The attached page text is the
      // WHOLE page but the ambient screenshot is only the viewport, so a
      // breadcrumb (current section heading + scroll depth) lets the sidebar
      // resolve "what's this?" to the visible region rather than guessing.
      let visible: { topHeading?: string; scrollPct?: number } | undefined;
      try {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const scrollPct =
          max > 0
            ? Math.min(
                100,
                Math.max(0, Math.round((window.scrollY / max) * 100)),
              )
            : 0;
        const mid = window.innerHeight * 0.5;
        let topHeading: string | undefined;
        for (const h of Array.from(
          document.querySelectorAll("h1, h2, h3, h4"),
        )) {
          if (h.getBoundingClientRect().top > mid) break;
          const text = (h.textContent || "").trim().replace(/\s+/g, " ");
          if (text) topHeading = text.slice(0, 120);
        }
        visible = { topHeading, scrollPct };
      } catch {
        visible = undefined;
      }
      sendResponse({
        html: serialized.html,
        readable: serialized.readable,
        url: location.href,
        visible,
        truncated: serialized.truncated,
      });
    } catch {
      sendResponse({ html: "", readable: "", url: location.href });
    }
    return true;
  }

  if (message?.request === "scroll-to-coordinates") {
    const { x, y } = message;
    if (typeof x === "number" && typeof y === "number") {
      window.scrollTo({
        left: x - window.innerWidth / 2,
        top: y - window.innerHeight / 2,
        behavior: "smooth",
      });
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "Invalid coordinates" });
    }
    return true;
  }

  if (
    message?.request === "fake-mouse-move" ||
    message?.request === "fake-mouse-play-click-animation"
  ) {
    // The fake mouse renders in the top frame only — subframes stay dormant so
    // a broadcast doesn't load React in every ad iframe.
    if (!isTopFrame) return false;
    loadUi()
      .then((ui) =>
        ui.handleFakeMouseMessage({
          request: message.request as string,
          x: message.x,
          y: message.y,
          duration: message.duration,
        }),
      )
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  }

  if (message?.request === "start-capture") {
    try {
      startCapture();
      sendResponse({ success: true });
    } catch (error) {
      console.error("❌ Failed to start capture:", error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (message?.request === "stop-capture") {
    try {
      stopCapture();
      sendResponse({ success: true });
    } catch (error) {
      console.error("❌ Failed to stop capture:", error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (
    message?.type === "aipex:collect-dom-snapshot" ||
    message?.request === "collect-dom-snapshot"
  ) {
    (async () => {
      try {
        const { collectDomSnapshot } = await import(
          "@aipexstudio/dom-snapshot"
        );
        const snapshot = collectDomSnapshot(document, message.options);
        sendResponse({ success: true, data: snapshot });
      } catch (error) {
        console.error("❌ Failed to collect DOM snapshot:", error);
        sendResponse({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to collect DOM snapshot",
        });
      }
    })();
    return true;
  }

  if (
    message?.request === "toggle-aipex-sidebar" ||
    message?.request === "open-aipex-sidebar" ||
    message?.request === "close-aipex-sidebar"
  ) {
    if (!isTopFrame) return false;
    const command =
      message.request === "toggle-aipex-sidebar"
        ? "toggle"
        : message.request === "open-aipex-sidebar"
          ? "open"
          : "close";
    // Closing a sidebar that was never loaded is a no-op — don't pull in the
    // UI just to keep it closed.
    if (command === "close" && !uiPromise) {
      sendResponse({ success: true });
      return true;
    }
    loadUi()
      .then((ui) => {
        ui.dispatchSidebarCommand(command);
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  }

  return false;
}

chrome.runtime.onMessage.addListener(handleMessage);

// ---------------------------------------------------------------------------
// Lazy-load triggers (top frame only — the sidebar and selection bar live there)
// ---------------------------------------------------------------------------

function hasQualifyingSelection(): boolean {
  const selection = window.getSelection();
  if (
    selection &&
    !selection.isCollapsed &&
    selection.toString().trim().length >= MIN_SELECTION_LENGTH
  ) {
    return true;
  }
  const el = document.activeElement;
  if (
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
    el.type !== "password"
  ) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start != null && end != null && end > start) {
      return el.value.slice(start, end).trim().length >= MIN_SELECTION_LENGTH;
    }
  }
  return false;
}

let selectionTimer = 0;
let selectionTriggersBound = false;

function onSelectionEvent() {
  window.clearTimeout(selectionTimer);
  selectionTimer = window.setTimeout(() => {
    if (!hasQualifyingSelection()) return;
    // Re-fire selectionchange once the UI mounts so the freshly-loaded
    // SelectionAction evaluates the selection that triggered the load.
    loadUi()
      .then(() => document.dispatchEvent(new Event("selectionchange")))
      .catch(() => {});
  }, SELECTION_DEBOUNCE_MS);
}

function bindSelectionTriggers() {
  if (selectionTriggersBound) return;
  selectionTriggersBound = true;
  document.addEventListener("mouseup", onSelectionEvent);
  document.addEventListener("selectionchange", onSelectionEvent);
  document.addEventListener("select", onSelectionEvent, true);
}

function unbindSelectionTriggers() {
  if (!selectionTriggersBound) return;
  selectionTriggersBound = false;
  window.clearTimeout(selectionTimer);
  document.removeEventListener("mouseup", onSelectionEvent);
  document.removeEventListener("selectionchange", onSelectionEvent);
  document.removeEventListener("select", onSelectionEvent, true);
}

if (isTopFrame) {
  bindSelectionTriggers();

  // A sidebar left open in THIS tab loads its UI right away so it reappears
  // after a same-tab navigation. The flag is per-tab (sessionStorage), so
  // opening the panel in another tab no longer fans out to load it here.
  if (readSidebarOpen()) loadUi().catch(() => {});
}
