/**
 * Static MCP tool schemas for the bridge.
 *
 * These mirror the registered tools in
 * packages/browser-runtime/src/tools/index.ts (allBrowserTools) but are
 * expressed as plain JSON Schema so the bridge has zero dependency on the
 * extension runtime (no Zod, no Chrome APIs).
 *
 * When tools are added/removed in the extension, update this file accordingly.
 * The sync test at packages/browser-runtime/src/tools/mcp-schema-sync.test.ts
 * fails if this list drifts from the registered tool set.
 */

import { bookmarkToolSchemas } from "./tool-schemas/bookmarks.js";
import { browserToolSchemas } from "./tool-schemas/browser.js";
import { downloadToolSchemas } from "./tool-schemas/downloads.js";
import { historyToolSchemas } from "./tool-schemas/history.js";
import { interventionToolSchemas } from "./tool-schemas/interventions.js";
import { memoryToolSchemas } from "./tool-schemas/memory.js";
import { pageToolSchemas } from "./tool-schemas/page.js";
import { screenshotToolSchemas } from "./tool-schemas/screenshots.js";
import { sessionToolSchemas } from "./tool-schemas/sessions.js";
import { skillToolSchemas } from "./tool-schemas/skills.js";
import { tabGroupToolSchemas } from "./tool-schemas/tab-groups.js";
import type { ToolSchema } from "./tool-schemas/types.js";
import { uiToolSchemas } from "./tool-schemas/ui.js";

export type { ToolSchema } from "./tool-schemas/types.js";

export const toolSchemas: ToolSchema[] = [
  ...browserToolSchemas,
  ...tabGroupToolSchemas,
  ...sessionToolSchemas,
  ...bookmarkToolSchemas,
  ...historyToolSchemas,
  ...uiToolSchemas,
  ...pageToolSchemas,
  ...memoryToolSchemas,
  ...screenshotToolSchemas,
  ...downloadToolSchemas,
  ...interventionToolSchemas,
  ...skillToolSchemas,
];
