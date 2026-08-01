/**
 * Lazily-loaded content script UI
 *
 * Everything React lives here: the fake mouse overlay, the docked chat
 * sidebar, and the selection action bar. The bootstrap (`index.tsx`) imports
 * this module on demand — when the sidebar should show, a fake-mouse message
 * arrives, or the user selects text — so ordinary page loads never pay for
 * React or any UI code.
 */

import { FakeMouse } from "@aipexstudio/aipex-react/components/fake-mouse";
import type { FakeMouseController } from "@aipexstudio/aipex-react/components/fake-mouse/types";
import React from "react";
import ReactDOM, { type Root } from "react-dom/client";
import { SelectionAction } from "../../lib/selection-action";
import { dispatchSidebarCommand } from "../../lib/sidebar-commands";
import {
  restoreStaleSidebarRootStyles,
  SidebarApp,
} from "../../lib/sidebar-overlay";

export { dispatchSidebarCommand };

const FAKE_MOUSE_READY_TIMEOUT_MS = 3000;

let fakeMouseController: FakeMouseController | null = null;
const controllerWaiters: Array<(controller: FakeMouseController) => void> = [];

function waitForFakeMouse(): Promise<FakeMouseController | null> {
  if (fakeMouseController) {
    return Promise.resolve(fakeMouseController);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), FAKE_MOUSE_READY_TIMEOUT_MS);
    controllerWaiters.push((controller) => {
      clearTimeout(timer);
      resolve(controller);
    });
  });
}

export interface FakeMouseMessage {
  request: string;
  x?: number;
  y?: number;
  duration?: number;
}

export interface FakeMouseResponse {
  success: boolean;
  error?: string;
}

export async function handleFakeMouseMessage(
  message: FakeMouseMessage,
): Promise<FakeMouseResponse> {
  const controller = await waitForFakeMouse();
  if (!controller) {
    return { success: false, error: "Fake mouse not ready" };
  }
  try {
    if (message.request === "fake-mouse-move") {
      const { x, y, duration } = message;
      if (typeof x !== "number" || typeof y !== "number") {
        return { success: false, error: "Invalid coordinates" };
      }
      controller.show();
      await controller.moveTo(x, y, duration);
      return { success: true };
    }
    if (message.request === "fake-mouse-play-click-animation") {
      await controller.playClickAnimation();
      await controller.moveTo(window.innerWidth / 2, window.innerHeight / 2);
      controller.hide();
      return { success: true };
    }
    return { success: false, error: `Unknown request: ${message.request}` };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const ContentApp = () => (
  <FakeMouse
    onReady={(controller) => {
      fakeMouseController = controller;
      for (const waiter of controllerWaiters.splice(0)) {
        waiter(controller);
      }
    }}
  />
);

let mountRequested = false;

type ReactRootContainer = HTMLElement & {
  __aipexReactRoot?: Root;
};

function removeReactRoot(id: string, restorePageShift = false): void {
  const existing = document.getElementById(id) as ReactRootContainer | null;
  if (!existing) return;
  const reactRoot = existing.__aipexReactRoot;
  let needsLegacyRestore = reactRoot === undefined;
  if (reactRoot) {
    try {
      reactRoot.unmount();
    } catch {
      // An extension update can invalidate the old root's execution context.
      needsLegacyRestore = true;
    }
  }
  if (restorePageShift && needsLegacyRestore) {
    restoreStaleSidebarRootStyles(document.documentElement);
  }
  existing.remove();
}

export function mountUi(): void {
  if (mountRequested) return;
  mountRequested = true;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
}

function mount() {
  // Re-injection (a tab opened before the extension loaded, or re-injected
  // after an update) should replace the previous mount rather than stack a
  // second copy on top. Unmount first so React restores page styles/listeners;
  // legacy roots without an unmount handle use the style snapshot fallback.
  removeReactRoot("eterna-content-root");
  removeReactRoot("eterna-sidebar-root", true);

  // Fake mouse overlay (shadow DOM for isolation; all styling is inline).
  const container = document.createElement("div");
  container.id = "eterna-content-root";
  document.body.appendChild(container);

  const shadowRoot = container.attachShadow({ mode: "open" });
  const shadowContainer = document.createElement("div");
  shadowRoot.appendChild(shadowContainer);

  const style = document.createElement("style");
  style.textContent = ":host { all: initial; }";
  shadowRoot.appendChild(style);

  const contentRoot = ReactDOM.createRoot(shadowContainer);
  (container as ReactRootContainer).__aipexReactRoot = contentRoot;
  contentRoot.render(
    <React.StrictMode>
      <ContentApp />
    </React.StrictMode>,
  );

  // Docked chat sidebar (top frame only) in its own shadow root so page CSS
  // can't bleed into the panel container.
  if (window.top === window.self) {
    const sidebarContainer = document.createElement("div");
    sidebarContainer.id = "eterna-sidebar-root";
    document.documentElement.appendChild(sidebarContainer);

    const sidebarShadow = sidebarContainer.attachShadow({ mode: "open" });
    const sidebarMount = document.createElement("div");
    sidebarShadow.appendChild(sidebarMount);

    const sidebarRoot = ReactDOM.createRoot(sidebarMount);
    (sidebarContainer as ReactRootContainer).__aipexReactRoot = sidebarRoot;
    sidebarRoot.render(
      <React.StrictMode>
        <SidebarApp />
        <SelectionAction />
      </React.StrictMode>,
    );
  }
}
