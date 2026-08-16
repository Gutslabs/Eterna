import type { CdpCommander } from "./cdp-commander";

export type Rect = { x: number; y: number; width: number; height: number };

export function quadToRect(quad: number[]): Rect | null {
  if (!Array.isArray(quad) || quad.length < 8) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < 8; i += 2) {
    const x = quad[i];
    const y = quad[i + 1];
    if (typeof x !== "number" || typeof y !== "number") continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Add highlight to element during operation
 */
export async function addHighlightToElement(
  cdpCommander: CdpCommander,
  objectId: string,
): Promise<void> {
  try {
    await cdpCommander.sendCommand("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function() {
          // Find editor container (Monaco or the element itself)
          const container = this.closest('.monaco-editor') || this;

          // Store original styles
          if (!container._eternaOriginalStyles) {
            container._eternaOriginalStyles = {
              outline: container.style.outline,
              outlineOffset: container.style.outlineOffset,
              transition: container.style.transition
            };
          }

          // Add highlight effect
          container.style.transition = 'outline 0.2s ease';
          container.style.outline = '3px solid #3B82F6';
          container.style.outlineOffset = '2px';
        }`,
      returnByValue: false,
    });
  } catch (error) {
    console.warn("Failed to add highlight:", error);
  }
}

/**
 * Remove highlight from element
 */
export async function removeHighlightFromElement(
  cdpCommander: CdpCommander,
  objectId: string,
): Promise<void> {
  try {
    await cdpCommander.sendCommand("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function() {
          const container = this.closest('.monaco-editor') || this;

          // Restore original styles
          if (container._eternaOriginalStyles) {
            container.style.outline = container._eternaOriginalStyles.outline;
            container.style.outlineOffset = container._eternaOriginalStyles.outlineOffset;
            container.style.transition = container._eternaOriginalStyles.transition;
            delete container._eternaOriginalStyles;
          }
        }`,
      returnByValue: false,
    });

    // Schedule cleanup after animation
    setTimeout(() => {
      cdpCommander
        .sendCommand("Runtime.releaseObject", { objectId })
        .catch(() => {});
    }, 300);
  } catch (error) {
    console.warn("Failed to remove highlight:", error);
  }
}
