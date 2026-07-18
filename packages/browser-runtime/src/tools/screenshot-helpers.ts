/**
 * Shared screenshot helpers.
 *
 * This module is intentionally kept free of imports from `./index` or any
 * module that participates in the tools ↔ screenshot circular-import chain.
 * Both `captureScreenshotWithHighlightTool` (in screenshot.ts) and
 * `ElementCaptureService` (in intervention/element-capture.ts) import from
 * here without triggering a cycle.
 */

/** Maximum padding in pixels */
export const MAX_PADDING = 200;

// ===================== Image utilities (service-worker safe) =====================
//
// The agent — and therefore these tools — runs in the background service worker,
// which has NO DOM: `Image`, `document` and HTMLCanvasElement are undefined.
// Using `new Image()` here threw "ReferenceError: Image is not defined" and broke
// every screenshot tool. `createImageBitmap` + `OffscreenCanvas` are the
// worker-safe equivalents.

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return await (await fetch(dataUrl)).blob();
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return `data:${blob.type || "image/png"};base64,${arrayBufferToBase64(buffer)}`;
}

/** Decode a data-URL image and return its pixel dimensions. */
export async function getImageSize(
  dataUrl: string,
): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(await dataUrlToBlob(dataUrl));
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/** Downscale (if wider than maxWidth) and re-encode as JPEG at the given quality. */
export async function compressImage(
  dataUrl: string,
  quality = 0.6,
  maxWidth = 1024,
): Promise<string> {
  const bitmap = await createImageBitmap(await dataUrlToBlob(dataUrl));
  try {
    let width = bitmap.width;
    let height = bitmap.height;
    if (width > maxWidth) {
      height = Math.round((height * maxWidth) / width);
      width = maxWidth;
    }
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get canvas context");
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    return await blobToDataUrl(blob);
  } finally {
    bitmap.close();
  }
}

/** Crop a data-URL image to a pixel region. */
export async function cropImage(
  dataUrl: string,
  region: { x: number; y: number; width: number; height: number },
): Promise<string> {
  const bitmap = await createImageBitmap(await dataUrlToBlob(dataUrl));
  try {
    const canvas = new OffscreenCanvas(region.width, region.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get canvas context");
    }
    ctx.drawImage(
      bitmap,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      region.width,
      region.height,
    );
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return await blobToDataUrl(blob);
  } finally {
    bitmap.close();
  }
}

// ===================== Shared capture helper =====================

/**
 * Options for the shared capture + element-crop helper.
 */
export interface CaptureWithElementCropOptions {
  tabId: number;
  windowId: number;
  tabUrl?: string;
  /** CSS selector of the element to focus on. Max length enforced by callers. */
  selector?: string;
  /** Whether to crop the screenshot to the element bounding box (plus padding). */
  cropToElement?: boolean;
  /** Padding around the element in CSS pixels when cropping (default 50, max 200). */
  padding?: number;
}

/**
 * Result returned by the shared capture helper.
 */
export interface CaptureWithElementCropResult {
  /** The captured (and optionally cropped) image as a data URL. */
  dataUrl: string;
  /** True if the image was actually cropped to the element. */
  cropped: boolean;
  /** True if the selector matched an element on the page. */
  elementFound: boolean;
}

/**
 * Core logic for capturing the visible tab and optionally cropping to an
 * element identified by CSS selector.
 *
 * This is shared by `captureScreenshotWithHighlightTool` (the agent-facing
 * tool) and `ElementCaptureService.captureScreenshot` so that both use the
 * same element-rect resolution, DPR scaling, and crop logic.
 *
 * Security notes:
 * - Rejects browser-internal pages (chrome://, edge://, about:, extension://).
 * - Selector length must be bounded by the caller (tool uses zod `.max()`).
 * - Padding is clamped to [0, MAX_PADDING].
 */
export async function captureVisibleTabWithElementCrop(
  options: CaptureWithElementCropOptions,
): Promise<CaptureWithElementCropResult> {
  const {
    tabId,
    windowId,
    tabUrl,
    selector,
    cropToElement = false,
    padding = 50,
  } = options;

  // Reject restricted pages
  if (
    tabUrl &&
    (tabUrl.startsWith("chrome://") ||
      tabUrl.startsWith("chrome-extension://") ||
      tabUrl.startsWith("edge://") ||
      tabUrl.startsWith("about:"))
  ) {
    throw new Error("Cannot capture browser internal pages");
  }

  // Clamp padding to safe range
  const safePadding = Math.max(0, Math.min(padding, MAX_PADDING));

  // If a selector is provided, resolve the element rect via content script
  let elementRect: {
    x: number;
    y: number;
    width: number;
    height: number;
    devicePixelRatio: number;
  } | null = null;

  if (selector) {
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel: string) => {
          const element = document.querySelector(sel);
          if (!element) return null;

          const rect = element.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;

          return {
            x: rect.x * dpr,
            y: rect.y * dpr,
            width: rect.width * dpr,
            height: rect.height * dpr,
            devicePixelRatio: dpr,
          };
        },
        args: [selector],
      });

      if (result[0]?.result) {
        elementRect = result[0].result;
      }
    } catch (err) {
      console.warn("[Screenshot] Failed to get element rect:", err);
      // Continue with full-page screenshot if selector fails
    }
  }

  // Focus window and capture
  await chrome.windows.update(windowId, { focused: true });
  await new Promise((resolve) => setTimeout(resolve, 100));

  let dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: "png",
    quality: 90,
  });

  if (!dataUrl || !dataUrl.startsWith("data:image/")) {
    throw new Error("Invalid image data captured");
  }

  const cropped = !!(cropToElement && elementRect);

  // Crop to element if requested and the element was found
  if (cropToElement && elementRect) {
    const dpr = elementRect.devicePixelRatio || 1;
    const scaledPadding = safePadding * dpr;

    // Load image to get actual dimensions for bounds checking
    const { width: imgWidth, height: imgHeight } = await getImageSize(dataUrl);

    const x = Math.max(0, Math.round(elementRect.x - scaledPadding));
    const y = Math.max(0, Math.round(elementRect.y - scaledPadding));
    const maxWidth = imgWidth - x;
    const maxHeight = imgHeight - y;
    const width = Math.min(
      Math.round(elementRect.width + scaledPadding * 2),
      maxWidth,
    );
    const height = Math.min(
      Math.round(elementRect.height + scaledPadding * 2),
      maxHeight,
    );

    if (width > 0 && height > 0) {
      dataUrl = await cropImage(dataUrl, { x, y, width, height });
    }
  }

  return { dataUrl, cropped, elementFound: !!elementRect };
}
