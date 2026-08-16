import type { FunctionTool } from "@eterna/core";
import type { z } from "zod";
import {
  createBookmarkFolderTool,
  createBookmarkTool,
  deleteBookmarkTool,
  listBookmarksTool,
  searchBookmarksTool,
  updateBookmarkTool,
} from "./bookmark";
import { computerTool } from "./computer";
import {
  clickTool,
  fillElementByUidTool,
  fillFormTool,
  getEditorValueTool,
  hoverElementByUidTool,
} from "./element";
import { extractStructuredDataTool } from "./extract-structured-data";
import {
  getMostVisitedSitesTool,
  getRecentHistoryTool,
  searchHistoryTool,
} from "./history";
import { interventionTools } from "./interventions/index.js";
import { forgetTool, recallTool, rememberTool } from "./memory";
import {
  getPageMetadataTool,
  highlightElementTool,
  highlightTextInlineTool,
  scrollToElementTool,
} from "./page";
import { updatePlanTool } from "./plan";
import { readPageTool } from "./read-page";
import { readUrlTool } from "./read-url";
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
import {
  getRecentlyClosedSessionsTool,
  restoreSessionTool,
} from "./tools/sessions";
import {
  createTabGroupTool,
  deleteTabGroupTool,
  getAllTabGroupsTool,
  updateTabGroupTool,
} from "./tools/tab-groups";
import { uploadFileToInputTool } from "./tools/upload-file";
import { getYoutubeTranscriptTool } from "./youtube-transcript";

/**
 * All browser tools registered for AI use
 * Total: 57 tools (53 core + 4 intervention tools)
 *
 * Deliberately NOT registered:
 * - duplicate_tab (not in eterna)
 * - wait (replaced by computer tool's wait action)
 * - capture_screenshot_to_clipboard (not enabled in default bundle)
 * - read_clipboard_image / get_clipboard_image_info (P1 clipboard tools – require security review)
 * - download_text_as_markdown (not enabled in eterna)
 * - download_current_chat_images (architecture issue, not enabled in eterna)
 * - organize_tabs (stub implementation, disabled until AI grouping is complete;
 *   the agent can group tabs itself via get_all_tabs + create_tab_group)
 * - delete_bookmark_folder (recursive mass deletion – too destructive for the default bundle)
 * - delete_history_item / clear_history (destructive history wipes – not agent-safe by default)
 * - get_bookmark / get_history_stats (marginal value, kept out to limit prompt size)
 *
 * The MCP bridge advertises this exact set; mcp-schema-sync.test.ts enforces parity
 * with mcp-bridge/src/tool-schemas.ts.
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

  // Tab Groups (4 tools)
  getAllTabGroupsTool,
  createTabGroupTool,
  updateTabGroupTool,
  deleteTabGroupTool,

  // Recently closed sessions (2 tools)
  getRecentlyClosedSessionsTool,
  restoreSessionTool,

  // Bookmarks (6 tools)
  listBookmarksTool,
  searchBookmarksTool,
  createBookmarkTool,
  updateBookmarkTool,
  deleteBookmarkTool,
  createBookmarkFolderTool,

  // History (3 tools, read-only)
  getRecentHistoryTool,
  searchHistoryTool,
  getMostVisitedSitesTool,

  // UI Operations (8 tools) - computer tool replaces visual XY tools
  searchElementsTool,
  clickTool,
  fillElementByUidTool,
  getEditorValueTool,
  fillFormTool,
  hoverElementByUidTool,
  uploadFileToInputTool,
  computerTool,

  // Page Content & web (8 tools) — no app-level web search: models with
  // built-in web access use their own; read_url covers reading a given link.
  getPageMetadataTool,
  scrollToElementTool,
  highlightElementTool,
  highlightTextInlineTool,
  getYoutubeTranscriptTool,
  readUrlTool,
  readPageTool,
  extractStructuredDataTool,

  // Memory (3 tools)
  rememberTool,
  forgetTool,
  recallTool,

  // Plan (1 tool) — Codex-style visible todo list
  updatePlanTool,

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
// Skills tools are enabled to match eterna tool set

// Export intervention tools separately for optional registration
export { interventionTools } from "./interventions/index.js";

// Skill tools, re-exported for composing custom toolsets
export {
  renderSkillIndexForPrompt,
  resolveSkillTurnContexts,
  skillTools,
} from "./skill.js";

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
  importLocalMemoriesOnce,
  loadMemories,
  type MemoryEntry,
  renderMemoriesForPrompt,
} from "./memory";
export { captureViewportForAmbient } from "./screenshot";
export {
  type ConversationTurn,
  captureConversationToSupermemory,
  fetchSupermemoryProfileCached,
  loadSupermemoryConfig,
  renderProfileForPrompt,
  type SupermemoryConfig,
  type SupermemoryProfile,
} from "./supermemory-client";
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
