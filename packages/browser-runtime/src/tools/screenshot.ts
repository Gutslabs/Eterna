import { tool } from "@aipexstudio/aipex-core";
import { z } from "zod";
import { cacheScreenshotMetadata } from "../automation/computer";
import { RuntimeScreenshotStorage } from "../lib/screenshot-storage";
import { getAutomationMode } from "../runtime/automation-mode";
import {
  captureVisibleTabWithElementCrop,
  compressImage,
  getImageSize,
  MAX_PADDING,
} from "./screenshot-helpers.js";
import { getActiveTab } from "./tab-utils";

// Re-export the shared helper types/function so existing consumers aren't broken
export type {
  CaptureWithElementCropOptions,
  CaptureWithElementCropResult,
} from "./screenshot-helpers.js";
export { captureVisibleTabWithElementCrop } from "./screenshot-helpers.js";

/**
 * SILENT capture of the active tab's visible area (the raw PNG data URL) — never
 * steals window focus, never writes to IndexedDB. Returns null when capture
 * isn't possible (background mode, a restricted page, or no active tab).
 */
async function captureActiveVisibleTab(): Promise<string | null> {
  // Background mode deliberately avoids touching the user's window.
  if ((await getAutomationMode()) === "background") return null;

  const tab = await getActiveTab();
  if (!tab.id || !tab.windowId) return null;
  if (
    tab.url &&
    (tab.url.startsWith("chrome://") ||
      tab.url.startsWith("chrome-extension://") ||
      tab.url.startsWith("edge://") ||
      tab.url.startsWith("about:"))
  ) {
    return null;
  }

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png",
    quality: 90,
  });
  return dataUrl?.startsWith("data:image/") ? dataUrl : null;
}

/**
 * The viewport screenshot sent to the model for the "auto-attach a screenshot to
 * every message" feature — compressed to a model-friendly size. Returns null on
 * any failure (all swallowed).
 */
export async function captureViewportForAmbient(): Promise<string | null> {
  try {
    const raw = await captureActiveVisibleTab();
    return raw ? await compressImage(raw, 0.6, 1024) : null;
  } catch (error) {
    console.warn("[AmbientScreenshot] capture skipped:", error);
    return null;
  }
}

export const captureScreenshotTool = tool({
  name: "capture_screenshot",
  description: `[HIGH-COST FALLBACK] Capture screenshot of current visible tab.

TRY search_elements FIRST: For most interactions (clicking, filling, reading), use search_elements + UID-based tools. They are faster and don't send images to LLM.

USE THIS ONLY WHEN:
- search_elements cannot find the target after 2 query attempts
- You need to see visual layout, images, charts, or canvas content
- The page uses non-standard rendering that snapshots miss

When sendToLLM=true: Sends image to LLM (higher latency/cost, may capture sensitive on-screen data) and enables the computer tool for coordinate-based actions. NOTE: This tool requires focus mode.`,
  parameters: z.object({
    sendToLLM: z
      .boolean()
      .nullable()
      .optional()
      .default(false)
      .describe(
        "Whether to send the screenshot to LLM for visual analysis. When true, enables computer tool for coordinate actions. Use sparingly - adds latency and token cost.",
      ),
  }),
  execute: async ({ sendToLLM = false }) => {
    const mode = await getAutomationMode();
    console.log("🔧 [captureScreenshot] Automation mode:", mode);

    // Background mode: reject screenshot with visual feedback
    if (mode === "background") {
      throw new Error(
        "Screenshot capture is disabled in background mode. Please switch to focus mode to use visual tools.",
      );
    }

    const tab = await getActiveTab();

    if (!tab.id || !tab.windowId) {
      throw new Error("No active tab found");
    }

    if (
      tab.url &&
      (tab.url.startsWith("chrome://") ||
        tab.url.startsWith("chrome-extension://"))
    ) {
      throw new Error("Cannot capture browser internal pages");
    }

    if (tab.status === "loading") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    await chrome.windows.update(tab.windowId, { focused: true });
    await new Promise((resolve) => setTimeout(resolve, 100));

    let dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
      quality: 90,
    });

    if (!dataUrl || !dataUrl.startsWith("data:image/")) {
      throw new Error("Invalid image data captured");
    }

    // Get viewport dimensions for metadata caching (graceful degradation)
    let viewport: { width: number; height: number } | undefined;
    try {
      const viewportDimensions = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      });
      viewport = viewportDimensions[0]?.result ?? undefined;
    } catch (e) {
      console.warn("[Screenshot] Failed to get viewport dimensions:", e);
      // Continue without viewport metadata – screenshot still works
    }

    // Get image dimensions for metadata
    let imageWidth = 0;
    let imageHeight = 0;

    if (sendToLLM) {
      // Compress for LLM
      dataUrl = await compressImage(dataUrl, 0.6, 1024);

      // Extract image dimensions
      const size = await getImageSize(dataUrl);
      imageWidth = size.width;
      imageHeight = size.height;

      // Cache screenshot metadata for computer tool
      if (viewport) {
        cacheScreenshotMetadata(
          tab.id,
          imageWidth,
          imageHeight,
          viewport.width,
          viewport.height,
        );
      }
    } else {
      // Get original image dimensions for non-LLM screenshots
      const size = await getImageSize(dataUrl);
      imageWidth = size.width;
      imageHeight = size.height;
    }

    // Save screenshot to IndexedDB and get uid
    let screenshotUid: string | undefined;
    try {
      screenshotUid = await RuntimeScreenshotStorage.saveScreenshot(dataUrl, {
        tabId: tab.id,
        width: imageWidth,
        height: imageHeight,
        viewportWidth: viewport?.width ?? 0,
        viewportHeight: viewport?.height ?? 0,
      });
    } catch (err) {
      console.error("[Screenshot] Failed to save to IndexedDB:", err);
      // Continue even if storage fails
    }

    if (sendToLLM) {
      return {
        success: true,
        imageData: dataUrl,
        sendToLLM: true,
        screenshotUid,
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
      };
    }

    return {
      success: true,
      captured: true,
      sendToLLM: false,
      screenshotUid,
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
    };
  },
});

export const captureTabScreenshotTool = tool({
  name: "capture_tab_screenshot",
  description: `[HIGH-COST FALLBACK] Capture screenshot of a specific tab by ID.

TRY search_elements FIRST: Visual verification is expensive. Use search_elements + UID-based tools for most interactions.

USE THIS ONLY WHEN:
- Visual verification is essential
- search_elements failed to find the target
- You need to see images, charts, or canvas content

When sendToLLM=true: Sends image to LLM (higher latency/cost) and enables coordinate-based actions. NOTE: This tool requires focus mode.`,
  parameters: z.object({
    tabId: z.number().describe("The tab ID to capture"),
    sendToLLM: z
      .boolean()
      .nullable()
      .optional()
      .default(false)
      .describe(
        "Whether to send the screenshot to LLM for visual analysis. When true, visual coordinate tools will be enabled.",
      ),
  }),
  execute: async ({ tabId, sendToLLM = false }) => {
    const mode = await getAutomationMode();
    console.log("🔧 [captureTabScreenshot] Automation mode:", mode);

    // Background mode: reject screenshot with visual feedback
    if (mode === "background") {
      throw new Error(
        "Screenshot capture is disabled in background mode. Please switch to focus mode to use visual tools.",
      );
    }

    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.windowId) {
      throw new Error("Tab not found");
    }

    await chrome.tabs.update(tabId, { active: true });
    await new Promise((resolve) => setTimeout(resolve, 100));

    let dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
      quality: 90,
    });

    // Get viewport dimensions for metadata caching (graceful degradation)
    let viewport: { width: number; height: number } | undefined;
    try {
      const viewportDimensions = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      });
      viewport = viewportDimensions[0]?.result ?? undefined;
    } catch (e) {
      console.warn("[Screenshot] Failed to get viewport dimensions:", e);
      // Continue without viewport metadata – screenshot still works
    }

    // Get image dimensions for metadata
    let imageWidth = 0;
    let imageHeight = 0;

    if (sendToLLM) {
      // Compress for LLM
      dataUrl = await compressImage(dataUrl, 0.6, 1024);

      // Extract image dimensions
      const size = await getImageSize(dataUrl);
      imageWidth = size.width;
      imageHeight = size.height;

      // Cache screenshot metadata for computer tool
      if (viewport) {
        cacheScreenshotMetadata(
          tabId,
          imageWidth,
          imageHeight,
          viewport.width,
          viewport.height,
        );
      }
    } else {
      // Get original image dimensions for non-LLM screenshots
      const size = await getImageSize(dataUrl);
      imageWidth = size.width;
      imageHeight = size.height;
    }

    // Save screenshot to IndexedDB and get uid
    let screenshotUid: string | undefined;
    try {
      screenshotUid = await RuntimeScreenshotStorage.saveScreenshot(dataUrl, {
        tabId,
        width: imageWidth,
        height: imageHeight,
        viewportWidth: viewport?.width ?? 0,
        viewportHeight: viewport?.height ?? 0,
      });
    } catch (err) {
      console.error("[Screenshot] Failed to save to IndexedDB:", err);
      // Continue even if storage fails
    }

    if (sendToLLM) {
      return {
        success: true,
        imageData: dataUrl,
        sendToLLM: true,
        screenshotUid,
        tabId,
        url: tab.url,
        title: tab.title,
      };
    }

    return {
      success: true,
      captured: true,
      sendToLLM: false,
      screenshotUid,
      tabId,
      url: tab.url,
      title: tab.title,
    };
  },
});

/** Maximum allowed CSS selector length to prevent injection of excessively long strings */
const MAX_SELECTOR_LENGTH = 500;

// ===================== Tool definition =====================

export const captureScreenshotWithHighlightTool = tool({
  name: "capture_screenshot_with_highlight",
  description: `[HIGH-COST] Capture screenshot of the current visible tab, optionally highlighting and cropping to a specific element identified by CSS selector. The screenshot is always sent to the LLM for visual analysis.

PREFER search_elements for finding/interacting with elements. Use this only when you need to visually verify element appearance or layout. NOTE: This tool requires focus mode.`,
  parameters: z.object({
    selector: z
      .string()
      .max(MAX_SELECTOR_LENGTH)
      .optional()
      .describe("CSS selector of element to highlight/focus on"),
    cropToElement: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Whether to crop the screenshot to the element region (plus padding)",
      ),
    padding: z
      .number()
      .min(0)
      .max(MAX_PADDING)
      .optional()
      .default(50)
      .describe("Padding around element in pixels when cropping (default: 50)"),
    sendToLLM: z
      .boolean()
      .nullable()
      .optional()
      .default(true)
      .describe(
        "Whether to send the screenshot to LLM for visual analysis. Defaults to true.",
      ),
  }),
  execute: async ({
    selector,
    cropToElement = false,
    padding = 50,
    sendToLLM = true,
  }) => {
    const mode = await getAutomationMode();
    console.log("🔧 [captureScreenshotWithHighlight] Automation mode:", mode);

    if (mode === "background") {
      throw new Error(
        "Screenshot capture is disabled in background mode. Please switch to focus mode to use visual tools.",
      );
    }

    const tab = await getActiveTab();

    if (!tab.id || !tab.windowId) {
      throw new Error("No active tab found");
    }

    // Delegate to shared helper for capture + element crop
    const capture = await captureVisibleTabWithElementCrop({
      tabId: tab.id,
      windowId: tab.windowId,
      tabUrl: tab.url,
      selector,
      cropToElement,
      padding,
    });

    let { dataUrl } = capture;

    // Get viewport dimensions (graceful degradation)
    let viewport: { width: number; height: number } | undefined;
    try {
      const viewportDimensions = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      });
      viewport = viewportDimensions[0]?.result ?? undefined;
    } catch (e) {
      console.warn(
        "[ScreenshotHighlight] Failed to get viewport dimensions:",
        e,
      );
    }

    if (sendToLLM) {
      // Compress for LLM
      dataUrl = await compressImage(dataUrl, 0.6, 1024);
    }

    // Extract image dimensions
    const { width: imageWidth, height: imageHeight } =
      await getImageSize(dataUrl);

    // Cache screenshot metadata for computer tool
    if (sendToLLM && viewport) {
      cacheScreenshotMetadata(
        tab.id,
        imageWidth,
        imageHeight,
        viewport.width,
        viewport.height,
      );
    }

    // Save screenshot to IndexedDB
    let screenshotUid: string | undefined;
    try {
      screenshotUid = await RuntimeScreenshotStorage.saveScreenshot(dataUrl, {
        tabId: tab.id,
        width: imageWidth,
        height: imageHeight,
        viewportWidth: viewport?.width ?? 0,
        viewportHeight: viewport?.height ?? 0,
      });
    } catch (err) {
      console.error("[ScreenshotHighlight] Failed to save to IndexedDB:", err);
    }

    if (sendToLLM) {
      return {
        success: true,
        imageData: dataUrl,
        sendToLLM: true,
        screenshotUid,
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        selector: selector ?? undefined,
        cropped: capture.cropped,
      };
    }

    return {
      success: true,
      captured: true,
      sendToLLM: false,
      screenshotUid,
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      selector: selector ?? undefined,
      cropped: capture.cropped,
    };
  },
});

export const captureScreenshotToClipboardTool = tool({
  name: "capture_screenshot_to_clipboard",
  description:
    "Capture screenshot of current tab and save directly to clipboard. NOTE: This tool requires focus mode.",
  parameters: z.object({}),
  execute: async () => {
    const mode = await getAutomationMode();
    console.log("🔧 [captureScreenshotToClipboard] Automation mode:", mode);

    // Background mode: reject screenshot
    if (mode === "background") {
      throw new Error(
        "Screenshot capture is disabled in background mode. Please switch to focus mode to use visual tools.",
      );
    }

    const tab = await getActiveTab();

    if (!tab.id || !tab.windowId) {
      throw new Error("No active tab found");
    }

    await chrome.windows.update(tab.windowId, { focused: true });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
      quality: 90,
    });

    const response = await fetch(dataUrl);
    const blob = await response.blob();

    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob,
      }),
    ]);

    return {
      success: true,
      message: "Screenshot copied to clipboard",
    };
  },
});

// ===================== Clipboard image tools (P1) =====================

export const readClipboardImageTool = tool({
  name: "read_clipboard_image",
  description:
    "Read an image from the system clipboard and return it as a base64 data URL. " +
    "Useful for inspecting images the user has copied. Returns an error if no image is present.",
  parameters: z.object({}),
  execute: async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();

      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            const blob = await item.getType(type);

            // Convert blob to data URL
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () =>
                reject(new Error("Failed to read image data"));
              reader.readAsDataURL(blob);
            });

            return {
              success: true,
              imageData: dataUrl,
            };
          }
        }
      }

      return { success: false, error: "No image found in clipboard" };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to read clipboard: ${message}`,
      };
    }
  },
});

export const getClipboardImageInfoTool = tool({
  name: "get_clipboard_image_info",
  description:
    "Check whether the system clipboard contains an image, and if so return " +
    "its MIME type. Does NOT read the full image data.",
  parameters: z.object({}),
  execute: async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();

      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            return {
              success: true,
              hasImage: true,
              imageType: type,
            };
          }
        }
      }

      return { success: true, hasImage: false };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to read clipboard: ${message}`,
      };
    }
  },
});
