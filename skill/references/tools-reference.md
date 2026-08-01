# Eterna Browser Tools Reference

Complete parameter schemas for all 56 Eterna MCP tools exposed via `eterna-mcp-bridge`.

> Generated from `mcp-bridge/src/tool-schemas.ts`, which is kept in sync with the extension's registered tool set by `packages/browser-runtime/src/tools/mcp-schema-sync.test.ts`.

---

## Tab Management

### `get_all_tabs`

Get all open tabs across all windows with their IDs, titles, and URLs

**Parameters:** none

---

### `get_current_tab`

Get information about the currently active tab

**Parameters:** none

---

### `switch_to_tab`

Switch to a specific tab by ID

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tabId` | number | yes | The ID of the tab to switch to |

---

### `create_new_tab`

Create a new tab with the specified URL

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | The URL to open in the new tab |

---

### `get_tab_info`

Get detailed information about a specific tab

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tabId` | number | yes | The ID of the tab |

---

### `close_tab`

Close a specific tab

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tabId` | number | yes | The ID of the tab to close |

---

### `ungroup_tabs`

Remove all tab groups in the current window

**Parameters:** none

---

## Tab Groups

### `get_all_tab_groups`

Get all tab groups across all windows

**Parameters:** none

---

### `create_tab_group`

Create a new tab group with specified tabs

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tabIds` | array | yes | Array of tab IDs to group |
| `title` | string | no | Title for the tab group |
| `color` | `blue` \\| `red` \\| `yellow` \\| `green` \\| `orange` \\| `purple` \\| `pink` \\| `cyan` \\| `grey` | no | Color for the tab group |

---

### `update_tab_group`

Update tab group properties (title, color, collapsed state)

| Parameter | Type | Required | Description |
|---|---|---|---|
| `groupId` | number | yes | ID of the tab group to update |
| `title` | string | no | New title for the tab group |
| `color` | `blue` \\| `red` \\| `yellow` \\| `green` \\| `orange` \\| `purple` \\| `pink` \\| `cyan` \\| `grey` | no | New color for the tab group |
| `collapsed` | boolean | no | Whether the tab group should be collapsed |

---

### `delete_tab_group`

Delete a tab group (ungroups all tabs in the group)

| Parameter | Type | Required | Description |
|---|---|---|---|
| `groupId` | number | yes | ID of the tab group to delete |

---

## Recently Closed Sessions

### `get_recently_closed`

List recently closed tabs and windows with their session IDs, so a specific one can be restored with restore_session.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `maxResults` | number | no | Maximum number of entries to return (default: all, max 25) |

---

### `restore_session`

Reopen a recently closed tab or window. Pass a session ID from get_recently_closed, or omit it to restore the most recently closed entry.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | no | Session ID from get_recently_closed. Omit to restore the most recently closed tab/window. |

---

## Bookmarks

### `list_bookmarks`

Get all bookmarks in a flattened list

**Parameters:** none

---

### `search_bookmarks`

Search bookmarks by title or URL

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Search query |

---

### `create_bookmark`

Create a new bookmark

| Parameter | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes | Bookmark title |
| `url` | string | yes | Bookmark URL |
| `parentId` | string | no | Parent folder ID (defaults to bookmarks bar) |

---

### `update_bookmark`

Update bookmark properties

| Parameter | Type | Required | Description |
|---|---|---|---|
| `bookmarkId` | string | yes | The bookmark ID to update |
| `title` | string | no | New title |
| `url` | string | no | New URL |

---

### `delete_bookmark`

Delete a bookmark by ID

| Parameter | Type | Required | Description |
|---|---|---|---|
| `bookmarkId` | string | yes | The bookmark ID to delete |

---

### `create_bookmark_folder`

Create a new bookmark folder

| Parameter | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes | Folder title |
| `parentId` | string | no | Parent folder ID (defaults to bookmarks bar) |

---

## History (read-only)

### `get_recent_history`

Get recent browsing history (last 7 days)

| Parameter | Type | Required | Description |
|---|---|---|---|
| `limit` | number | no | Maximum number of history items to return |

---

### `search_history`

Search browsing history

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Search query |
| `limit` | number | no | Maximum number of results |

---

### `get_most_visited_sites`

Get the most visited sites in the last 30 days

| Parameter | Type | Required | Description |
|---|---|---|---|
| `limit` | number | no | Maximum number of sites to return |

---

## UI Interaction

### `search_elements` ← **Use First**

[FAST - USE FIRST] Search for elements in the current page using glob/grep patterns against the DOM snapshot. Returns matching elements with their UIDs for direct UID-based interaction.

GLOB SYNTAX:
- * matches any characters (e.g. button* finds all buttons)
- ? matches exactly one character
- [abc] matches any of those characters
- {a,b,c} matches any of those alternatives (e.g. {button,input}* finds all buttons and inputs)
- Patterns are case-sensitive by default; use [Ll] to match both cases

STARTER QUERIES:
- Broad scan:      {button,link,input,StaticText}*
- All interactive: {button,input,textarea,select,a}*
- Login/auth:      *[Ll]ogin*, *[Ss]ign*
- Submit/save:     *[Ss]ubmit*, *[Ss]ave*, *[Cc]onfirm*
- Search boxes:    *[Ss]earch*, {input,textarea}*
- Navigation:      {nav,link,a}*

WORKFLOW:
1. Call search_elements with a broad pattern to discover elements
2. Elements in the result have uid= attributes (e.g. uid=btn-42)
3. Pass that UID to click(tabId, uid) or fill_element_by_uid(tabId, uid, value)
4. If 0 results after 2 different patterns, fall back to capture_screenshot(sendToLLM=true)

This is the PREFERRED first step — much faster and cheaper than screenshots.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tabId` | number | yes | The ID of the tab to search the elements in |
| `query` | string | yes | Search query string with grep/glob pattern support |
| `contextLevels` | number | no | Number of context lines to include |

---

### `click`

Click an element using its unique UID from a snapshot

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tabId` | number | yes | The ID of the tab to click on |
| `uid` | string | yes | The unique identifier of an element from the page snapshot |
| `dblClick` | boolean | no | Set to true for double clicks |

---

### `fill_element_by_uid`

Fill an input element using its unique UID from a snapshot

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tabId` | number | yes | The ID of the tab to fill the element in |
| `uid` | string | yes | The unique identifier of the element to fill |
| `value` | string | yes | The value to fill into the element |

---

### `fill_form`

Fill multiple form elements at once using their UIDs from a snapshot

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tabId` | number | yes | The ID of the tab to fill the elements in |
| `elements` | array | yes | Array of elements to fill with their UIDs and values |

---

### `get_editor_value`

Get the complete content from a code editor (Monaco, CodeMirror, ACE) or textarea without truncation. Use this before filling to avoid data loss.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tabId` | number | yes | The ID of the tab |
| `uid` | string | yes | The unique identifier of the editor element from snapshot |

---

### `hover_element_by_uid`

Hover over an element using its unique UID from a snapshot

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tabId` | number | yes | The ID of the tab to hover over |
| `uid` | string | yes | The unique identifier of the element to hover over |

---

### `upload_file_to_input`

Upload a pre-attached file to a file input element (<input type="file">) on the page.

PREREQUISITES:
- The user must have already attached a file using the attachment button in the Eterna sidebar BEFORE sending the message
- The file content is NEVER sent to the AI (privacy guaranteed)

WORKFLOW:
1. Call this tool with just the tabId — the tool automatically finds the file input (including hidden ones)
2. If the page has multiple file inputs, use input_index to select which one (0 = first)
3. Optionally provide uid from a snapshot if you know the exact element

NOTE: Most websites hide the actual <input type="file"> behind a styled button. This tool handles both visible and hidden file inputs automatically — no need to find the element UID first.

AFTER UPLOAD: take a screenshot to verify the file was accepted, then proceed to submit the form.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tabId` | number | yes | The ID of the tab containing the file input element |
| `uid` | string | no | UID of the <input type='file'> element from the page snapshot. OPTIONAL — if omitted or the element is hidden, the tool automatically finds the file input by CSS selector. |
| `input_index` | number | no | 0-based index to select which file input to target when the page has multiple. Defaults to 0. Only used when uid is not provided or not found. |
| `file_id` | string | no | ID of the specific attached file to use (the 'ref' value from the [Attached file...] message). Omit to use the most recently attached file. |
| `file_path` | string | no | Absolute local file path to upload directly (e.g. '/Users/me/resume.pdf'). Uses CDP DOM.setFileInputFiles — no file content is read into memory. Takes priority over file_id and pre-attached files when provided. |

---

### `computer` ← **High-Cost Fallback**

[HIGH-COST FALLBACK] Coordinate-based mouse/keyboard interaction using screenshot pixels.

PREFER UID-BASED TOOLS FIRST: For clicking buttons, filling forms, or hovering elements, use search_elements to get UIDs, then use click/fill_element_by_uid/hover_element_by_uid. These are faster and more reliable.

USE THIS TOOL ONLY WHEN:
- search_elements returned 0 matches after trying 2 different query patterns
- UID-based actions failed twice (element not interactable)
- The goal requires visual/pixel-level interaction: canvas apps, drag-and-drop, sliders, charts, hover-only menus

PREREQUISITE: If you choose coordinate actions, you MUST first call capture_screenshot(sendToLLM=true). Coordinates are in screenshot pixel space.

* Click element centers, not edges. Adjust if clicks miss.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | `left_click` \\| `right_click` \\| `type` \\| `scroll` \\| `key` \\| `left_click_drag` \\| `double_click` \\| `triple_click` \\| `scroll_to` \\| `hover` | yes | The action to perform: * `left_click`: Click the left mouse button at the specified coordinates. * `right_click`: Click the right mouse button at the specified coordinates to open context menus. * `double_click`: Double-click the left mouse button at the specified coordinates. * `triple_click`: Triple-click the left mouse button at the specified coordinates. * `type`: Type a string of text at the current cursor position. * `scroll`: Scroll up, down, left, or right at the specified coordinates. * `key`: Press a specific keyboard key or key combination. * `left_click_drag`: Drag from start_coordinate to coordinate. * `scroll_to`: Scroll an element into view using its element UID from snapshot. * `hover`: Move the mouse cursor to the specified coordinates without clicking. Useful for revealing tooltips, dropdown menus, or triggering hover states. |
| `coordinate` | array | no | (x, y): The x (pixels from the left edge) and y (pixels from the top edge) coordinates in screenshot pixel space. Required for left_click, right_click, double_click, triple_click, scroll, and hover. For left_click_drag, this is the end position. |
| `text` | string | no | The text to type (for type action) or the key(s) to press (for key action). For key action: Provide space-separated keys (e.g., "Backspace Backspace Delete"). Supports keyboard shortcuts using the platform modifier key (use "cmd" on Mac, "ctrl" on Windows/Linux, e.g., "cmd+a" for select all). Common keys: Enter, Tab, Escape, ArrowUp/Down/Left/Right, Backspace, Delete. |
| `start_coordinate` | array | no | Starting coordinates for left_click_drag action in screenshot pixel space. |
| `scroll_direction` | `up` \\| `down` \\| `left` \\| `right` | no | Direction to scroll for scroll action. |
| `scroll_amount` | number | no | Number of pixels to scroll. Defaults to ~2 viewport heights for standard scrolling. |
| `tabId` | number | no | The ID of the tab to operate on. Defaults to current active tab. |
| `uid` | string | no | Element UID from snapshot for scroll_to action. |

---

## Page Content & Web

### `get_page_metadata`

Get page metadata including title, description, keywords, etc.

**Parameters:** none

---

### `scroll_to_element`

Scroll to a DOM element and center it in the viewport

| Parameter | Type | Required | Description |
|---|---|---|---|
| `selector` | string | yes | CSS selector of the element to scroll to |

---

### `highlight_element`

Permanently highlight DOM elements with drop shadow effect

| Parameter | Type | Required | Description |
|---|---|---|---|
| `selector` | string | yes | CSS selector of the element to highlight |
| `color` | string | no | Shadow color (e.g., '#00d4ff') |
| `duration` | number | no | Duration in milliseconds (0 = permanent) |
| `intensity` | `subtle` \\| `normal` \\| `strong` | no |  |
| `persist` | boolean | no | Whether to keep the highlight permanently |

---

### `highlight_text_inline`

Highlight specific words or phrases within text content using inline styling

| Parameter | Type | Required | Description |
|---|---|---|---|
| `selector` | string | yes | CSS selector of the element(s) containing the text to search |
| `searchText` | string | yes | The text or phrase to highlight |
| `caseSensitive` | boolean | no |  |
| `wholeWords` | boolean | no |  |
| `highlightColor` | string | no |  |
| `backgroundColor` | string | no |  |
| `fontWeight` | string | no |  |
| `persist` | boolean | no |  |

---

### `get_youtube_transcript`

Fetch the full transcript (captions) of the YouTube video in the user's current tab. Use this whenever the user wants to summarize, explain, translate, quote, or ask questions about the YouTube video they are watching. Returns the complete transcript text and video metadata. Only works on a youtube.com/watch, youtu.be, /shorts or /live page.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `language` | string | no | Optional BCP-47 language code (e.g. 'en', 'tr') to prefer a specific caption track. If omitted, the original/manual track is preferred, then auto-generated captions. |
| `includeTimestamps` | boolean | no | When true, also return per-line timestamps (segments). Leave false/omitted for summaries to save tokens; set true when the user asks about specific moments or timestamps. |

---

### `read_page`

Read the main content of the page open in the active tab, as clean Markdown. Use this when you need the full text of the current page — it reads the complete article from the live DOM (works on SPAs too). Long pages come back as a heading outline plus the first chunk; pass `section` (a heading from the outline) or `offset` (from a prior result's nextOffset) to read further. For a link that is NOT currently open, use read_url instead.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `section` | string | no | Jump to the section under this heading (match a line from the outline). For long pages only. |
| `offset` | number | no | Character offset to continue from — pass a prior result's nextOffset to read the next chunk. |

---

### `read_url`

Fetch a web page by its URL and return the main content as clean Markdown (with title, author, site and word count when available). Use this to read or summarize a link when it is NOT the page already open in the browser. Handles articles, blog posts, docs, PDFs, GitHub, Reddit and X/Twitter threads; not for pages that require a login.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | Absolute http(s) URL of the page to read. |

---

### `extract_structured_data`

Pull specific named fields from a page. Give the fields you want (each with a short hint) and optionally a URL; it returns the page's main content as Markdown plus the list of fields to fill, so you can read off exact values (price, sku, author, date, rating, availability…) instead of eyeballing the whole article. Defaults to the current active tab; pass a URL to target another page. For freeform reading use read_page (current page) or read_url (a link).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `fields` | array | yes | The fields to pull from the page. Each item is an object with 'name' (e.g. 'price') and an optional 'hint' (e.g. 'current price with currency'). |
| `url` | string | no | Page to read; omit to use the current active tab. |

---

### `web_search`

Search the web in the background and return the top results (title, url, snippet). Does not open a tab or change what the user sees. Use this to find pages, then read them with read_url.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | The search query |
| `limit` | number | no | Max results to return (default 8, max 20) |

---

## Memory

### `remember`

Save a durable fact about the user or their preferences to long-term memory so you recall it in future conversations. Use it when the user shares a lasting preference or fact, or asks you to remember something. Do NOT save transient or conversation-specific details. Keep each memory to one concise sentence.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `content` | string | yes | The fact to remember, as one concise sentence. |

---

### `forget`

Remove a fact from long-term memory by its id. Use when a saved memory is wrong, outdated, or the user asks you to forget it.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | The id of the memory to remove (e.g. 'mem-...'). |

---

## Screenshots

### `capture_screenshot`

[HIGH-COST FALLBACK] Capture screenshot of current visible tab.

TRY search_elements FIRST: For most interactions (clicking, filling, reading), use search_elements + UID-based tools. They are faster and don't send images to LLM.

USE THIS ONLY WHEN:
- search_elements cannot find the target after 2 query attempts
- You need to see visual layout, images, charts, or canvas content
- The page uses non-standard rendering that snapshots miss

When sendToLLM=true: Sends image to LLM (higher latency/cost, may capture sensitive on-screen data) and enables the computer tool for coordinate-based actions.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sendToLLM` | boolean | no | Whether to send the screenshot to LLM for visual analysis. When true, enables computer tool for coordinate actions. Use sparingly - adds latency and token cost. |

---

### `capture_screenshot_with_highlight`

[HIGH-COST] Capture screenshot of the current visible tab, optionally highlighting and cropping to a specific element identified by CSS selector. The screenshot is always sent to the LLM for visual analysis. PREFER search_elements for finding/interacting with elements. Use this only when you need to visually verify element appearance or layout. NOTE: This tool requires focus mode.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `selector` | string | no | CSS selector of element to highlight/focus on |
| `cropToElement` | boolean | no | Whether to crop the screenshot to the element region (plus padding) |
| `padding` | number | no | Padding around element in pixels when cropping (default: 50) |
| `sendToLLM` | boolean | no | Whether to send the screenshot to LLM for visual analysis. Defaults to true. |

---

### `capture_tab_screenshot`

[HIGH-COST FALLBACK] Capture screenshot of a specific tab by ID.

TRY search_elements FIRST: For most interactions, use search_elements + UID-based tools instead.

USE THIS ONLY WHEN: Visual verification is essential, search_elements failed, or you need to see images/charts/canvas.

When sendToLLM=true: Sends image to LLM (higher latency/cost) and enables coordinate-based actions.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tabId` | number | yes | The ID of the tab to capture |
| `sendToLLM` | boolean | no | Whether to send the screenshot to LLM for visual analysis. When true, enables computer tool. Use sparingly. |

---

## Downloads

### `download_image`

Download an image from base64 data to the user's local filesystem

| Parameter | Type | Required | Description |
|---|---|---|---|
| `imageData` | string | yes | The base64 image data URL (data:image/...) |
| `filename` | string | no | Descriptive filename for the download (without extension) |
| `folderPath` | string | no | Optional folder path for organizing downloads |

---

### `download_chat_images`

Download multiple images from chat messages to the user's local filesystem

| Parameter | Type | Required | Description |
|---|---|---|---|
| `messages` | array | yes | Array of chat messages containing images |
| `folderPrefix` | string | no | Descriptive folder name for organizing downloads |
| `filenamingStrategy` | `descriptive` \\| `sequential` \\| `timestamp` | no |  |
| `displayResults` | boolean | no | Whether to display the download results |

---

## Human Intervention

### `list_interventions`

List all available human intervention tools. Use this to discover what types of human input you can request.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `enabledOnly` | boolean | no | If true, only return enabled interventions |

---

### `get_intervention_info`

Get detailed information about a specific intervention type, including its input/output schema and examples.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `type` | string | yes | The type of intervention to get information about (e.g., "monitor-operation", "voice-input", "user-selection") |

---

### `request_intervention`

Request human intervention during task execution. This allows you to ask the user to click on an element, provide voice input, or make a selection. IMPORTANT: Only use this when absolutely necessary and when the current conversation mode allows interventions.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `type` | string | yes | The type of intervention to request (e.g., "monitor-operation", "voice-input", "user-selection") |
| `params` | any | no | Type-specific parameters for the intervention |
| `timeout` | number | no | Timeout in seconds (default: 300) |
| `reason` | string | no | A clear explanation to the user about why you need their input |

---

### `cancel_intervention`

Cancel the currently active intervention request.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string | no | Optional intervention ID to cancel. If not provided, cancels the current active intervention. |

---

## Skills

### `list_skills`

List all available skills in the system. Shows enabled skills by default, or all skills if specified.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `enabledOnly` | boolean | no | If true, only show enabled skills. Default: false |

---

### `get_skill_info`

Get detailed information about a specific skill, including its scripts, references, assets, and metadata.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `skillName` | string | yes | The name of the skill |

---

### `load_skill`

Load the main content (SKILL.md) of a skill. Use this to understand what a skill does, its capabilities, available scripts, and how to use it.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | The name of the skill to load |

---

### `execute_skill_script`

Execute a script that belongs to a skill. Scripts are located in the scripts/ directory of the skill package and can perform various operations.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `skillName` | string | yes | The name of the skill |
| `scriptPath` | string | yes | The path to the script file (e.g., "scripts/init_skill.js"), MUST start with "scripts/" |
| `args` | any | no | Arguments to pass to the script |

---

### `read_skill_reference`

Read a reference document from a skill. Reference files are located in the references/ directory and contain additional documentation, guides, or examples.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `skillName` | string | yes | The name of the skill |
| `refPath` | string | yes | The path to the reference file (e.g., "references/guide.md"), MUST start with "references/" |

---

### `get_skill_asset`

Get an asset file from a skill. Assets are located in the assets/ directory and can be images, data files, or other resources.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `skillName` | string | yes | The name of the skill |
| `assetPath` | string | yes | The path to the asset file (e.g., "assets/icon.png"), MUST start with "assets/" |

---

## Tool Selection Decision Tree

```
Need to interact with a page element?
│
├── YES ──▶ search_elements(tabId, pattern)
│              │
│              ├── Found UIDs? ──▶ YES ──▶ click / fill_element_by_uid / hover_element_by_uid
│              │
│              └── No results after 2 different queries?
│                   └──▶ capture_screenshot(sendToLLM=true)
│                              └──▶ computer(action, coordinate)
│
└── NO ──▶ What kind of task?
              │
              ├── Tab operation ──▶ get_all_tabs / switch_to_tab / create_new_tab / close_tab
              ├── Organize tabs ──▶ get_all_tab_groups / create_tab_group / update_tab_group
              ├── Reopen closed tab ──▶ get_recently_closed / restore_session
              ├── Bookmarks ──▶ search_bookmarks / create_bookmark / list_bookmarks
              ├── Browsing history ──▶ search_history / get_recent_history / get_most_visited_sites
              ├── Read page/link ──▶ read_page / read_url / extract_structured_data / web_search
              ├── Download content ──▶ download_image / download_chat_images
              ├── Visual capture ──▶ capture_screenshot / capture_tab_screenshot
              ├── Page info ──▶ get_page_metadata / scroll_to_element
              └── Need user input ──▶ request_intervention
```
