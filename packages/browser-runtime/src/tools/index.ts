import type { FunctionTool } from "@aipexstudio/aipex-core";
import type { z } from "zod";
import { computerTool } from "./computer";
import {
  clickTool,
  fillElementByUidTool,
  fillFormTool,
  getEditorValueTool,
  hoverElementByUidTool,
} from "./element";
import { interventionTools } from "./interventions/index.js";
import {
  getPageMetadataTool,
  highlightElementTool,
  highlightTextInlineTool,
  scrollToElementTool,
} from "./page";
import {
  captureScreenshotTool,
  captureScreenshotWithHighlightTool,
  captureTabScreenshotTool,
} from "./screenshot";
// Clipboard image tools – available but not registered in the default bundle.
// Enable explicitly if the product decides to ship clipboard access.
// import {
//   captureScreenshotToClipboardTool,
//   readClipboardImageTool,
//   getClipboardImageInfoTool,
// } from "./screenshot";
import { skillTools } from "./skill";
import { searchElementsTool } from "./snapshot";
import {
  closeTabTool,
  createNewTabTool,
  getAllTabsTool,
  getCurrentTabTool,
  getTabInfoTool,
  switchToTabTool,
  ungroupTabsTool,
} from "./tab";
import { downloadChatImagesTool, downloadImageTool } from "./tools/downloads";
import { uploadFileToInputTool } from "./tools/upload-file";
import { getYoutubeTranscriptTool } from "./youtube-transcript";

/**
 * All browser tools registered for AI use
 * Total: 35 tools (31 core + 4 intervention tools)
 *
 * Disabled tools (per aipex):
 * - duplicate_tab (not in aipex)
 * - wait (replaced by computer tool's wait action)
 * - capture_screenshot_to_clipboard (not enabled in aipex default bundle)
 * - read_clipboard_image (P1 clipboard tool – not enabled by default; requires security review)
 * - get_clipboard_image_info (P1 clipboard tool – not enabled by default; requires security review)
 * - download_text_as_markdown (not enabled in aipex)
 * - download_current_chat_images (architecture issue, not enabled in aipex)
 * - organize_tabs (stub implementation, temporarily disabled until AI grouping is complete)
 */
type BrowserFunctionTool = FunctionTool<
  unknown,
  z.ZodObject<any, any>,
  unknown
>;

const browserFunctionTools: BrowserFunctionTool[] = [
  // Browser/Tab Management (7 tools)
  // Note: organize_tabs temporarily disabled (stub/not shipped)
  getAllTabsTool,
  getCurrentTabTool,
  switchToTabTool,
  createNewTabTool,
  getTabInfoTool,
  closeTabTool,
  ungroupTabsTool,

  // UI Operations (8 tools) - computer tool replaces visual XY tools
  searchElementsTool,
  clickTool,
  fillElementByUidTool,
  getEditorValueTool,
  fillFormTool,
  hoverElementByUidTool,
  uploadFileToInputTool,
  computerTool,

  // Page Content (5 tools)
  getPageMetadataTool,
  scrollToElementTool,
  highlightElementTool,
  highlightTextInlineTool,
  getYoutubeTranscriptTool,

  // Screenshot (3 tools)
  captureScreenshotTool,
  captureScreenshotWithHighlightTool,
  captureTabScreenshotTool,

  // Download (2 tools)
  downloadImageTool,
  downloadChatImagesTool,

  // Intervention (4 tools)
  ...interventionTools,

  // Skills (6 tools)
  ...skillTools,
] as const;

export const allBrowserTools: FunctionTool[] =
  browserFunctionTools as unknown as FunctionTool[];

export type { BrowserFunctionTool };

// Note: takeSnapshotTool is not included in allBrowserTools as it's called internally
// Skills tools are enabled to match aipex tool set

// Export intervention tools separately for optional registration
export { interventionTools } from "./interventions/index.js";

// Skill tools, re-exported for composing custom toolsets (e.g. research subagents)
export { skillTools } from "./skill.js";

interface ToolRegistryLike {
  register(tool: (typeof allBrowserTools)[number]): unknown;
}

/**
 * Register all default browser tools with a registry-like object
 */
export function registerDefaultBrowserTools<T extends ToolRegistryLike>(
  registry: T,
): T {
  for (const tool of allBrowserTools) {
    registry.register(tool);
  }
  return registry;
}

export {
  executeScriptInActiveTab,
  executeScriptInTab,
  getActiveTab,
} from "./tab-utils";
export {
  TWITTER_SERVICE_URL,
  type Tweet,
  twitterResearchTools,
  twitterSearchTool,
  twitterUserTool,
} from "./twitter";
export {
  htmlToText,
  parseDuckDuckGoHtml,
  type WebSearchResult,
  webFetchTool,
  webResearchTools,
  webSearchTool,
} from "./web";
export {
  fetchYoutubeTranscriptForTab,
  isYoutubeVideoUrl,
  type TranscriptSegment,
  type YoutubeTranscriptFetch,
} from "./youtube-transcript";
export {
  buildTranscriptWindows,
  extractYoutubeVideoId,
  formatTimecode,
  getYoutubeTranscriptWindows,
  prefetchYoutubeTranscript,
  TRANSCRIPT_WINDOW_SECONDS,
  type TranscriptWindow,
  type YoutubeTranscriptWindows,
} from "./youtube-transcript-chunks";
