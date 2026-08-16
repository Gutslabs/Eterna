/**
 * Utility functions and classes
 */

export { CancellationError, CancellationToken } from "./cancellation-token.js";
export {
  isTransientScreenshotItem,
  pruneTransientScreenshotItems,
  shapeScreenshotItems,
  stripImageInputs,
  TRANSIENT_SCREENSHOT_MARKER,
  VISION_FALLBACK_TEXT,
} from "./screenshot-shaping.js";
